import json
import os
import re
import shutil
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Dict, List

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from database import (
    CharacterRecord,
    ConversionJob,
    SceneRecord,
    SessionLocal,
    init_db,
    utc_now_iso,
)
from ffmpeg_service import (
    combine_and_mux_final,
    extract_frame_at,
    extract_keyframes,
    extract_original_audio,
    normalize_clip,
    probe_video,
    slice_scene_video,
    target_dimensions,
)
from gcs_service import GCSMediaService
from gemini_veo_service import (
    analyze_full_cartoon_video,
    generate_3d_anime_character_reference,
    generate_veo_3d_anime_scene,
)

STAGE_LABELS = {
    1: "Uploading video",
    2: "Extracting frames",
    3: "Gemini analyzing video",
    4: "Detecting characters",
    5: "Creating character reference profiles",
    6: "Detecting scenes and movements",
    7: "Veo generating 3D Anime scenes",
    8: "Combining generated scenes",
    9: "Synchronizing original audio",
    10: "Rendering final MP4",
}

WORK_DIR = Path(os.getenv("WORK_DIR", "/tmp/cartoon_ai_studio")).resolve()
WORK_DIR.mkdir(parents=True, exist_ok=True)
ALLOWED_EXTS = {".mp4", ".mov"}
UUID_RE = re.compile(r"^[0-9a-f-]{36}$", re.IGNORECASE)
ASSET_RE = re.compile(r"^[a-zA-Z0-9._-]+$")

init_db()
gcs = GCSMediaService()
executor = ThreadPoolExecutor(max_workers=2)
app = FastAPI(title="Cartoon AI Studio API", version="1.0.0")


def serialize_job(job: ConversionJob) -> Dict:
    return {
        "jobId": job.job_id,
        "originalFilename": job.original_filename,
        "status": job.status,
        "progress": job.progress,
        "currentStage": job.current_stage,
        "currentStageLabel": STAGE_LABELS.get(job.current_stage, "Processing"),
        "lastCompletedStage": job.last_completed_stage,
        "stageDetail": job.stage_detail,
        "estimatedSecondsRemaining": job.estimated_seconds_remaining,
        "errorMessage": job.error_message,
        "resumable": job.status == "failed" and os.path.exists(job.input_path),
        "metadata": json.loads(job.metadata_json),
        "outputMetadata": json.loads(job.output_metadata_json) if job.output_metadata_json else None,
        "hasOutputVideo": bool(job.output_path and os.path.exists(job.output_path)),
        "characters": [
            {
                "characterId": c.character_id,
                "name": c.name,
                "facialFeatures": c.facial_features,
                "hairStyleAndColor": c.hair_style_and_color,
                "eyeShapeAndColor": c.eye_shape_and_color,
                "clothingAndAccessories": c.clothing_and_accessories,
                "bodyProportions": c.body_proportions,
                "colorPalette": c.color_palette,
                "distinctiveFeatures": c.distinctive_features,
                "bestFrameTimestampSec": c.best_frame_timestamp_sec,
                "sourceFaceAsset": c.source_face_asset,
                "animeRefAsset": c.anime_ref_asset,
            }
            for c in job.characters
        ],
        "scenes": [
            {
                "sceneIndex": s.scene_index,
                "startSec": s.start_sec,
                "endSec": s.end_sec,
                "durationSec": s.duration_sec,
                "summary": s.summary,
                "status": s.status,
                "characterIds": json.loads(s.character_ids_json or "[]"),
                "errorMessage": s.error_message,
            }
            for s in sorted(job.scenes, key=lambda x: x.scene_index)
        ],
        "createdAt": job.created_at,
        "updatedAt": job.updated_at,
    }


def _update_job(db, job: ConversionJob, **kwargs) -> None:
    for k, v in kwargs.items():
        setattr(job, k, v)
    job.updated_at = utc_now_iso()
    db.commit()


def run_resumable_pipeline(job_id: str) -> None:
    db = SessionLocal()
    try:
        job = db.query(ConversionJob).filter(ConversionJob.job_id == job_id).first()
        if not job:
            return

        metadata = json.loads(job.metadata_json)
        duration_sec = float(metadata["durationSec"])
        job_dir = WORK_DIR / job_id
        frames_dir = job_dir / "frames"
        assets_dir = job_dir / "assets"
        scenes_dir = job_dir / "scenes"
        for d in (frames_dir, assets_dir, scenes_dir):
            d.mkdir(parents=True, exist_ok=True)

        _update_job(db, job, status="processing", error_message=None)

        # Stage 2: Extract frames and original audio
        if job.last_completed_stage < 2:
            _update_job(db, job, current_stage=2, progress=14, stage_detail="Extracting keyframes and original audio...")
            audio_out = str(job_dir / "original_audio.m4a")
            has_audio = extract_original_audio(job.input_path, audio_out) if metadata.get("hasAudio") else False
            frames = extract_keyframes(job.input_path, str(frames_dir), duration_sec)
            for idx, fp in enumerate(frames):
                gcs.upload_file(fp, f"jobs/{job_id}/frames/frame_{idx:02d}.jpg", "image/jpeg")
            _update_job(
                db,
                job,
                audio_path=audio_out if has_audio else None,
                last_completed_stage=2,
                progress=22,
                stage_detail=f"Extracted {len(frames)} keyframes.",
            )

        # Stage 3 & 4: Gemini full-video analysis + character registry
        analysis = json.loads(job.analysis_json) if job.analysis_json else None
        if job.last_completed_stage < 4 or not analysis:
            _update_job(db, job, current_stage=3, progress=28, stage_detail="Gemini analyzing full video...")
            analysis = analyze_full_cartoon_video(job.input_path, duration_sec)
            _update_job(db, job, current_stage=4, progress=38, analysis_json=json.dumps(analysis), last_completed_stage=3)

            db.query(CharacterRecord).filter(CharacterRecord.job_id == job_id).delete()
            for idx, c in enumerate(analysis.get("characters", [])):
                db.add(
                    CharacterRecord(
                        job_id=job_id,
                        character_id=c.get("characterId", f"CHAR_{idx+1:02d}"),
                        name=c.get("name", f"Character {idx+1}"),
                        facial_features=c.get("facialFeatures", ""),
                        hair_style_and_color=c.get("hairStyleAndColor", ""),
                        eye_shape_and_color=c.get("eyeShapeAndColor", ""),
                        clothing_and_accessories=c.get("clothingAndAccessories", ""),
                        body_proportions=c.get("bodyProportions", ""),
                        color_palette=c.get("colorPalette", ""),
                        distinctive_features=c.get("distinctiveFeatures", ""),
                        best_frame_timestamp_sec=float(c.get("bestFrameTimestampSec", 0.2)),
                    )
                )
            _update_job(db, job, last_completed_stage=4, progress=42, stage_detail="Character registry saved.")

        # Stage 5: Create 3D Anime character reference profiles
        db.refresh(job)
        if job.last_completed_stage < 5:
            _update_job(db, job, current_stage=5, progress=46, stage_detail="Creating 3D Anime character portraits...")
            for char in job.characters[:4]:
                safe_id = re.sub(r"[^a-zA-Z0-9_-]", "_", char.character_id)
                src_name = f"char_{safe_id}_source.jpg"
                ref_name = f"char_{safe_id}_3d_ref.png"
                src_path = str(assets_dir / src_name)
                ref_path = str(assets_dir / ref_name)
                if not os.path.exists(src_path):
                    extract_frame_at(job.input_path, char.best_frame_timestamp_sec, src_path)
                    char.source_face_asset = src_name
                if not os.path.exists(ref_path):
                    ok = generate_3d_anime_character_reference(
                        src_path,
                        {
                            "characterId": char.character_id,
                            "name": char.name,
                            "facialFeatures": char.facial_features,
                            "hairStyleAndColor": char.hair_style_and_color,
                            "eyeShapeAndColor": char.eye_shape_and_color,
                            "clothingAndAccessories": char.clothing_and_accessories,
                            "bodyProportions": char.body_proportions,
                            "colorPalette": char.color_palette,
                            "distinctiveFeatures": char.distinctive_features,
                        },
                        ref_path,
                    )
                    if ok:
                        char.anime_ref_asset = ref_name
                        char.gcs_ref_uri = gcs.upload_file(ref_path, f"jobs/{job_id}/refs/{ref_name}", "image/png")
            _update_job(db, job, last_completed_stage=5, progress=54, stage_detail="Character references locked.")

        # Stage 6: Segment scenes covering full video duration
        db.refresh(job)
        if job.last_completed_stage < 6 or not job.scenes:
            _update_job(db, job, current_stage=6, progress=58, stage_detail="Building scene conversion prompts...")
            raw_scenes = analysis.get("scenes", []) or [
                {
                    "startSec": 0.0,
                    "endSec": duration_sec,
                    "summary": "Full cartoon sequence in 3D anime style.",
                    "expressionsAndActions": "Preserve original character expressions and motions.",
                    "cameraAndMovement": "Match original camera framing.",
                    "backgroundAndLighting": "Cinematic 3D anime lighting.",
                    "characterIds": [c.character_id for c in job.characters],
                }
            ]
            char_summary = " ".join(
                f"[{c.character_id} {c.name}: {c.facial_features}; {c.hair_style_and_color}; {c.clothing_and_accessories}; {c.color_palette}]"
                for c in job.characters
            )
            db.query(SceneRecord).filter(SceneRecord.job_id == job_id).delete()
            scene_idx = 0
            cursor = 0.0
            for raw in raw_scenes:
                seg_end = min(duration_sec, max(cursor + 3.0, float(raw.get("endSec", duration_sec))))
                while cursor < seg_end - 0.2:
                    piece = min(10.0, seg_end - cursor)
                    end_pt = min(duration_sec, cursor + piece)
                    prompt = (
                        "Convert this 2D cartoon scene to theatrical 3D CG Anime preserving exact motion and framing.\n"
                        f"CHARACTER CONSISTENCY: {char_summary}\n"
                        f"SCENE ({cursor:.1f}s-{end_pt:.1f}s): {raw.get('summary', '')}. "
                        f"Actions: {raw.get('expressionsAndActions', '')}. "
                        f"Lighting: {raw.get('backgroundAndLighting', '')}."
                    )
                    db.add(
                        SceneRecord(
                            job_id=job_id,
                            scene_index=scene_idx,
                            start_sec=round(cursor, 2),
                            end_sec=round(end_pt, 2),
                            duration_sec=round(max(3.0, end_pt - cursor), 2),
                            summary=raw.get("summary", ""),
                            expressions_and_actions=raw.get("expressionsAndActions", ""),
                            camera_and_movement=raw.get("cameraAndMovement", ""),
                            background_and_lighting=raw.get("backgroundAndLighting", ""),
                            character_ids_json=json.dumps(raw.get("characterIds", [])),
                            conversion_prompt=prompt,
                            status="pending",
                        )
                    )
                    scene_idx += 1
                    cursor = end_pt
            _update_job(db, job, last_completed_stage=6, progress=60, stage_detail=f"Prepared {scene_idx} scene(s).")

        # Stage 7: Veo scene generation with per-scene checkpointing
        db.refresh(job)
        scenes = sorted(job.scenes, key=lambda x: x.scene_index)
        if job.last_completed_stage < 7:
            aspect_ratio = "9:16" if metadata["orientation"] == "portrait" else "16:9"
            completed_times: List[int] = [s.duration_ms for s in scenes if s.duration_ms]
            for idx, scene in enumerate(scenes):
                if scene.status == "completed" and scene.clip_path and os.path.exists(scene.clip_path):
                    continue
                eta = (
                    int((sum(completed_times) / len(completed_times)) * (len(scenes) - idx) / 1000)
                    if completed_times
                    else None
                )
                scene.status = "generating"
                _update_job(
                    db,
                    job,
                    current_stage=7,
                    progress=60 + int((idx / max(1, len(scenes))) * 25),
                    estimated_seconds_remaining=eta,
                    stage_detail=f"Veo generating 3D Anime scene {idx+1} of {len(scenes)}...",
                )
                t0 = time.time()
                slice_path = str(scenes_dir / f"scene_{scene.scene_index:02d}_src.mp4")
                veo_out = str(scenes_dir / f"scene_{scene.scene_index:02d}_veo.mp4")
                slice_scene_video(job.input_path, scene.start_sec, max(0.8, scene.end_sec - scene.start_sec), slice_path)

                ref_paths = [
                    str(assets_dir / (c.anime_ref_asset or c.source_face_asset))
                    for c in job.characters
                    if (c.anime_ref_asset or c.source_face_asset)
                ]
                generate_veo_3d_anime_scene(
                    slice_path,
                    ref_paths,
                    scene.conversion_prompt,
                    aspect_ratio,
                    int(round(scene.duration_sec)),
                    veo_out,
                )
                elapsed_ms = int((time.time() - t0) * 1000)
                completed_times.append(elapsed_ms)
                scene.status = "completed"
                scene.clip_path = veo_out
                scene.gcs_clip_uri = gcs.upload_file(veo_out, f"jobs/{job_id}/clips/scene_{scene.scene_index:02d}.mp4", "video/mp4")
                scene.duration_ms = elapsed_ms
                db.commit()

            _update_job(db, job, last_completed_stage=7, progress=86, stage_detail="All Veo 3D Anime scenes generated.")

        # Stage 8, 9, 10: Normalize, combine, sync original audio, render final MP4
        _update_job(db, job, current_stage=8, progress=90, stage_detail="Combining generated scenes...")
        tw, th = target_dimensions(metadata)
        norm_clips: List[str] = []
        for scene in scenes:
            norm_out = str(scenes_dir / f"scene_{scene.scene_index:02d}_norm.mp4")
            normalize_clip(scene.clip_path, norm_out, tw, th, max(0.5, scene.end_sec - scene.start_sec))
            norm_clips.append(norm_out)

        _update_job(db, job, current_stage=9, last_completed_stage=8, progress=94, stage_detail="Synchronizing original audio...")
        final_mp4 = str(job_dir / "converted_3d_anime.mp4")
        silent_mp4 = str(job_dir / "combined_silent.mp4")
        _update_job(db, job, current_stage=10, last_completed_stage=9, progress=97, stage_detail="Rendering final H.264/AAC MP4...")
        out_meta = combine_and_mux_final(norm_clips, job.audio_path, silent_mp4, final_mp4, duration_sec)
        gcs_out_uri = gcs.upload_file(final_mp4, f"jobs/{job_id}/final/converted_3d_anime.mp4", "video/mp4")

        _update_job(
            db,
            job,
            status="completed",
            current_stage=10,
            last_completed_stage=10,
            progress=100,
            estimated_seconds_remaining=0,
            output_path=final_mp4,
            gcs_output_uri=gcs_out_uri,
            output_metadata_json=json.dumps(out_meta),
            stage_detail="Final 3D Anime MP4 rendered and ready for download.",
        )
    except Exception as exc:
        job = db.query(ConversionJob).filter(ConversionJob.job_id == job_id).first()
        if job:
            _update_job(
                db,
                job,
                status="failed",
                estimated_seconds_remaining=None,
                error_message=str(exc),
                stage_detail=f"Paused at stage {min(10, job.last_completed_stage + 1)} (resumable).",
            )
    finally:
        db.close()


@app.post("/api/jobs", status_code=201)
async def create_job(video: UploadFile = File(...)):
    filename = os.path.basename(video.filename or "cartoon.mp4")
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(status_code=400, detail="Unsupported video format. Only MP4 and MOV are accepted.")

    job_id = str(uuid.uuid4())
    job_dir = WORK_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    input_path = job_dir / f"input{ext}"

    try:
        with open(input_path, "wb") as out:
            shutil.copyfileobj(video.file, out)
        metadata = probe_video(str(input_path))
        if metadata["durationSec"] > 60.5:
            shutil.rmtree(job_dir, ignore_errors=True)
            raise HTTPException(status_code=400, detail="Video exceeds the 60-second maximum duration.")
    except HTTPException:
        raise
    except Exception as exc:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail=f"Invalid video file: {exc}")

    gcs_input_uri = gcs.upload_file(str(input_path), f"jobs/{job_id}/input{ext}", "video/mp4")

    db = SessionLocal()
    try:
        job = ConversionJob(
            job_id=job_id,
            original_filename=filename,
            input_path=str(input_path),
            gcs_input_uri=gcs_input_uri,
            status="queued",
            progress=5,
            current_stage=1,
            last_completed_stage=1,
            stage_detail="Uploaded and validated. Queued for processing.",
            metadata_json=json.dumps(metadata),
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        payload = serialize_job(job)
    finally:
        db.close()

    executor.submit(run_resumable_pipeline, job_id)
    return {"job_id": job_id, "job": payload}


@app.get("/api/jobs")
def list_jobs():
    db = SessionLocal()
    try:
        rows = db.query(ConversionJob).order_by(ConversionJob.created_at.desc()).limit(25).all()
        return {"jobs": [serialize_job(r) for r in rows]}
    finally:
        db.close()


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    if not UUID_RE.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job ID.")
    db = SessionLocal()
    try:
        job = db.query(ConversionJob).filter(ConversionJob.job_id == job_id).first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        return serialize_job(job)
    finally:
        db.close()


@app.post("/api/jobs/{job_id}/resume")
def resume_job(job_id: str):
    if not UUID_RE.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job ID.")
    db = SessionLocal()
    try:
        job = db.query(ConversionJob).filter(ConversionJob.job_id == job_id).first()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        if job.status == "completed":
            return {"job": serialize_job(job)}
        resumed_stage = min(10, job.last_completed_stage + 1)
        payload = serialize_job(job)
    finally:
        db.close()

    executor.submit(run_resumable_pipeline, job_id)
    return {"job": payload, "resumedFromStage": resumed_stage}


@app.get("/api/jobs/{job_id}/download")
def download_converted_mp4(job_id: str, inline: int = 0):
    if not UUID_RE.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job ID.")
    db = SessionLocal()
    try:
        job = db.query(ConversionJob).filter(ConversionJob.job_id == job_id).first()
        if not job or not job.output_path or not os.path.exists(job.output_path):
            raise HTTPException(status_code=404, detail="Converted MP4 is not available yet.")
        base = re.sub(r"[^a-zA-Z0-9_-]", "_", Path(job.original_filename).stem)
        headers = {} if inline == 1 else {"Content-Disposition": f'attachment; filename="{base}_3d_anime.mp4"'}
        return FileResponse(job.output_path, media_type="video/mp4", headers=headers)
    finally:
        db.close()


@app.get("/api/jobs/{job_id}/original")
def stream_original_video(job_id: str):
    if not UUID_RE.match(job_id):
        raise HTTPException(status_code=400, detail="Invalid job ID.")
    db = SessionLocal()
    try:
        job = db.query(ConversionJob).filter(ConversionJob.job_id == job_id).first()
        if not job or not os.path.exists(job.input_path):
            raise HTTPException(status_code=404, detail="Original video not found.")
        return FileResponse(job.input_path, media_type="video/mp4")
    finally:
        db.close()


@app.get("/api/jobs/{job_id}/assets/{asset_name}")
def get_job_asset(job_id: str, asset_name: str):
    if not UUID_RE.match(job_id) or not ASSET_RE.match(asset_name):
        raise HTTPException(status_code=400, detail="Invalid asset request.")
    assets_dir = (WORK_DIR / job_id / "assets").resolve()
    target = (assets_dir / asset_name).resolve()
    if not str(target).startswith(str(assets_dir) + os.sep) or not target.exists():
        raise HTTPException(status_code=404, detail="Asset not found.")
    return FileResponse(str(target))
