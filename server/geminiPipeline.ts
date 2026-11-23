import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import {
  consumeUserNanoBananaQuota,
  getCharactersForJob,
  getFramesForJob,
  getRawJob,
  getScenesForJob,
  getUserDailyQuota,
  incrementJobNanoBananaCount,
  updateCharacterAssets,
  updateFrameState,
  updateJobFields,
  updateSceneState,
  upsertCharacters,
  upsertFrames,
  upsertScenes,
} from './db.ts';
import {
  assembleFramesAndMuxAudio,
  combineScenesAndMuxAudio,
  extractFrameAt,
  extractKeyframes,
  extractOriginalAudio,
  extractSequenceFrames,
  getTargetDimensions,
  normalizeClipToScene,
  sliceSceneVideo,
} from './ffmpeg.ts';
import {
  CharacterProfile,
  SceneSegment,
  VideoMetadata,
  VisualStyleDefinition,
  resolveConversionMode,
  resolveVisualStyle,
} from './types.ts';

const activeJobs = new Set<string>();

function createGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please select a billing-enabled Gemini API key in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isTransientOverloadError(rawMsg: string): boolean {
  const lower = rawMsg.toLowerCase();
  return (
    rawMsg.includes('503') ||
    rawMsg.includes('UNAVAILABLE') ||
    rawMsg.includes('OVERLOADED') ||
    lower.includes('high demand') ||
    lower.includes('temporarily unavailable')
  );
}

function formatGeminiError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  let msg = raw;
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; status?: string; code?: number } };
    if (parsed?.error?.message) {
      msg = `${parsed.error.message}${parsed.error.status ? ` (${parsed.error.code ?? ''} ${parsed.error.status})` : ''}`.trim();
    }
  } catch {
    // Not raw JSON
  }

  if (isTransientOverloadError(raw)) {
    return 'Google Gemini / Veo is temporarily experiencing high demand (503 UNAVAILABLE). All completed stages are saved — click Resume to continue from your last checkpoint.';
  }
  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    return 'Google Gemini / Veo quota limit reached (429 RESOURCE_EXHAUSTED). Please check your billing-enabled API key in Settings > Secrets and click Resume from Last Stage.';
  }
  if (raw.includes('403') || raw.includes('PERMISSION_DENIED') || raw.includes('API_KEY_INVALID')) {
    return 'Gemini API authentication failed (403/400). Please verify your billing-enabled GEMINI_API_KEY in Settings > Secrets and click Resume.';
  }
  if (raw.includes('404') || raw.includes('NOT_FOUND')) {
    return `Gemini model endpoint returned 404 Not Found: ${msg}`;
  }
  return msg;
}

async function withRetry<T>(
  operationName: string,
  fn: () => Promise<T>,
  maxAttempts = 4,
  onRetry?: (attempt: number, maxAttempts: number, delayMs: number, reason: string) => void
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const rawMsg = err instanceof Error ? err.message : String(err);
      const isPermanent =
        rawMsg.includes('API_KEY_INVALID') ||
        rawMsg.includes('PERMISSION_DENIED') ||
        rawMsg.includes('NOT_FOUND');
      if (isPermanent || attempt === maxAttempts) {
        throw err;
      }
      const jitter = Math.floor(Math.random() * 1500);
      const delayMs = Math.min(28000, 3500 * Math.pow(2, attempt - 1)) + jitter;
      const reason = isTransientOverloadError(rawMsg)
        ? 'High model demand (503)'
        : 'Temporary API error';
      console.warn(
        `[Pipeline] ${operationName} attempt ${attempt}/${maxAttempts} failed (${reason}). Retrying in ${delayMs}ms...`
      );
      onRetry?.(attempt, maxAttempts, delayMs, reason);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function withModelFailover<T>(
  operationName: string,
  models: string[],
  fn: (model: string) => Promise<T>,
  onStatus?: (message: string) => void
): Promise<T> {
  let lastError: unknown;
  for (let idx = 0; idx < models.length; idx++) {
    const model = models[idx];
    const hasFallback = idx < models.length - 1;
    try {
      return await withRetry(
        `${operationName} [${model}]`,
        () => fn(model),
        hasFallback ? 2 : 3,
        (attempt, maxAttempts, delayMs, reason) => {
          onStatus?.(
            `${reason} on ${model} — retrying automatically (${attempt + 1}/${maxAttempts}) in ${Math.round(delayMs / 1000)}s...`
          );
        }
      );
    } catch (err) {
      lastError = err;
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (hasFallback && (isTransientOverloadError(rawMsg) || rawMsg.includes('429') || rawMsg.includes('RESOURCE_EXHAUSTED'))) {
        const nextModel = models[idx + 1];
        console.warn(`[Pipeline] ${operationName}: ${model} busy/unavailable, failing over to ${nextModel}...`);
        onStatus?.(`${model} experiencing high demand — automatically switching to ${nextModel}...`);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function uploadAndWaitForFile(
  ai: GoogleGenAI,
  filePath: string,
  mimeType: string
): Promise<{ uri: string; name: string }> {
  let uploaded = await ai.files.upload({
    file: filePath,
    config: { mimeType },
  });

  const maxPolls = 36;
  let polls = 0;
  while (uploaded.state === 'PROCESSING' && polls < maxPolls) {
    await new Promise((resolve) => setTimeout(resolve, 4000));
    uploaded = await ai.files.get({ name: uploaded.name || '' });
    polls++;
  }

  if (uploaded.state === 'FAILED') {
    throw new Error('Google File API failed while processing the uploaded video.');
  }
  if (!uploaded.uri || !uploaded.name) {
    throw new Error('Google File API did not return a valid file URI.');
  }

  return { uri: uploaded.uri, name: uploaded.name };
}

interface RawGeminiAnalysis {
  overallStyleNotes: string;
  characters: Array<{
    characterId: string;
    name: string;
    facialFeatures: string;
    hairStyleAndColor: string;
    eyeShapeAndColor: string;
    clothingAndAccessories: string;
    bodyProportions: string;
    colorPalette: string;
    distinctiveFeatures: string;
    bestFrameTimestampSec: number;
  }>;
  scenes: Array<{
    startSec: number;
    endSec: number;
    summary: string;
    expressionsAndActions: string;
    cameraAndMovement: string;
    backgroundAndLighting: string;
    characterIds: string[];
  }>;
}

function buildConsistentScenes(
  rawScenes: RawGeminiAnalysis['scenes'],
  totalDurationSec: number,
  characters: CharacterProfile[],
  overallStyleNotes: string,
  visualStyle: VisualStyleDefinition
): SceneSegment[] {
  const MAX_CLIP_SEC = 10;
  const MIN_CLIP_SEC = 3;

  // Normalize scene boundaries so the entire video duration [0, totalDurationSec] is covered with zero gaps
  const normalizedRanges: Array<{
    startSec: number;
    endSec: number;
    template: RawGeminiAnalysis['scenes'][number];
  }> = [];

  const sorted = [...rawScenes].sort((a, b) => a.startSec - b.startSec);
  if (sorted.length === 0) {
    sorted.push({
      startSec: 0,
      endSec: totalDurationSec,
      summary: `Complete cartoon sequence transformed into ${visualStyle.name}.`,
      expressionsAndActions: 'Preserve all original character movements and facial expressions.',
      cameraAndMovement: 'Preserve original camera framing and motion.',
      backgroundAndLighting: `Cohesive ${visualStyle.name} environment and lighting.`,
      characterIds: characters.map((c) => c.characterId),
    });
  }

  let cursor = 0;
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const isLast = i === sorted.length - 1;
    const rawEnd = isLast ? totalDurationSec : Math.min(totalDurationSec, Math.max(cursor + MIN_CLIP_SEC, item.endSec));
    if (cursor >= totalDurationSec - 0.25) break;

    let segStart = cursor;
    while (segStart < rawEnd - 0.25) {
      const remaining = rawEnd - segStart;
      let segLen = Math.min(MAX_CLIP_SEC, remaining);
      // Avoid leaving a tiny tail shorter than MIN_CLIP_SEC
      if (remaining - segLen > 0 && remaining - segLen < MIN_CLIP_SEC) {
        segLen = remaining / 2;
      }
      const segEnd = Math.min(totalDurationSec, segStart + segLen);
      normalizedRanges.push({
        startSec: Math.round(segStart * 100) / 100,
        endSec: Math.round(segEnd * 100) / 100,
        template: item,
      });
      segStart = segEnd;
    }
    cursor = rawEnd;
  }

  // Ensure the final scene extends strictly to totalDurationSec
  if (normalizedRanges.length > 0) {
    normalizedRanges[normalizedRanges.length - 1].endSec = totalDurationSec;
  }

  const charMap = new Map(characters.map((c) => [c.characterId, c]));

  return normalizedRanges.map((entry, idx) => {
    const durationSec = Math.max(
      MIN_CLIP_SEC,
      Math.round((entry.endSec - entry.startSec) * 100) / 100
    );
    const activeChars = entry.template.characterIds
      .map((id) => charMap.get(id))
      .filter((c): c is CharacterProfile => Boolean(c));
    const fallbackChars = activeChars.length > 0 ? activeChars : characters.slice(0, 3);

    const charLockBlock = fallbackChars
      .map(
        (c) =>
          `[${c.characterId} - ${c.name}]: Face: ${c.facialFeatures}; Hair: ${c.hairStyleAndColor}; Eyes: ${c.eyeShapeAndColor}; Outfit: ${c.clothingAndAccessories}; Proportions: ${c.bodyProportions}; Palette: ${c.colorPalette}; Distinctive traits: ${c.distinctiveFeatures}.`
      )
      .join(' ');

    const conversionPrompt = [
      `Transform this 2D cartoon video scene into a polished ${visualStyle.name} 3D animated sequence.`,
      `Keep exact scene composition, character positions, poses, actions, camera movement, and timing identical to the input video.`,
      `TARGET VISUAL STYLE (${visualStyle.name}): ${visualStyle.videoSceneDirective} ${overallStyleNotes}`,
      `STRICT CHARACTER CONSISTENCY (do NOT alter faces, hairstyles, outfits, or colors across scenes): ${charLockBlock}`,
      `SCENE ACTION (${entry.startSec.toFixed(1)}s to ${entry.endSec.toFixed(1)}s): ${entry.template.summary}. Expressions & movement: ${entry.template.expressionsAndActions}. Camera: ${entry.template.cameraAndMovement}. Environment & lighting: ${entry.template.backgroundAndLighting}.`,
    ].join('\n');

    return {
      sceneIndex: idx,
      startSec: entry.startSec,
      endSec: entry.endSec,
      durationSec,
      summary: entry.template.summary,
      expressionsAndActions: entry.template.expressionsAndActions,
      cameraAndMovement: entry.template.cameraAndMovement,
      backgroundAndLighting: entry.template.backgroundAndLighting,
      characterIds: fallbackChars.map((c) => c.characterId),
      conversionPrompt,
      status: 'pending',
    };
  });
}

function getJobWorkDir(jobId: string): string {
  const dir = path.resolve(process.cwd(), 'data', 'jobs', jobId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function isJobRunning(jobId: string): boolean {
  return activeJobs.has(jobId);
}

export function enqueueJobPipeline(jobId: string): void {
  if (activeJobs.has(jobId)) return;
  activeJobs.add(jobId);

  runJobPipeline(jobId)
    .catch((err) => {
      console.error(`[Pipeline] Unhandled error in job ${jobId}:`, err);
    })
    .finally(() => {
      activeJobs.delete(jobId);
    });
}

async function runJobPipeline(jobId: string): Promise<void> {
  const rawJob = getRawJob(jobId);
  if (!rawJob) return;

  const metadata = JSON.parse(rawJob.metadata_json) as VideoMetadata;
  const visualStyle = resolveVisualStyle(rawJob.visual_style);
  const conversionMode = resolveConversionMode(rawJob.conversion_mode);
  const targetFps = Math.max(0.5, Math.min(4, Number(rawJob.target_fps) || 2));
  const userId = rawJob.user_id;
  const jobDir = getJobWorkDir(jobId);
  const assetsDir = path.join(jobDir, 'assets');
  const framesDir = path.join(jobDir, 'frames');
  const scenesDir = path.join(jobDir, 'scenes');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.mkdirSync(framesDir, { recursive: true });
  fs.mkdirSync(scenesDir, { recursive: true });

  let lastCompletedStage = rawJob.last_completed_stage;
  let audioPath = rawJob.audio_path;

  updateJobFields(jobId, {
    status: 'processing',
    error_message: null,
  });

  try {
    const ai = createGeminiClient();

    // =========================================================================
    // STAGE 2: Extracting frames & original audio via FFmpeg
    // =========================================================================
    if (lastCompletedStage < 2) {
      updateJobFields(jobId, {
        current_stage: 2,
        progress: 12,
        stage_detail:
          conversionMode === 'nano_banana_frames'
            ? `Extracting sequential frames (${targetFps} FPS) across ${metadata.durationSec.toFixed(1)}s for Nano Banana rendering...`
            : `Extracting keyframes across ${metadata.durationSec.toFixed(1)}s and separating original audio stream...`,
        estimated_seconds_remaining: null,
      });

      const extractedAudioPath = path.join(jobDir, 'original_audio.m4a');
      if (metadata.hasAudio) {
        const ok = await extractOriginalAudio(rawJob.input_path, extractedAudioPath);
        audioPath = ok ? extractedAudioPath : null;
      } else {
        audioPath = null;
      }

      if (conversionMode === 'nano_banana_frames') {
        const quota = userId ? getUserDailyQuota(userId) : null;
        // Reserve up to 2 images for character reference portraits when quota allows, and fit frames inside remaining limit
        const remainingQuota = quota ? quota.imagesRemaining : 60;
        const maxFramesAllowed = Math.max(2, Math.min(120, remainingQuota));
        const seqFrames = await extractSequenceFrames({
          inputPath: rawJob.input_path,
          assetsDir,
          durationSec: metadata.durationSec,
          targetFps,
          maxFrames: maxFramesAllowed,
        });
        upsertFrames(
          jobId,
          seqFrames.map((f) => ({
            frameIndex: f.frameIndex,
            timestampSec: f.timestampSec,
            sourceAsset: f.sourceAsset,
            status: 'pending',
          }))
        );
        lastCompletedStage = 2;
        updateJobFields(jobId, {
          audio_path: audioPath,
          last_completed_stage: 2,
          progress: 20,
          stage_detail: `Extracted ${seqFrames.length} sequential frames for Nano Banana${audioPath ? ' + original audio' : ''}.`,
        });
      } else {
        const frames = await extractKeyframes(rawJob.input_path, framesDir, metadata.durationSec);
        lastCompletedStage = 2;
        updateJobFields(jobId, {
          audio_path: audioPath,
          last_completed_stage: 2,
          progress: 20,
          stage_detail: `Extracted ${frames.length} keyframes${audioPath ? ' and original audio track' : ''}.`,
        });
      }
    }

    // =========================================================================
    // STAGE 3 & 4: Gemini analyzing full video + detecting characters
    // =========================================================================
    let analysis: RawGeminiAnalysis | null = rawJob.analysis_json
      ? (JSON.parse(rawJob.analysis_json) as RawGeminiAnalysis)
      : null;

    if (lastCompletedStage < 4 || !analysis) {
      updateJobFields(jobId, {
        current_stage: 3,
        progress: 24,
        stage_detail: 'Uploading complete video to Gemini for full-duration scene and character understanding...',
      });

      const uploadedFullVideo = await withRetry('Gemini video upload', () =>
        uploadAndWaitForFile(ai, rawJob.input_path, 'video/mp4')
      );

      updateJobFields(jobId, {
        current_stage: 3,
        progress: 30,
        stage_detail: `Gemini analyzing every scene, character trait, movement, and background for ${visualStyle.name}...`,
      });

      const analysisPrompt = `Analyze the ENTIRE uploaded 2D cartoon video from 0.0s to ${metadata.durationSec.toFixed(2)}s (not just the first frame).
Target 3D conversion style: ${visualStyle.name} — ${visualStyle.description}
1. Identify EVERY recurring character across the complete video and create a strict visual consistency sheet for each:
   - characterId (e.g. "CHAR_01", "CHAR_02")
   - name (descriptive name or role)
   - facialFeatures, hairStyleAndColor, eyeShapeAndColor, clothingAndAccessories, bodyProportions, colorPalette, distinctiveFeatures
   - bestFrameTimestampSec: the exact timestamp in seconds (between 0 and ${Math.max(0.2, metadata.durationSec - 0.2).toFixed(2)}) where this character's face and outfit are most clearly visible.
2. Segment the ENTIRE video chronologically into natural scenes covering 0.0s to ${metadata.durationSec.toFixed(2)}s (each scene ideally 4 to 9 seconds long, no missing seconds):
   - startSec, endSec
   - summary, expressionsAndActions, cameraAndMovement, backgroundAndLighting
   - characterIds: array of characterId values visible in that scene.
3. Provide overallStyleNotes specifically tailored to "${visualStyle.name}": ${visualStyle.analysisGuidance}`;

      const geminiResponse = await withModelFailover(
        'Gemini video analysis',
        ['gemini-4-hydrogen', 'gemini-4-neon', 'gemini-3.1-flash-lite'],
        (model) =>
          ai.models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    fileData: {
                      fileUri: uploadedFullVideo.uri,
                      mimeType: 'video/mp4',
                    },
                  },
                  { text: analysisPrompt },
                ],
              },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  overallStyleNotes: { type: Type.STRING },
                  characters: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        characterId: { type: Type.STRING },
                        name: { type: Type.STRING },
                        facialFeatures: { type: Type.STRING },
                        hairStyleAndColor: { type: Type.STRING },
                        eyeShapeAndColor: { type: Type.STRING },
                        clothingAndAccessories: { type: Type.STRING },
                        bodyProportions: { type: Type.STRING },
                        colorPalette: { type: Type.STRING },
                        distinctiveFeatures: { type: Type.STRING },
                        bestFrameTimestampSec: { type: Type.NUMBER },
                      },
                      required: [
                        'characterId',
                        'name',
                        'facialFeatures',
                        'hairStyleAndColor',
                        'eyeShapeAndColor',
                        'clothingAndAccessories',
                        'bodyProportions',
                        'colorPalette',
                        'distinctiveFeatures',
                        'bestFrameTimestampSec',
                      ],
                    },
                  },
                  scenes: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        startSec: { type: Type.NUMBER },
                        endSec: { type: Type.NUMBER },
                        summary: { type: Type.STRING },
                        expressionsAndActions: { type: Type.STRING },
                        cameraAndMovement: { type: Type.STRING },
                        backgroundAndLighting: { type: Type.STRING },
                        characterIds: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING },
                        },
                      },
                      required: [
                        'startSec',
                        'endSec',
                        'summary',
                        'expressionsAndActions',
                        'cameraAndMovement',
                        'backgroundAndLighting',
                        'characterIds',
                      ],
                    },
                  },
                },
                required: ['overallStyleNotes', 'characters', 'scenes'],
              },
            },
          }),
        (statusMsg) => {
          updateJobFields(jobId, { stage_detail: statusMsg });
        }
      );

      // Clean up temporary uploaded full video on File API best-effort
      ai.files.delete({ name: uploadedFullVideo.name }).catch(() => {});

      const rawText = (geminiResponse.text ?? '').trim();
      if (!rawText) {
        throw new Error('Gemini returned an empty analysis response for the uploaded video.');
      }
      analysis = JSON.parse(rawText) as RawGeminiAnalysis;

      // Stage 4: Persist detected characters
      updateJobFields(jobId, {
        current_stage: 4,
        progress: 38,
        analysis_json: JSON.stringify(analysis),
        last_completed_stage: 3,
        stage_detail: `Detected ${analysis.characters.length} character(s) and ${analysis.scenes.length} scene boundary segments.`,
      });

      const charProfiles: CharacterProfile[] = (analysis.characters ?? []).map((c, idx) => ({
        characterId: c.characterId || `CHAR_${String(idx + 1).padStart(2, '0')}`,
        name: c.name || `Character ${idx + 1}`,
        facialFeatures: c.facialFeatures || 'Expressive anime features',
        hairStyleAndColor: c.hairStyleAndColor || 'Consistent hair styling',
        eyeShapeAndColor: c.eyeShapeAndColor || 'Expressive eyes',
        clothingAndAccessories: c.clothingAndAccessories || 'Original outfit preserved',
        bodyProportions: c.bodyProportions || 'Balanced stylized anime proportions',
        colorPalette: c.colorPalette || 'Original character color palette',
        distinctiveFeatures: c.distinctiveFeatures || 'Consistent signature look',
        bestFrameTimestampSec: Math.min(
          Math.max(0.1, Number(c.bestFrameTimestampSec) || 0.2),
          Math.max(0.1, metadata.durationSec - 0.1)
        ),
      }));

      upsertCharacters(jobId, charProfiles);
      lastCompletedStage = 4;
      updateJobFields(jobId, {
        last_completed_stage: 4,
        progress: 42,
        stage_detail: `Registered ${charProfiles.length} persistent character profile(s) in the Character Consistency Engine.`,
      });
    }

    // =========================================================================
    // STAGE 5: Creating character reference profiles (3D Anime portraits)
    // =========================================================================
    let characters = getCharactersForJob(jobId);
    if (lastCompletedStage < 5) {
      updateJobFields(jobId, {
        current_stage: 5,
        progress: 45,
        stage_detail: `Generating ${visualStyle.name} reference sheets for ${characters.length} detected character(s)...`,
      });

      const pendingFramesCount =
        conversionMode === 'nano_banana_frames'
          ? getFramesForJob(jobId).filter((f) => f.status !== 'completed').length
          : 0;
      const charsToProcess = characters.slice(0, conversionMode === 'nano_banana_frames' ? 2 : 4);
      for (let i = 0; i < charsToProcess.length; i++) {
        const char = charsToProcess[i];
        const safeCharId = char.characterId.replace(/[^a-zA-Z0-9_-]/g, '_');
        const sourceAssetName = `char_${safeCharId}_source.jpg`;
        const animeAssetName = `char_${safeCharId}_3d_ref.png`;
        const sourcePath = path.join(assetsDir, sourceAssetName);
        const animeRefPath = path.join(assetsDir, animeAssetName);

        if (!fs.existsSync(sourcePath)) {
          await extractFrameAt(rawJob.input_path, char.bestFrameTimestampSec, sourcePath);
          updateCharacterAssets(jobId, char.characterId, sourceAssetName, undefined);
        }

        if (!fs.existsSync(animeRefPath)) {
          // Reserve user's remaining Nano Banana quota for video frames if budget is tight
          const quotaCheck = userId ? getUserDailyQuota(userId) : null;
          const canSpendOnPortrait =
            !quotaCheck ||
            conversionMode !== 'nano_banana_frames' ||
            quotaCheck.imagesRemaining > pendingFramesCount;

          if (canSpendOnPortrait) {
            if (userId) {
              const consumed = consumeUserNanoBananaQuota(userId, 1);
              if (!consumed.allowed) {
                throw new Error(
                  `Daily Nano Banana image limit (${consumed.quota.dailyLimit}/${consumed.quota.dailyLimit}) reached. Click Resume after your quota resets.`
                );
              }
            }
            const sourceB64 = fs.readFileSync(sourcePath).toString('base64');
            const refPrompt = `Transform the character "${char.name}" (${char.characterId}) shown in this 2D cartoon frame into a clean ${visualStyle.name} character reference portrait on a neutral soft studio background.
Preserve exact character identity and visual traits strictly:
- Facial features: ${char.facialFeatures}
- Hair: ${char.hairStyleAndColor}
- Eyes: ${char.eyeShapeAndColor}
- Clothing & accessories: ${char.clothingAndAccessories}
- Source proportions: ${char.bodyProportions}
- Colors: ${char.colorPalette}
- Distinctive features: ${char.distinctiveFeatures}
TARGET VISUAL STYLE (${visualStyle.name}): ${visualStyle.characterRefDirective}`;

            const refImgRes = await withModelFailover(
              `${visualStyle.name} reference for ${char.name}`,
              ['gemini-3.1-flash-lite-image', 'gemini-nano-banana-2.1'],
              (model) =>
                ai.models.generateContent({
                  model,
                  contents: {
                    parts: [
                      {
                        inlineData: {
                          mimeType: 'image/jpeg',
                          data: sourceB64,
                        },
                      },
                      { text: refPrompt },
                    ],
                  },
                  config: {
                    imageConfig: {
                      aspectRatio: '1:1',
                    },
                  },
                }),
              (statusMsg) => {
                updateJobFields(jobId, { stage_detail: statusMsg });
              }
            );

            const parts = refImgRes.candidates?.[0]?.content?.parts ?? [];
            const imgPart = parts.find((p) => p.inlineData?.data);
            if (imgPart?.inlineData?.data) {
              fs.writeFileSync(animeRefPath, Buffer.from(imgPart.inlineData.data, 'base64'));
              updateCharacterAssets(jobId, char.characterId, sourceAssetName, animeAssetName);
              incrementJobNanoBananaCount(jobId, 1);
            }
          }
        }

        const pct = 45 + Math.round(((i + 1) / Math.max(1, charsToProcess.length)) * 8);
        updateJobFields(jobId, {
          progress: pct,
          stage_detail: `Created ${visualStyle.name} consistency profile ${i + 1} of ${charsToProcess.length} (${char.name}).`,
        });
      }

      characters = getCharactersForJob(jobId);
      lastCompletedStage = 5;
      updateJobFields(jobId, {
        last_completed_stage: 5,
        progress: 53,
        stage_detail: `Persistent ${visualStyle.name} character reference profiles ready.`,
      });
    }

    // =========================================================================
    // STAGE 6: Detecting scenes & building per-scene keyframes + prompts
    // =========================================================================
    let scenes = getScenesForJob(jobId);
    if (lastCompletedStage < 6 || scenes.length === 0) {
      updateJobFields(jobId, {
        current_stage: 6,
        progress: 56,
        stage_detail: `Segmenting source timeline into chronological scenes and locking ${visualStyle.name} prompts...`,
      });

      const builtScenes = buildConsistentScenes(
        analysis?.scenes ?? [],
        metadata.durationSec,
        characters,
        analysis?.overallStyleNotes ?? '',
        visualStyle
      );

      for (const scene of builtScenes) {
        const keyframeName = `scene_${String(scene.sceneIndex).padStart(2, '0')}_keyframe.jpg`;
        const keyframePath = path.join(assetsDir, keyframeName);
        await extractFrameAt(rawJob.input_path, scene.startSec + 0.1, keyframePath);
        scene.keyframeAsset = keyframeName;
      }

      upsertScenes(jobId, builtScenes);
      scenes = getScenesForJob(jobId);
      lastCompletedStage = 6;
      updateJobFields(jobId, {
        last_completed_stage: 6,
        progress: 60,
        stage_detail: `Prepared ${scenes.length} scene segment(s) covering the full ${metadata.durationSec.toFixed(1)}s duration.`,
      });
    }

    // =========================================================================
    // STAGE 7: Nano Banana Frame-by-Frame OR Veo Scene-by-Scene Generation
    // =========================================================================
    if (conversionMode === 'nano_banana_frames') {
      let seqFrames = getFramesForJob(jobId);
      if (seqFrames.length === 0) {
        const quota = userId ? getUserDailyQuota(userId) : null;
        const maxFramesAllowed = Math.max(2, Math.min(120, quota ? quota.imagesRemaining : 40));
        const extracted = await extractSequenceFrames({
          inputPath: rawJob.input_path,
          assetsDir,
          durationSec: metadata.durationSec,
          targetFps,
          maxFrames: maxFramesAllowed,
        });
        upsertFrames(
          jobId,
          extracted.map((f) => ({
            frameIndex: f.frameIndex,
            timestampSec: f.timestampSec,
            sourceAsset: f.sourceAsset,
            status: 'pending',
          }))
        );
        seqFrames = getFramesForJob(jobId);
      }

      if (lastCompletedStage < 7) {
        const aspectRatio: '9:16' | '16:9' =
          metadata.orientation === 'portrait' ? '9:16' : '16:9';
        const completedDurationsMs: number[] = seqFrames
          .filter((f) => f.status === 'completed' && f.durationMs)
          .map((f) => f.durationMs!);

        const charMap = new Map(characters.map((c) => [c.characterId, c]));
        let previousRenderedPath: string | null = null;

        for (let i = 0; i < seqFrames.length; i++) {
          const frame = seqFrames[i];
          const renderedAssetName = `seq_${String(frame.frameIndex).padStart(4, '0')}_3d.png`;
          const renderedFullPath = path.join(assetsDir, renderedAssetName);
          const sourceFullPath = path.join(assetsDir, frame.sourceAsset);

          // Resume support: skip already-completed frames on disk
          if (
            frame.status === 'completed' &&
            frame.renderedAsset &&
            fs.existsSync(path.join(assetsDir, frame.renderedAsset))
          ) {
            previousRenderedPath = path.join(assetsDir, frame.renderedAsset);
            continue;
          }

          // Authoritative Nano Banana daily image limit check per signed-in user
          if (userId) {
            const quotaCheck = consumeUserNanoBananaQuota(userId, 1);
            if (!quotaCheck.allowed) {
              const doneCount = seqFrames.filter((f) => f.status === 'completed').length;
              throw new Error(
                `Daily Nano Banana image limit (${quotaCheck.quota.dailyLimit}/${quotaCheck.quota.dailyLimit}) reached after rendering ${doneCount} of ${seqFrames.length} frames. All completed frames are saved — click Resume after your daily quota resets to finish.`
              );
            }
          }

          const remainingCount = seqFrames.length - i;
          const avgMs =
            completedDurationsMs.length > 0
              ? completedDurationsMs.reduce((a, b) => a + b, 0) / completedDurationsMs.length
              : null;
          const etaSec = avgMs !== null ? Math.round((avgMs * remainingCount) / 1000) : null;

          updateFrameState(jobId, frame.frameIndex, {
            status: 'generating',
            errorMessage: null,
          });
          updateJobFields(jobId, {
            current_stage: 7,
            progress: 60 + Math.round((i / Math.max(1, seqFrames.length)) * 25),
            estimated_seconds_remaining: etaSec,
            stage_detail: `Nano Banana generating 3D frame ${i + 1} of ${seqFrames.length} (${frame.timestampSec.toFixed(1)}s) in ${visualStyle.name} style...`,
          });

          const frameStartTs = Date.now();
          const activeScene =
            scenes.find(
              (s) => frame.timestampSec >= s.startSec - 0.1 && frame.timestampSec <= s.endSec + 0.1
            ) ?? scenes[0];

          const activeChars = (activeScene?.characterIds ?? [])
            .map((id) => charMap.get(id))
            .filter((c): c is CharacterProfile => Boolean(c));
          const lockedChars = activeChars.length > 0 ? activeChars : characters.slice(0, 2);

          const parts: Array<{ inlineData?: { mimeType: string; data: string }; text?: string }> = [
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: fs.readFileSync(sourceFullPath).toString('base64'),
              },
            },
          ];

          // Attach up to 2 character reference sheets for consistent identity
          let attachedRefs = 0;
          for (const char of lockedChars) {
            if (attachedRefs >= 2) break;
            const refAsset = char.animeRefAsset || char.sourceFaceAsset;
            if (!refAsset) continue;
            const refPath = path.join(assetsDir, refAsset);
            if (fs.existsSync(refPath)) {
              parts.push({
                inlineData: {
                  mimeType: refAsset.endsWith('.png') ? 'image/png' : 'image/jpeg',
                  data: fs.readFileSync(refPath).toString('base64'),
                },
              });
              attachedRefs++;
            }
          }

          // Attach previous rendered 3D frame for frame-to-frame temporal continuity
          const hasPrevFrame = Boolean(previousRenderedPath && fs.existsSync(previousRenderedPath));
          if (hasPrevFrame && previousRenderedPath) {
            parts.push({
              inlineData: {
                mimeType: 'image/png',
                data: fs.readFileSync(previousRenderedPath).toString('base64'),
              },
            });
          }

          const charLockText = lockedChars
            .map(
              (c) =>
                `[${c.characterId} ${c.name}]: Face=${c.facialFeatures}; Hair=${c.hairStyleAndColor}; Eyes=${c.eyeShapeAndColor}; Outfit=${c.clothingAndAccessories}; Palette=${c.colorPalette}`
            )
            .join(' | ');

          const framePrompt = [
            `Convert the FIRST image (source 2D cartoon frame #${i + 1} at ${frame.timestampSec.toFixed(2)}s) into a single polished ${visualStyle.name} 3D frame.`,
            `Preserve the EXACT pose, camera framing, character placement, facial expression, and background layout from the first image.`,
            hasPrevFrame
              ? `Use the LAST attached image (the previous rendered 3D frame) to maintain identical 3D lighting, shading, material textures, and background continuity.`
              : '',
            `TARGET VISUAL STYLE (${visualStyle.name}): ${visualStyle.videoSceneDirective}`,
            charLockText ? `CHARACTER CONSISTENCY LOCK: ${charLockText}` : '',
            activeScene
              ? `SCENE CONTEXT: ${activeScene.summary}. Lighting & environment: ${activeScene.backgroundAndLighting}.`
              : '',
            `Output a clean full-bleed single frame with no borders, no captions, and no watermarks.`,
          ]
            .filter(Boolean)
            .join('\n');

          parts.push({ text: framePrompt });

          try {
            const imgRes = await withModelFailover(
              `Nano Banana frame ${i + 1}/${seqFrames.length}`,
              ['gemini-3.1-flash-lite-image', 'gemini-nano-banana-2.1'],
              (model) =>
                ai.models.generateContent({
                  model,
                  contents: { parts },
                  config: {
                    imageConfig: {
                      aspectRatio,
                    },
                  },
                }),
              (statusMsg) => {
                updateJobFields(jobId, {
                  stage_detail: `Frame ${i + 1}/${seqFrames.length}: ${statusMsg}`,
                });
              }
            );

            const resParts = imgRes.candidates?.[0]?.content?.parts ?? [];
            const imgPart = resParts.find((p) => p.inlineData?.data);
            if (!imgPart?.inlineData?.data) {
              throw new Error(
                `Nano Banana did not return image data for frame ${i + 1}. Click Resume to retry.`
              );
            }

            fs.writeFileSync(renderedFullPath, Buffer.from(imgPart.inlineData.data, 'base64'));
            const elapsedMs = Date.now() - frameStartTs;
            completedDurationsMs.push(elapsedMs);
            previousRenderedPath = renderedFullPath;

            updateFrameState(jobId, frame.frameIndex, {
              status: 'completed',
              renderedAsset: renderedAssetName,
              errorMessage: null,
              durationMs: elapsedMs,
            });
            incrementJobNanoBananaCount(jobId, 1);

            // Gentle pacing between frames to stay friendly to per-minute Nano Banana rate limits
            if (i < seqFrames.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 900));
            }
          } catch (frameErr) {
            const formatted = formatGeminiError(frameErr);
            updateFrameState(jobId, frame.frameIndex, {
              status: 'failed',
              errorMessage: formatted,
            });
            throw frameErr;
          }
        }

        seqFrames = getFramesForJob(jobId);
        lastCompletedStage = 7;
        updateJobFields(jobId, {
          last_completed_stage: 7,
          progress: 86,
          estimated_seconds_remaining: 10,
          stage_detail: `All ${seqFrames.length} ${visualStyle.name} frames rendered with Nano Banana.`,
        });
      }

      // =========================================================================
      // STAGE 8, 9, 10 (Nano Banana): Assemble 3D frames + sync audio + render MP4
      // =========================================================================
      updateJobFields(jobId, {
        current_stage: 8,
        progress: 90,
        stage_detail: `Stitching ${seqFrames.length} Nano Banana 3D frames into smooth 24fps video...`,
      });

      const targetDims = getTargetDimensions(metadata);
      const renderedPaths = seqFrames.map((f) => {
        if (!f.renderedAsset) {
          throw new Error(`Missing rendered image for frame ${f.frameIndex + 1}. Click Resume.`);
        }
        const full = path.join(assetsDir, f.renderedAsset);
        if (!fs.existsSync(full)) {
          throw new Error(`Rendered image file missing for frame ${f.frameIndex + 1}. Click Resume.`);
        }
        return full;
      });

      const combinedSilentPath = path.join(jobDir, 'combined_3d_frames_silent.mp4');
      const finalMp4Path = path.join(jobDir, 'converted_3d_anime.mp4');

      const outputMetadata = await assembleFramesAndMuxAudio({
        frameImagePaths: renderedPaths,
        originalAudioPath: audioPath,
        combinedSilentPath,
        finalMp4Path,
        targetWidth: targetDims.width,
        targetHeight: targetDims.height,
        targetDurationSec: metadata.durationSec,
        onStageSyncAudio: () => {
          updateJobFields(jobId, {
            current_stage: 9,
            last_completed_stage: 8,
            progress: 94,
            estimated_seconds_remaining: 5,
            stage_detail: audioPath
              ? `Synchronizing original audio track to ${seqFrames.length}-frame ${visualStyle.name} timeline...`
              : 'Finalizing stereo AAC audio track for universal MP4 playback...',
          });
        },
        onStageRenderFinal: () => {
          updateJobFields(jobId, {
            current_stage: 10,
            last_completed_stage: 9,
            progress: 97,
            estimated_seconds_remaining: 2,
            stage_detail: `Rendering final H.264/AAC MP4 (${targetDims.width}x${targetDims.height})...`,
          });
        },
      });

      updateJobFields(jobId, {
        status: 'completed',
        current_stage: 10,
        last_completed_stage: 10,
        progress: 100,
        estimated_seconds_remaining: 0,
        output_path: finalMp4Path,
        output_metadata_json: JSON.stringify(outputMetadata),
        error_message: null,
        stage_detail: `Completed ${visualStyle.name} Nano Banana MP4 (${seqFrames.length} frames, ${outputMetadata.width}x${outputMetadata.height}, ${outputMetadata.durationSec.toFixed(1)}s).`,
      });
      return;
    }

    // =========================================================================
    // STAGE 7 (Veo Mode): Google Veo (gemini-omni-1.2-flash) generating 3D scenes
    // =========================================================================
    if (lastCompletedStage < 7) {
      const aspectRatio: '9:16' | '16:9' =
        metadata.orientation === 'portrait' ? '9:16' : '16:9';
      const completedDurationsMs: number[] = scenes
        .filter((s) => s.status === 'completed' && s.durationMs)
        .map((s) => s.durationMs!);

      for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i];
        const rawClipOut = path.join(
          scenesDir,
          `scene_${String(scene.sceneIndex).padStart(2, '0')}_veo.mp4`
        );

        // Resume support: skip scenes that already completed and have valid clips on disk
        if (scene.status === 'completed' && scene.clipPath && fs.existsSync(scene.clipPath)) {
          continue;
        }

        const remainingCount = scenes.length - i;
        const avgMs =
          completedDurationsMs.length > 0
            ? completedDurationsMs.reduce((a, b) => a + b, 0) / completedDurationsMs.length
            : null;
        const etaSec = avgMs !== null ? Math.round((avgMs * remainingCount) / 1000) : null;

        updateSceneState(jobId, scene.sceneIndex, {
          status: 'generating',
          errorMessage: null,
        });
        updateJobFields(jobId, {
          current_stage: 7,
          progress: 60 + Math.round((i / scenes.length) * 25),
          estimated_seconds_remaining: etaSec,
          stage_detail: `Veo generating ${visualStyle.name} scene ${i + 1} of ${scenes.length} (${scene.startSec.toFixed(1)}s – ${scene.endSec.toFixed(1)}s)...`,
        });

        const sceneStartTs = Date.now();
        const sourceSlicePath = path.join(
          scenesDir,
          `scene_${String(scene.sceneIndex).padStart(2, '0')}_source.mp4`
        );
        await sliceSceneVideo(
          rawJob.input_path,
          scene.startSec,
          Math.max(0.8, scene.endSec - scene.startSec),
          sourceSlicePath
        );

        // Upload scene slice to Gemini File API so Omni Flash can perform true video-to-video 3D anime conversion
        const uploadedSceneSlice = await withRetry(`Upload scene ${i + 1} source slice`, () =>
          uploadAndWaitForFile(ai, sourceSlicePath, 'video/mp4')
        );

        // Attach persistent 3D Anime character reference portraits for every character appearing in this scene
        const sceneCharRefs: Array<{ type: 'image'; mime_type: string; data: string }> = [];
        const targetCharIds = new Set(scene.characterIds);
        for (const char of characters) {
          if (sceneCharRefs.length >= 4) break;
          if (!targetCharIds.has(char.characterId) && targetCharIds.size > 0) continue;
          const refFile = char.animeRefAsset || char.sourceFaceAsset;
          if (!refFile) continue;
          const fullRefPath = path.join(assetsDir, refFile);
          if (fs.existsSync(fullRefPath)) {
            sceneCharRefs.push({
              type: 'image',
              mime_type: refFile.endsWith('.png') ? 'image/png' : 'image/jpeg',
              data: fs.readFileSync(fullRefPath).toString('base64'),
            });
          }
        }

        const veoDurationSec = Math.max(3, Math.min(10, Math.round(scene.durationSec)));

        try {
          const interaction = await withRetry(
            `Veo 3D Anime scene ${i + 1}`,
            () =>
              ai.interactions.create(
                {
                  model: 'gemini-omni-1.2-flash',
                  input: [
                    {
                      type: 'video',
                      uri: uploadedSceneSlice.uri,
                    },
                    ...sceneCharRefs,
                    {
                      type: 'text',
                      text: scene.conversionPrompt,
                    },
                  ],
                  background: false,
                  store: false,
                  stream: false,
                  response_format: {
                    type: 'video',
                    aspect_ratio: aspectRatio,
                    duration: `${veoDurationSec}s`,
                    resolution: '720p',
                  },
                } as Parameters<typeof ai.interactions.create>[0],
                { timeout: 300000 }
              ),
            5,
            (attempt, maxAttempts, delayMs, reason) => {
              updateJobFields(jobId, {
                stage_detail: `Scene ${i + 1}/${scenes.length}: ${reason} — retrying Veo automatically (${attempt + 1}/${maxAttempts}) in ${Math.round(delayMs / 1000)}s...`,
              });
            }
          );

          // Extract generated video payload cleanly (supports both output_video helper and steps)
          let videoBase64: string | undefined;
          let videoUri: string | undefined;

          const outVideo = (interaction as unknown as {
            output_video?: { data?: string; uri?: string; mime_type?: string };
            steps?: Array<{
              type?: string;
              content?: Array<{ type?: string; data?: string; uri?: string }>;
            }>;
          }).output_video;

          if (outVideo?.data) {
            videoBase64 = outVideo.data;
          } else if (outVideo?.uri) {
            videoUri = outVideo.uri;
          } else {
            const steps =
              (interaction as unknown as {
                steps?: Array<{
                  type?: string;
                  content?: Array<{ type?: string; data?: string; uri?: string }>;
                }>;
              }).steps ?? [];
            for (const step of steps) {
              if (step.type === 'model_output' && Array.isArray(step.content)) {
                const vPart = step.content.find((c) => c.type === 'video');
                if (vPart?.data) {
                  videoBase64 = vPart.data;
                  break;
                }
                if (vPart?.uri) {
                  videoUri = vPart.uri;
                  break;
                }
              }
            }
          }

          if (videoBase64) {
            fs.writeFileSync(rawClipOut, Buffer.from(videoBase64, 'base64'));
          } else if (videoUri) {
            const parsedUri = new URL(videoUri);
            if (
              parsedUri.protocol !== 'https:' ||
              !parsedUri.hostname.endsWith('googleapis.com')
            ) {
              throw new Error('Unexpected video URI host returned by Veo service.');
            }
            const dlRes = await fetch(videoUri, {
              headers: {
                'x-goog-api-key': process.env.GEMINI_API_KEY || '',
              },
            });
            if (!dlRes.ok) {
              throw new Error(`Failed to download Veo clip (${dlRes.status}).`);
            }
            const buf = Buffer.from(await dlRes.arrayBuffer());
            fs.writeFileSync(rawClipOut, buf);
          } else {
            throw new Error(
              `Veo did not return video bytes for scene ${i + 1}. Please retry via Resume.`
            );
          }

          const elapsedMs = Date.now() - sceneStartTs;
          completedDurationsMs.push(elapsedMs);
          updateSceneState(jobId, scene.sceneIndex, {
            status: 'completed',
            clipPath: rawClipOut,
            errorMessage: null,
            durationMs: elapsedMs,
          });
        } catch (sceneErr) {
          const formatted = formatGeminiError(sceneErr);
          updateSceneState(jobId, scene.sceneIndex, {
            status: 'failed',
            errorMessage: formatted,
          });
          throw sceneErr;
        } finally {
          ai.files.delete({ name: uploadedSceneSlice.name }).catch(() => {});
        }
      }

      scenes = getScenesForJob(jobId);
      lastCompletedStage = 7;
      updateJobFields(jobId, {
        last_completed_stage: 7,
        progress: 86,
        estimated_seconds_remaining: 12,
        stage_detail: `All ${scenes.length} ${visualStyle.name} scene clip(s) generated by Veo.`,
      });
    }

    // =========================================================================
    // STAGE 8, 9, 10 (Veo): Validate, normalize, combine scenes, sync audio, render MP4
    // =========================================================================
    updateJobFields(jobId, {
      current_stage: 8,
      progress: 89,
      stage_detail: 'Validating generated clips, matching aspect ratio, and combining scenes chronologically...',
    });

    const targetDims = getTargetDimensions(metadata);
    const normalizedClips: string[] = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      if (!scene.clipPath || !fs.existsSync(scene.clipPath)) {
        throw new Error(`Missing generated clip for scene ${i + 1}. Click Resume to regenerate.`);
      }
      const normalizedPath = path.join(
        scenesDir,
        `scene_${String(scene.sceneIndex).padStart(2, '0')}_norm.mp4`
      );
      const exactSceneDur = Math.max(0.5, scene.endSec - scene.startSec);
      await normalizeClipToScene(
        scene.clipPath,
        normalizedPath,
        targetDims.width,
        targetDims.height,
        exactSceneDur
      );
      normalizedClips.push(normalizedPath);
    }

    const combinedSilentPath = path.join(jobDir, 'combined_3d_anime_silent.mp4');
    const finalMp4Path = path.join(jobDir, 'converted_3d_anime.mp4');

    const outputMetadata = await combineScenesAndMuxAudio({
      normalizedClipPaths: normalizedClips,
      originalAudioPath: audioPath,
      combinedSilentPath,
      finalMp4Path,
      targetDurationSec: metadata.durationSec,
      onStageSyncAudio: () => {
        updateJobFields(jobId, {
          current_stage: 9,
          last_completed_stage: 8,
          progress: 94,
          estimated_seconds_remaining: 6,
          stage_detail: audioPath
            ? 'Synchronizing original audio track to combined 3D Anime timeline...'
            : 'Finalizing silent stereo AAC audio track for universal MP4 playback...',
        });
      },
      onStageRenderFinal: () => {
        updateJobFields(jobId, {
          current_stage: 10,
          last_completed_stage: 9,
          progress: 97,
          estimated_seconds_remaining: 3,
          stage_detail: `Rendering final H.264/AAC MP4 (${targetDims.width}x${targetDims.height})...`,
        });
      },
    });

    updateJobFields(jobId, {
      status: 'completed',
      current_stage: 10,
      last_completed_stage: 10,
      progress: 100,
      estimated_seconds_remaining: 0,
      output_path: finalMp4Path,
      output_metadata_json: JSON.stringify(outputMetadata),
      error_message: null,
      stage_detail: `Completed ${visualStyle.name} MP4 (${outputMetadata.width}x${outputMetadata.height}, ${outputMetadata.durationSec.toFixed(1)}s).`,
    });
  } catch (err) {
    const friendlyError = formatGeminiError(err);
    console.error(`[Pipeline] Job ${jobId} failed at stage ${lastCompletedStage + 1}:`, err);
    updateJobFields(jobId, {
      status: 'failed',
      estimated_seconds_remaining: null,
      error_message: friendlyError,
      stage_detail: `Paused at stage ${Math.min(10, lastCompletedStage + 1)} — resumable from last checkpoint.`,
    });
  }
}
