import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  CharacterProfile,
  DEFAULT_VISUAL_STYLE,
  JobResponse,
  JobStatus,
  PIPELINE_STAGES,
  SceneSegment,
  SceneStatus,
  VideoMetadata,
  VisualStyleId,
  resolveVisualStyle,
} from './types.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'cartoon_ai_studio.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    job_id TEXT PRIMARY KEY,
    original_filename TEXT NOT NULL,
    visual_style TEXT NOT NULL DEFAULT 'pixar_3d',
    input_path TEXT NOT NULL,
    audio_path TEXT,
    output_path TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    current_stage INTEGER NOT NULL DEFAULT 1,
    last_completed_stage INTEGER NOT NULL DEFAULT 0,
    stage_detail TEXT NOT NULL DEFAULT '',
    estimated_seconds_remaining INTEGER,
    error_message TEXT,
    metadata_json TEXT NOT NULL,
    output_metadata_json TEXT,
    analysis_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    character_id TEXT NOT NULL,
    name TEXT NOT NULL,
    facial_features TEXT NOT NULL,
    hair_style_and_color TEXT NOT NULL,
    eye_shape_and_color TEXT NOT NULL,
    clothing_and_accessories TEXT NOT NULL,
    body_proportions TEXT NOT NULL,
    color_palette TEXT NOT NULL,
    distinctive_features TEXT NOT NULL,
    best_frame_timestamp_sec REAL NOT NULL DEFAULT 0,
    source_face_asset TEXT,
    anime_ref_asset TEXT,
    UNIQUE(job_id, character_id),
    FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS scenes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT NOT NULL,
    scene_index INTEGER NOT NULL,
    start_sec REAL NOT NULL,
    end_sec REAL NOT NULL,
    duration_sec REAL NOT NULL,
    summary TEXT NOT NULL,
    expressions_and_actions TEXT NOT NULL,
    camera_and_movement TEXT NOT NULL,
    background_and_lighting TEXT NOT NULL,
    character_ids_json TEXT NOT NULL,
    conversion_prompt TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    keyframe_asset TEXT,
    clip_path TEXT,
    error_message TEXT,
    duration_ms INTEGER,
    UNIQUE(job_id, scene_index),
    FOREIGN KEY (job_id) REFERENCES jobs(job_id) ON DELETE CASCADE
  );
`);

// Safe schema migration for existing SQLite databases created prior to visual_style support
const existingCols = db.prepare("PRAGMA table_info('jobs')").all() as Array<{ name: string }>;
if (!existingCols.some((col) => col.name === 'visual_style')) {
  db.exec(`ALTER TABLE jobs ADD COLUMN visual_style TEXT NOT NULL DEFAULT '${DEFAULT_VISUAL_STYLE}'`);
}

export interface RawJobRow {
  job_id: string;
  original_filename: string;
  visual_style: string;
  input_path: string;
  audio_path: string | null;
  output_path: string | null;
  status: JobStatus;
  progress: number;
  current_stage: number;
  last_completed_stage: number;
  stage_detail: string;
  estimated_seconds_remaining: number | null;
  error_message: string | null;
  metadata_json: string;
  output_metadata_json: string | null;
  analysis_json: string | null;
  created_at: string;
  updated_at: string;
}

interface RawCharacterRow {
  character_id: string;
  name: string;
  facial_features: string;
  hair_style_and_color: string;
  eye_shape_and_color: string;
  clothing_and_accessories: string;
  body_proportions: string;
  color_palette: string;
  distinctive_features: string;
  best_frame_timestamp_sec: number;
  source_face_asset: string | null;
  anime_ref_asset: string | null;
}

interface RawSceneRow {
  scene_index: number;
  start_sec: number;
  end_sec: number;
  duration_sec: number;
  summary: string;
  expressions_and_actions: string;
  camera_and_movement: string;
  background_and_lighting: string;
  character_ids_json: string;
  conversion_prompt: string;
  status: SceneStatus;
  keyframe_asset: string | null;
  clip_path: string | null;
  error_message: string | null;
  duration_ms: number | null;
}

export function createJobRecord(params: {
  jobId: string;
  originalFilename: string;
  visualStyle: VisualStyleId;
  inputPath: string;
  metadata: VideoMetadata;
}): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO jobs (
      job_id, original_filename, visual_style, input_path, status, progress,
      current_stage, last_completed_stage, stage_detail,
      metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'queued', 5, 1, 1, 'Video validated and queued for frame extraction.', ?, ?, ?)`
  ).run(
    params.jobId,
    params.originalFilename,
    params.visualStyle,
    params.inputPath,
    JSON.stringify(params.metadata),
    now,
    now
  );
}

export function updateJobFields(
  jobId: string,
  fields: Partial<{
    audio_path: string | null;
    output_path: string | null;
    status: JobStatus;
    progress: number;
    current_stage: number;
    last_completed_stage: number;
    stage_detail: string;
    estimated_seconds_remaining: number | null;
    error_message: string | null;
    output_metadata_json: string | null;
    analysis_json: string | null;
  }>
): void {
  const allowedKeys = [
    'audio_path',
    'output_path',
    'status',
    'progress',
    'current_stage',
    'last_completed_stage',
    'stage_detail',
    'estimated_seconds_remaining',
    'error_message',
    'output_metadata_json',
    'analysis_json',
  ] as const;

  const assignments: string[] = [];
  const values: unknown[] = [];

  for (const key of allowedKeys) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      assignments.push(`${key} = ?`);
      values.push(fields[key]);
    }
  }
  if (assignments.length === 0) return;

  assignments.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(jobId);

  db.prepare(`UPDATE jobs SET ${assignments.join(', ')} WHERE job_id = ?`).run(...values);
}

export function getRawJob(jobId: string): RawJobRow | undefined {
  return db.prepare('SELECT * FROM jobs WHERE job_id = ?').get(jobId) as RawJobRow | undefined;
}

export function upsertCharacters(jobId: string, characters: CharacterProfile[]): void {
  const stmt = db.prepare(`
    INSERT INTO characters (
      job_id, character_id, name, facial_features, hair_style_and_color,
      eye_shape_and_color, clothing_and_accessories, body_proportions,
      color_palette, distinctive_features, best_frame_timestamp_sec,
      source_face_asset, anime_ref_asset
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id, character_id) DO UPDATE SET
      name = excluded.name,
      facial_features = excluded.facial_features,
      hair_style_and_color = excluded.hair_style_and_color,
      eye_shape_and_color = excluded.eye_shape_and_color,
      clothing_and_accessories = excluded.clothing_and_accessories,
      body_proportions = excluded.body_proportions,
      color_palette = excluded.color_palette,
      distinctive_features = excluded.distinctive_features,
      best_frame_timestamp_sec = excluded.best_frame_timestamp_sec,
      source_face_asset = COALESCE(excluded.source_face_asset, characters.source_face_asset),
      anime_ref_asset = COALESCE(excluded.anime_ref_asset, characters.anime_ref_asset)
  `);

  const tx = db.transaction((list: CharacterProfile[]) => {
    for (const c of list) {
      stmt.run(
        jobId,
        c.characterId,
        c.name,
        c.facialFeatures,
        c.hairStyleAndColor,
        c.eyeShapeAndColor,
        c.clothingAndAccessories,
        c.bodyProportions,
        c.colorPalette,
        c.distinctiveFeatures,
        c.bestFrameTimestampSec,
        c.sourceFaceAsset ?? null,
        c.animeRefAsset ?? null
      );
    }
  });
  tx(characters);
}

export function updateCharacterAssets(
  jobId: string,
  characterId: string,
  sourceFaceAsset?: string,
  animeRefAsset?: string
): void {
  db.prepare(
    `UPDATE characters
     SET source_face_asset = COALESCE(?, source_face_asset),
         anime_ref_asset = COALESCE(?, anime_ref_asset)
     WHERE job_id = ? AND character_id = ?`
  ).run(sourceFaceAsset ?? null, animeRefAsset ?? null, jobId, characterId);
}

export function getCharactersForJob(jobId: string): CharacterProfile[] {
  const rows = db
    .prepare('SELECT * FROM characters WHERE job_id = ? ORDER BY id ASC')
    .all(jobId) as RawCharacterRow[];

  return rows.map((r) => ({
    characterId: r.character_id,
    name: r.name,
    facialFeatures: r.facial_features,
    hairStyleAndColor: r.hair_style_and_color,
    eyeShapeAndColor: r.eye_shape_and_color,
    clothingAndAccessories: r.clothing_and_accessories,
    bodyProportions: r.body_proportions,
    colorPalette: r.color_palette,
    distinctiveFeatures: r.distinctive_features,
    bestFrameTimestampSec: r.best_frame_timestamp_sec,
    sourceFaceAsset: r.source_face_asset ?? undefined,
    animeRefAsset: r.anime_ref_asset ?? undefined,
  }));
}

export function upsertScenes(jobId: string, scenes: SceneSegment[]): void {
  const stmt = db.prepare(`
    INSERT INTO scenes (
      job_id, scene_index, start_sec, end_sec, duration_sec,
      summary, expressions_and_actions, camera_and_movement,
      background_and_lighting, character_ids_json, conversion_prompt,
      status, keyframe_asset, clip_path, error_message, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id, scene_index) DO UPDATE SET
      start_sec = excluded.start_sec,
      end_sec = excluded.end_sec,
      duration_sec = excluded.duration_sec,
      summary = excluded.summary,
      expressions_and_actions = excluded.expressions_and_actions,
      camera_and_movement = excluded.camera_and_movement,
      background_and_lighting = excluded.background_and_lighting,
      character_ids_json = excluded.character_ids_json,
      conversion_prompt = excluded.conversion_prompt,
      keyframe_asset = COALESCE(excluded.keyframe_asset, scenes.keyframe_asset)
  `);

  const tx = db.transaction((list: SceneSegment[]) => {
    for (const s of list) {
      stmt.run(
        jobId,
        s.sceneIndex,
        s.startSec,
        s.endSec,
        s.durationSec,
        s.summary,
        s.expressionsAndActions,
        s.cameraAndMovement,
        s.backgroundAndLighting,
        JSON.stringify(s.characterIds),
        s.conversionPrompt,
        s.status,
        s.keyframeAsset ?? null,
        s.clipPath ?? null,
        s.errorMessage ?? null,
        s.durationMs ?? null
      );
    }
  });
  tx(scenes);
}

export function updateSceneState(
  jobId: string,
  sceneIndex: number,
  fields: Partial<{
    status: SceneStatus;
    keyframeAsset: string | null;
    clipPath: string | null;
    errorMessage: string | null;
    durationMs: number | null;
  }>
): void {
  const assignments: string[] = [];
  const values: unknown[] = [];

  if (fields.status !== undefined) {
    assignments.push('status = ?');
    values.push(fields.status);
  }
  if (fields.keyframeAsset !== undefined) {
    assignments.push('keyframe_asset = ?');
    values.push(fields.keyframeAsset);
  }
  if (fields.clipPath !== undefined) {
    assignments.push('clip_path = ?');
    values.push(fields.clipPath);
  }
  if (fields.errorMessage !== undefined) {
    assignments.push('error_message = ?');
    values.push(fields.errorMessage);
  }
  if (fields.durationMs !== undefined) {
    assignments.push('duration_ms = ?');
    values.push(fields.durationMs);
  }
  if (assignments.length === 0) return;

  values.push(jobId, sceneIndex);
  db.prepare(`UPDATE scenes SET ${assignments.join(', ')} WHERE job_id = ? AND scene_index = ?`).run(
    ...values
  );
}

export function getScenesForJob(jobId: string): SceneSegment[] {
  const rows = db
    .prepare('SELECT * FROM scenes WHERE job_id = ? ORDER BY scene_index ASC')
    .all(jobId) as RawSceneRow[];

  return rows.map((r) => ({
    sceneIndex: r.scene_index,
    startSec: r.start_sec,
    endSec: r.end_sec,
    durationSec: r.duration_sec,
    summary: r.summary,
    expressionsAndActions: r.expressions_and_actions,
    cameraAndMovement: r.camera_and_movement,
    backgroundAndLighting: r.background_and_lighting,
    characterIds: JSON.parse(r.character_ids_json || '[]') as string[],
    conversionPrompt: r.conversion_prompt,
    status: r.status,
    keyframeAsset: r.keyframe_asset ?? undefined,
    clipPath: r.clip_path ?? undefined,
    errorMessage: r.error_message ?? undefined,
    durationMs: r.duration_ms ?? undefined,
  }));
}

function hydrateJob(row: RawJobRow): JobResponse {
  const stageDef =
    PIPELINE_STAGES.find((s) => s.id === row.current_stage) ?? PIPELINE_STAGES[0];
  const styleDef = resolveVisualStyle(row.visual_style);
  const characters = getCharactersForJob(row.job_id);
  const scenes = getScenesForJob(row.job_id);
  const hasOutputVideo = Boolean(row.output_path && fs.existsSync(row.output_path));

  return {
    jobId: row.job_id,
    originalFilename: row.original_filename,
    visualStyle: styleDef.id,
    visualStyleLabel: styleDef.name,
    status: row.status,
    progress: row.progress,
    currentStage: row.current_stage,
    currentStageLabel: stageDef.label,
    lastCompletedStage: row.last_completed_stage,
    stageDetail: row.stage_detail,
    estimatedSecondsRemaining: row.estimated_seconds_remaining,
    errorMessage: row.error_message,
    resumable: row.status === 'failed' && fs.existsSync(row.input_path),
    metadata: JSON.parse(row.metadata_json) as VideoMetadata,
    characters,
    scenes,
    hasOutputVideo,
    outputMetadata: row.output_metadata_json
      ? (JSON.parse(row.output_metadata_json) as VideoMetadata)
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getJobResponse(jobId: string): JobResponse | null {
  const row = getRawJob(jobId);
  if (!row) return null;
  return hydrateJob(row);
}

export function listRecentJobs(limit = 20): JobResponse[] {
  const rows = db
    .prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?')
    .all(limit) as RawJobRow[];
  return rows.map(hydrateJob);
}

export function markInterruptedJobsResumable(): void {
  db.prepare(
    `UPDATE jobs
     SET status = 'failed',
         error_message = 'Server restarted during processing. Resume from the last completed stage.',
         updated_at = ?
     WHERE status IN ('queued', 'processing')`
  ).run(new Date().toISOString());
}
