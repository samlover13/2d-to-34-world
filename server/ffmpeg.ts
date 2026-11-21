import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { VideoMetadata } from './types.ts';

const execFileAsync = promisify(execFile);

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: {
    duration?: string;
    size?: string;
  };
}

function parseFrameRate(raw?: string): number {
  if (!raw || raw === '0/0') return 24;
  const parts = raw.split('/');
  if (parts.length === 2) {
    const num = Number(parts[0]);
    const den = Number(parts[1]);
    if (den > 0 && Number.isFinite(num / den) && num / den > 0) {
      return Math.round((num / den) * 100) / 100;
    }
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 24;
}

export async function probeVideo(filePath: string): Promise<VideoMetadata> {
  const { stdout } = await execFileAsync(
    'ffprobe',
    [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ],
    { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }
  );

  const parsed = JSON.parse(stdout) as FfprobeOutput;
  const streams = parsed.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');

  if (!videoStream || !videoStream.width || !videoStream.height) {
    throw new Error('The uploaded file does not contain a valid video stream.');
  }

  const durationSec = Number(parsed.format?.duration ?? videoStream.duration ?? 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error('Could not determine video duration. Please upload a valid MP4 or MOV file.');
  }

  const stats = fs.statSync(filePath);
  const width = videoStream.width;
  const height = videoStream.height;

  return {
    durationSec: Math.round(durationSec * 100) / 100,
    width,
    height,
    fps: parseFrameRate(videoStream.avg_frame_rate || videoStream.r_frame_rate),
    hasAudio: Boolean(audioStream),
    orientation: height > width ? 'portrait' : 'landscape',
    codec: videoStream.codec_name ?? 'unknown',
    fileSizeBytes: stats.size,
  };
}

export async function extractOriginalAudio(
  inputPath: string,
  audioOutPath: string
): Promise<boolean> {
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        inputPath,
        '-vn',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        audioOutPath,
      ],
      { timeout: 120000 }
    );
    return fs.existsSync(audioOutPath) && fs.statSync(audioOutPath).size > 0;
  } catch {
    return false;
  }
}

export async function extractKeyframes(
  inputPath: string,
  framesDir: string,
  durationSec: number
): Promise<string[]> {
  fs.mkdirSync(framesDir, { recursive: true });
  // Sample evenly across the full duration (up to 12 frames) so every part of a 60s clip is covered
  const targetCount = Math.min(12, Math.max(3, Math.ceil(durationSec / 4)));
  const interval = durationSec / targetCount;
  const extracted: string[] = [];

  for (let i = 0; i < targetCount; i++) {
    const ts = Math.min(Math.max(0.1, i * interval + interval * 0.25), Math.max(0.1, durationSec - 0.15));
    const outPath = path.join(framesDir, `frame_${String(i).padStart(2, '0')}.jpg`);
    await extractFrameAt(inputPath, ts, outPath);
    if (fs.existsSync(outPath)) {
      extracted.push(outPath);
    }
  }
  return extracted;
}

export async function extractFrameAt(
  inputPath: string,
  timestampSec: number,
  outPath: string
): Promise<void> {
  const safeTs = Math.max(0, timestampSec).toFixed(3);
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-ss',
      safeTs,
      '-i',
      inputPath,
      '-frames:v',
      '1',
      '-q:v',
      '2',
      outPath,
    ],
    { timeout: 30000 }
  );
}

export async function sliceSceneVideo(
  inputPath: string,
  startSec: number,
  durationSec: number,
  outPath: string
): Promise<void> {
  const safeStart = Math.max(0, startSec).toFixed(3);
  const safeDur = Math.max(0.5, durationSec).toFixed(3);
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-ss',
      safeStart,
      '-i',
      inputPath,
      '-t',
      safeDur,
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '22',
      '-pix_fmt',
      'yuv420p',
      '-an',
      '-movflags',
      '+faststart',
      outPath,
    ],
    { timeout: 120000 }
  );
}

export function getTargetDimensions(metadata: VideoMetadata): { width: number; height: number } {
  const minLongSide = 1280;
  const minShortSide = 720;
  if (metadata.orientation === 'portrait') {
    const aspect = metadata.width / metadata.height;
    const height = Math.max(minLongSide, metadata.height);
    const clampedH = Math.min(height, 1920);
    const width = Math.max(minShortSide, Math.round((clampedH * aspect) / 2) * 2);
    return {
      width: Math.min(width, 1080) - (Math.min(width, 1080) % 2),
      height: clampedH - (clampedH % 2),
    };
  } else {
    const aspect = metadata.width / metadata.height;
    const height = Math.max(minShortSide, Math.min(metadata.height, 1080));
    const evenH = height - (height % 2);
    const rawW = Math.round((evenH * aspect) / 2) * 2;
    const clampedW = Math.max(minLongSide, Math.min(rawW, 1920));
    return {
      width: clampedW - (clampedW % 2),
      height: evenH,
    };
  }
}

export async function normalizeClipToScene(
  inputClipPath: string,
  outputClipPath: string,
  targetWidth: number,
  targetHeight: number,
  targetDurationSec: number
): Promise<VideoMetadata> {
  const clipMeta = await probeVideo(inputClipPath);
  if (clipMeta.durationSec < 0.3) {
    throw new Error('Generated Veo scene clip is empty or shorter than 0.3 seconds.');
  }

  // Fit generated clip duration cleanly to target scene duration:
  // If generated clip is slightly shorter, gently stretch PTS (up to 1.35x) or clone tail frame to prevent black frames;
  // if longer, trim smoothly to targetDurationSec.
  const ptsFactor =
    clipMeta.durationSec < targetDurationSec
      ? Math.min(1.35, targetDurationSec / clipMeta.durationSec)
      : 1.0;

  const filters = [
    `setpts=${ptsFactor.toFixed(4)}*PTS`,
    `fps=24`,
    `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase`,
    `crop=${targetWidth}:${targetHeight}`,
    `setsar=1`,
    `format=yuv420p`,
  ];

  // If still slightly short after gentle PTS stretch, pad tail with last frame (never black frames)
  const expectedDur = clipMeta.durationSec * ptsFactor;
  if (expectedDur < targetDurationSec - 0.05) {
    const padSec = (targetDurationSec - expectedDur + 0.1).toFixed(3);
    filters.push(`tpad=stop_mode=clone:stop_duration=${padSec}`);
  }

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputClipPath,
      '-vf',
      filters.join(','),
      '-t',
      targetDurationSec.toFixed(3),
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-an',
      outputClipPath,
    ],
    { timeout: 180000 }
  );

  return probeVideo(outputClipPath);
}

export async function combineScenesAndMuxAudio(params: {
  normalizedClipPaths: string[];
  originalAudioPath: string | null;
  combinedSilentPath: string;
  finalMp4Path: string;
  targetDurationSec: number;
  onStageSyncAudio?: () => void;
  onStageRenderFinal?: () => void;
}): Promise<VideoMetadata> {
  const {
    normalizedClipPaths,
    originalAudioPath,
    combinedSilentPath,
    finalMp4Path,
    targetDurationSec,
    onStageSyncAudio,
    onStageRenderFinal,
  } = params;

  if (normalizedClipPaths.length === 0) {
    throw new Error('No normalized scene clips available to combine.');
  }

  // Stage 8: Concatenate all normalized scenes in chronological order
  const concatListPath = `${combinedSilentPath}.txt`;
  const listContent = normalizedClipPaths
    .map((clipPath) => `file '${clipPath.replace(/'/g, "'\\''")}'`)
    .join('\n');
  fs.writeFileSync(concatListPath, listContent, 'utf8');

  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '19',
      '-pix_fmt',
      'yuv420p',
      '-an',
      combinedSilentPath,
    ],
    { timeout: 300000 }
  );

  // Stage 9: Synchronize original audio
  onStageSyncAudio?.();

  const hasValidAudio =
    Boolean(originalAudioPath) &&
    fs.existsSync(originalAudioPath!) &&
    fs.statSync(originalAudioPath!).size > 0;

  // Stage 10: Render final H.264 + AAC MP4 with faststart
  onStageRenderFinal?.();

  if (hasValidAudio && originalAudioPath) {
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        combinedSilentPath,
        '-i',
        originalAudioPath,
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'libx264',
        '-profile:v',
        'high',
        '-level',
        '4.1',
        '-preset',
        'medium',
        '-crf',
        '19',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-af',
        `apad=whole_dur=${targetDurationSec.toFixed(2)}`,
        '-shortest',
        '-movflags',
        '+faststart',
        finalMp4Path,
      ],
      { timeout: 300000 }
    );
  } else {
    // Provide a silent AAC track so players and Android MediaStore treat the MP4 as standard H.264/AAC
    await execFileAsync(
      'ffmpeg',
      [
        '-y',
        '-i',
        combinedSilentPath,
        '-f',
        'lavfi',
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=48000',
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-c:v',
        'libx264',
        '-profile:v',
        'high',
        '-level',
        '4.1',
        '-preset',
        'medium',
        '-crf',
        '19',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-shortest',
        '-movflags',
        '+faststart',
        finalMp4Path,
      ],
      { timeout: 300000 }
    );
  }

  return probeVideo(finalMp4Path);
}

export async function generateSample2DCartoonVideo(
  sampleImagePath: string,
  outVideoPath: string
): Promise<VideoMetadata> {
  fs.mkdirSync(path.dirname(outVideoPath), { recursive: true });
  // Create a crisp 6-second 1280x720 2D cartoon clip with animated camera pan/zoom + gentle melodic audio
  await execFileAsync(
    'ffmpeg',
    [
      '-y',
      '-loop',
      '1',
      '-i',
      sampleImagePath,
      '-f',
      'lavfi',
      '-i',
      'aevalsrc=0.14*sin(2*PI*392*t)*(0.5+0.5*cos(2*PI*0.75*t))+0.10*sin(2*PI*523.25*t)*(0.5+0.5*sin(2*PI*0.5*t)):s=48000:d=6',
      '-vf',
      "scale=1600:900,zoompan=z='min(zoom+0.0012,1.18)':x='iw/2-(iw/zoom/2)+sin(on/25)*35':y='ih/2-(ih/zoom/2)':d=144:s=1280x720:fps=24,format=yuv420p",
      '-t',
      '6',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '20',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-shortest',
      '-movflags',
      '+faststart',
      outVideoPath,
    ],
    { timeout: 60000 }
  );
  return probeVideo(outVideoPath);
}
