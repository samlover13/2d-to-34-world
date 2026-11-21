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

export interface JobResponse {
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
