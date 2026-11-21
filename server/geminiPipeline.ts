import { GoogleGenAI, Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import {
  getCharactersForJob,
  getRawJob,
  getScenesForJob,
  updateCharacterAssets,
  updateJobFields,
  updateSceneState,
  upsertCharacters,
  upsertScenes,
} from './db.ts';
import {
  combineScenesAndMuxAudio,
  extractFrameAt,
  extractKeyframes,
  extractOriginalAudio,
  getTargetDimensions,
  normalizeClipToScene,
  sliceSceneVideo,
} from './ffmpeg.ts';
import { CharacterProfile, SceneSegment, VideoMetadata } from './types.ts';

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
  overallStyleNotes: string
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
      summary: 'Complete cartoon sequence transformed into cinematic 3D anime.',
      expressionsAndActions: 'Preserve all original character movements and facial expressions.',
      cameraAndMovement: 'Preserve original camera framing and motion.',
      backgroundAndLighting: 'Rich volumetric 3D anime environment with cinematic lighting.',
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
      `Transform this 2D cartoon video scene into a high-budget theatrical 3D CG Anime film sequence.`,
      `Keep exact scene composition, character positions, poses, actions, camera movement, and timing identical to the input video.`,
      `STYLE: Polished modern 3D anime rendering (Makoto Shinkai / high-end Japanese 3D CG anime cinema), subsurface skin scattering, sculpted layered 3D anime hair strands, crisp cloth weave textures, volumetric cinematic lighting, soft depth of field. ${overallStyleNotes}`,
      `STRICT CHARACTER CONSISTENCY (do NOT alter faces, hairstyles, outfits, body proportions, or colors): ${charLockBlock}`,
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
        stage_detail: `Extracting keyframes across ${metadata.durationSec.toFixed(1)}s and separating original audio stream...`,
        estimated_seconds_remaining: null,
      });

      const extractedAudioPath = path.join(jobDir, 'original_audio.m4a');
      if (metadata.hasAudio) {
        const ok = await extractOriginalAudio(rawJob.input_path, extractedAudioPath);
        audioPath = ok ? extractedAudioPath : null;
      } else {
        audioPath = null;
      }

      const frames = await extractKeyframes(rawJob.input_path, framesDir, metadata.durationSec);
      lastCompletedStage = 2;
      updateJobFields(jobId, {
        audio_path: audioPath,
        last_completed_stage: 2,
        progress: 20,
        stage_detail: `Extracted ${frames.length} keyframes${audioPath ? ' and original audio track' : ''}.`,
      });
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
        stage_detail: 'Gemini analyzing every scene, character trait, expression, movement, and background...',
      });

      const analysisPrompt = `Analyze the ENTIRE uploaded 2D cartoon video from 0.0s to ${metadata.durationSec.toFixed(2)}s (not just the first frame).
1. Identify EVERY recurring character across the complete video and create a strict visual consistency sheet for each:
   - characterId (e.g. "CHAR_01", "CHAR_02")
   - name (descriptive name or role)
   - facialFeatures, hairStyleAndColor, eyeShapeAndColor, clothingAndAccessories, bodyProportions, colorPalette, distinctiveFeatures
   - bestFrameTimestampSec: the exact timestamp in seconds (between 0 and ${Math.max(0.2, metadata.durationSec - 0.2).toFixed(2)}) where this character's face and outfit are most clearly visible.
2. Segment the ENTIRE video chronologically into natural scenes covering 0.0s to ${metadata.durationSec.toFixed(2)}s (each scene ideally 4 to 9 seconds long, no missing seconds):
   - startSec, endSec
   - summary, expressionsAndActions, cameraAndMovement, backgroundAndLighting
   - characterIds: array of characterId values visible in that scene.
3. Provide overallStyleNotes describing cohesive 3D Anime cinematic lighting, palette harmony, and environmental textures suitable for the entire video.`;

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
        stage_detail: `Generating 3D Anime reference sheets for ${characters.length} detected character(s)...`,
      });

      const charsToProcess = characters.slice(0, 4);
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
          const sourceB64 = fs.readFileSync(sourcePath).toString('base64');
          const refPrompt = `Transform the character "${char.name}" (${char.characterId}) shown in this 2D cartoon frame into a clean, high-budget 3D CG Anime character reference portrait on a neutral soft studio background.
Preserve exact identity and visual traits strictly:
- Facial features: ${char.facialFeatures}
- Hair: ${char.hairStyleAndColor}
- Eyes: ${char.eyeShapeAndColor}
- Clothing & accessories: ${char.clothingAndAccessories}
- Proportions: ${char.bodyProportions}
- Colors: ${char.colorPalette}
- Distinctive features: ${char.distinctiveFeatures}
Render with theatrical 3D anime skin subsurface scattering, sculpted hair strands, fabric textures, and crisp neutral reference lighting.`;

          const refImgRes = await withModelFailover(
            `3D anime reference for ${char.name}`,
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
          }
        }

        const pct = 45 + Math.round(((i + 1) / Math.max(1, charsToProcess.length)) * 8);
        updateJobFields(jobId, {
          progress: pct,
          stage_detail: `Created 3D Anime consistency profile ${i + 1} of ${charsToProcess.length} (${char.name}).`,
        });
      }

      characters = getCharactersForJob(jobId);
      lastCompletedStage = 5;
      updateJobFields(jobId, {
        last_completed_stage: 5,
        progress: 53,
        stage_detail: 'Persistent 3D Anime character reference profiles ready.',
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
        stage_detail: 'Segmenting source timeline into chronological scenes and locking character consistency prompts...',
      });

      const builtScenes = buildConsistentScenes(
        analysis?.scenes ?? [],
        metadata.durationSec,
        characters,
        analysis?.overallStyleNotes ?? ''
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
    // STAGE 7: Google Veo (gemini-omni-1.2-flash) generating 3D Anime scenes
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
          stage_detail: `Veo generating 3D Anime scene ${i + 1} of ${scenes.length} (${scene.startSec.toFixed(1)}s – ${scene.endSec.toFixed(1)}s)...`,
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
        stage_detail: `All ${scenes.length} 3D Anime scene clip(s) generated by Veo.`,
      });
    }

    // =========================================================================
    // STAGE 8, 9, 10: Validate, normalize, combine scenes, sync audio, render MP4
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
      stage_detail: `Completed 3D Anime MP4 (${outputMetadata.width}x${outputMetadata.height}, ${outputMetadata.durationSec.toFixed(1)}s).`,
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
