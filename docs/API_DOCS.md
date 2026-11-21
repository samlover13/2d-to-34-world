# Cartoon AI Studio — REST API Documentation

Both the live Node/Express server (`server.ts`) and the production Python FastAPI server (`backend-fastapi/main.py`) implement the exact same REST API contract so the Native Android app works seamlessly against either backend.

---

## 1. Create Conversion Job
**`POST /api/jobs`**
- **Content-Type:** `multipart/form-data`
- **Field:** `video` (`.mp4` or `.mov`, max `60` seconds, max `150 MB`)
- **Validation:** Probes the uploaded stream with `ffprobe`. Rejects unsupported containers or durations > 60s with HTTP `400`.
- **Response (`201 Created`):**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "job": {
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "originalFilename": "episode_clip.mp4",
    "status": "queued",
    "progress": 5,
    "currentStage": 1,
    "currentStageLabel": "Uploading video",
    "lastCompletedStage": 1,
    "resumable": false
  }
}
```

## 2. Poll Real-Time Job Status
**`GET /api/jobs/{job_id}`**
- Returns actual backend progress (0–100), current stage (1–10), estimated remaining seconds (only when computed from completed Veo scenes), detected character reference profiles, scene breakdown statuses, and error details.
- **10 Pipeline Stages:**
  1. `Uploading video`
  2. `Extracting frames`
  3. `Gemini analyzing video`
  4. `Detecting characters`
  5. `Creating character reference profiles`
  6. `Detecting scenes and movements`
  7. `Veo generating 3D Anime scenes`
  8. `Combining generated scenes`
  9. `Synchronizing original audio`
  10. `Rendering final MP4`

## 3. Resume Failed Job From Last Checkpoint
**`POST /api/jobs/{job_id}/resume`**
- Resumes a failed job from `lastCompletedStage + 1` (and skips already-completed Veo scene clips on disk/GCS) rather than restarting the entire conversion.
- **Response (`200 OK`):**
```json
{
  "resumedFromStage": 7,
  "job": { "...": "..." }
}
```

## 4. Download or Stream Converted MP4
**`GET /api/jobs/{job_id}/download`**
- Streams the final H.264 + AAC 720p+ MP4 with original orientation and synchronized original audio (`Content-Disposition: attachment`).
- Append `?inline=1` for inline video playback (used by ExoPlayer and `<video>` side-by-side comparison).

## 5. Stream Original Video & Reference Assets
- **`GET /api/jobs/{job_id}/original`** — Streams the original uploaded 2D cartoon video for synchronized side-by-side playback.
- **`GET /api/jobs/{job_id}/assets/{asset_name}`** — Serves extracted character source frames, 3D Anime reference portraits, and scene keyframes.
- **`GET /api/jobs`** — Returns the 25 most recent conversion jobs from the persistent database.
