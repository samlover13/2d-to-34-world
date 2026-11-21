export const PIPELINE_STAGES = [
  { id: 1, key: 'uploading', label: 'Uploading video' },
  { id: 2, key: 'extracting_frames', label: 'Extracting frames' },
  { id: 3, key: 'gemini_analyzing', label: 'Gemini analyzing video' },
  { id: 4, key: 'detecting_characters', label: 'Detecting characters' },
  { id: 5, key: 'character_profiles', label: 'Creating character reference profiles' },
  { id: 6, key: 'detecting_scenes', label: 'Detecting scenes and movements' },
  { id: 7, key: 'veo_generating', label: 'Veo generating 3D Anime scenes' },
  { id: 8, key: 'combining_scenes', label: 'Combining generated scenes' },
  { id: 9, key: 'syncing_audio', label: 'Synchronizing original audio' },
  { id: 10, key: 'rendering_mp4', label: 'Rendering final MP4' },
] as const;

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type SceneStatus = 'pending' | 'generating' | 'completed' | 'failed';
export type AppScreen = 'home' | 'processing' | 'result' | 'history' | 'deliverables';

export interface VideoMetadata {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  orientation: 'portrait' | 'landscape';
  codec: string;
  fileSizeBytes: number;
}

export interface CharacterProfile {
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
  sourceFaceAsset?: string;
  animeRefAsset?: string;
}

export interface SceneSegment {
  sceneIndex: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  summary: string;
  expressionsAndActions: string;
  cameraAndMovement: string;
  backgroundAndLighting: string;
  characterIds: string[];
  conversionPrompt: string;
  status: SceneStatus;
  keyframeAsset?: string;
  clipPath?: string;
  errorMessage?: string;
  durationMs?: number;
}

export interface ConversionJob {
  jobId: string;
  originalFilename: string;
  status: JobStatus;
  progress: number;
  currentStage: number;
  currentStageLabel: string;
  lastCompletedStage: number;
  stageDetail: string;
  estimatedSecondsRemaining: number | null;
  errorMessage: string | null;
  resumable: boolean;
  metadata: VideoMetadata;
  characters: CharacterProfile[];
  scenes: SceneSegment[];
  hasOutputVideo: boolean;
  outputMetadata: VideoMetadata | null;
  createdAt: string;
  updatedAt: string;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

export function formatTimeShort(seconds: number): string {
  return `${seconds.toFixed(1)}s`;
}
