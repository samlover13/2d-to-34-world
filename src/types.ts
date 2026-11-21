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

export type VisualStyleId =
  | 'pixar_3d'
  | 'stylized_3d'
  | 'cel_shaded_npr'
  | 'low_poly'
  | 'chibi_sd'
  | 'stop_motion_clay';

export interface VisualStyleOption {
  id: VisualStyleId;
  name: string;
  tagline: string;
  description: string;
}

export const VISUAL_STYLE_OPTIONS: readonly VisualStyleOption[] = [
  {
    id: 'pixar_3d',
    name: 'Classic / Pixar-Inspired 3D',
    tagline: 'Rich lighting · Detailed textures',
    description:
      'Features expressive proportions, rich lighting, and detailed textures while keeping a clearly cartoon aesthetic.',
  },
  {
    id: 'stylized_3d',
    name: 'Stylized 3D',
    tagline: 'Bold colors · Simplified shapes',
    description:
      'Uses exaggerated anatomy, bold colors, and simplified shapes for high visual clarity and personality.',
  },
  {
    id: 'cel_shaded_npr',
    name: 'Cel-Shaded / Non-Photorealistic (NPR)',
    tagline: 'Flat color blocks · Crisp outlines',
    description:
      'Renders 3D models with flat color blocks and outlines to mimic 2D hand-drawn or comic-book art.',
  },
  {
    id: 'low_poly',
    name: 'Low Poly',
    tagline: 'Minimal polygons · Sharp facets',
    description:
      'Relies on minimal polygons and sharp geometric facets for a clean, blocky, or minimalist look.',
  },
  {
    id: 'chibi_sd',
    name: 'Chibi / Super-Deformed',
    tagline: 'Large heads · Compact limbs',
    description:
      'Shrinks body proportions with large heads and small limbs for cute, comedic characters.',
  },
  {
    id: 'stop_motion_clay',
    name: 'Stop-Motion / Clay-Inspired 3D',
    tagline: 'Handcrafted clay · Tactile motion',
    description:
      'Digitally replicates physical clay, puppet, or tactile handcrafted textures and frame motion.',
  },
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
  visualStyle: VisualStyleId;
  visualStyleLabel: string;
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
