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

export interface VisualStyleDefinition {
  id: VisualStyleId;
  name: string;
  description: string;
  analysisGuidance: string;
  characterRefDirective: string;
  videoSceneDirective: string;
}

export const VISUAL_STYLES: readonly VisualStyleDefinition[] = [
  {
    id: 'pixar_3d',
    name: 'Classic / Pixar-Inspired 3D',
    description:
      'Expressive proportions, rich global illumination, and detailed tactile textures with a classic animated film aesthetic.',
    analysisGuidance:
      'Classic Pixar-inspired theatrical 3D CG animation with expressive character proportions, soft subsurface skin scattering, finely woven fabrics, rich volumetric global illumination, and cinematic depth of field.',
    characterRefDirective:
      'Render in Classic Pixar-Inspired 3D animated film style: expressive rounded cartoon-3D proportions, soft subsurface scattering on skin, finely groomed 3D hair strands, detailed stitched cloth weave, warm cinematic studio three-point lighting.',
    videoSceneDirective:
      'CLASSIC / PIXAR-INSPIRED 3D ANIMATED FILM STYLE: Theatrical 3D CG animation with expressive proportions, soft subsurface skin scattering, rich global illumination, realistic fabric/hair/surface micro-textures, warm volumetric light, and smooth cinematic motion while retaining a clearly animated aesthetic.',
  },
  {
    id: 'stylized_3d',
    name: 'Stylized 3D',
    description:
      'Exaggerated silhouettes, bold saturated colors, and clean simplified shapes for high visual clarity and personality.',
    analysisGuidance:
      'Modern Stylized 3D animation featuring bold color contrast, exaggerated appealing anatomy, crisp simplified geometric silhouettes, hand-painted sculptural brush textures, and punchy rim lighting.',
    characterRefDirective:
      'Render in Modern Stylized 3D style: exaggerated appealing anatomy and strong silhouette clarity, bold vibrant saturated colors, clean sculpted shapes with subtle painterly surface shading and crisp rim highlights.',
    videoSceneDirective:
      'STYLIZED 3D ANIMATION STYLE: Bold saturated color palette, exaggerated expressive anatomy, simplified clean sculpted shapes, subtle hand-painted 3D surface textures, crisp silhouette readability, dynamic rim lighting, and energetic snappy animation.',
  },
  {
    id: 'cel_shaded_npr',
    name: 'Cel-Shaded / Non-Photorealistic (NPR)',
    description:
      '3D models rendered with flat stepped color blocks and crisp outlines to evoke hand-drawn anime or comic-book art.',
    analysisGuidance:
      '3D Cel-Shaded / Non-Photorealistic (NPR) anime rendering with crisp variable-weight ink outlines, stepped 2-tone cel shadows, flat vivid color blocks, halftone or screen-tone accents, and true 3D camera parallax.',
    characterRefDirective:
      'Render in 3D Cel-Shaded Non-Photorealistic (NPR) style: true 3D sculpted volume shaded with flat vivid color blocks, sharp stepped cel shadows, crisp black ink contour outlines, and clean comic/anime specular highlights.',
    videoSceneDirective:
      'CEL-SHADED / NON-PHOTOREALISTIC (NPR) 3D ANIME STYLE: True 3D geometry rendered with sharp stepped cel-shading, flat bold color blocks, crisp dark comic/anime ink outlines around silhouettes and creases, stylized specular highlights, and dynamic 3D camera depth.',
  },
  {
    id: 'low_poly',
    name: 'Low Poly',
    description:
      'Minimal polygons and crisp geometric facets for a clean, sculptural, indie-game inspired minimalist 3D look.',
    analysisGuidance:
      'Artistic Low Poly 3D animation built from crisp flat-shaded triangular and quad geometric facets, minimal polygon counts, clean matte color gradients per facet, and soft directional studio lighting.',
    characterRefDirective:
      'Render in Low Poly 3D style: sculpted from clean minimal polygon meshes with clearly visible sharp geometric facets, flat-shaded color blocks per polygon face, crisp edges, and charming minimalist 3D character design.',
    videoSceneDirective:
      'LOW POLY 3D STYLE: Minimal-polygon 3D models and environments with clearly visible crisp geometric facets, flat-shaded polygonal surfaces, clean architectural simplicity, soft ambient occlusion, and vibrant stylized directional lighting.',
  },
  {
    id: 'chibi_sd',
    name: 'Chibi / Super-Deformed',
    description:
      'Cute super-deformed 3D proportions with oversized expressive heads and compact limbs for playful, comedic appeal.',
    analysisGuidance:
      '3D Chibi / Super-Deformed anime style translating characters into adorable 2-head-tall proportions with oversized expressive eyes, rounded cheeks, compact hands and feet, glossy toy-like 3D shaders, and lively bouncy animation.',
    characterRefDirective:
      'Render in 3D Chibi / Super-Deformed style: transform proportions into cute 2-to-2.5-head-tall chibi anatomy with an oversized expressive head, huge luminous anime eyes, tiny compact limbs, soft vinyl-like 3D shading, while strictly preserving exact hair, outfit, and colors.',
    videoSceneDirective:
      'CHIBI / SUPER-DEFORMED 3D ANIME STYLE: Cute super-deformed proportions (oversized expressive heads, large sparkling eyes, compact limbs), plush high-craft 3D anime rendering, cheerful bright cinematic lighting, and lively playful comedic motion while preserving every character identity and outfit.',
  },
  {
    id: 'stop_motion_clay',
    name: 'Stop-Motion / Clay-Inspired 3D',
    description:
      'Replicates handcrafted physical clay, felt puppets, miniature diorama sets, and tactile stop-motion frame cadence.',
    analysisGuidance:
      'Handcrafted Stop-Motion / Clay-Inspired 3D animation featuring sculpted plasticine clay surfaces with subtle thumbprint imperfections, stitched felt fabrics, miniature practical studio lighting, shallow macro depth of field, and authentic 12fps-feel stop-motion cadence.',
    characterRefDirective:
      'Render in Stop-Motion / Clay-Inspired 3D style: handcrafted sculpted matte modeling clay and wool-felt puppet textures, subtle artisanal fingerprint tooling marks, tiny stitched cloth details, warm miniature tabletop studio lighting with shallow macro depth of field.',
    videoSceneDirective:
      'STOP-MOTION / CLAY-INSPIRED 3D STYLE: Digital stop-motion cinema replicating handcrafted plasticine clay characters, tactile subtle fingerprint textures, stitched felt clothing, miniature physical diorama lighting with shallow macro depth of field, and authentic tactile stop-motion frame cadence.',
  },
] as const;

export const DEFAULT_VISUAL_STYLE: VisualStyleId = 'pixar_3d';

export function resolveVisualStyle(raw?: string | null): VisualStyleDefinition {
  const found = VISUAL_STYLES.find((s) => s.id === raw);
  return found ?? VISUAL_STYLES[0];
}

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
