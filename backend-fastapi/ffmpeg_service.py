import json
import os
import subprocess
from typing import Dict, List, Optional, Tuple


def _run_cmd(args: List[str], timeout: int = 300) -> subprocess.CompletedProcess:
    return subprocess.run(
        args,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout,
    )


def probe_video(file_path: str) -> Dict:
    proc = _run_cmd(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            file_path,
        ],
        timeout=30,
    )
    payload = json.loads(proc.stdout)
    streams = payload.get("streams", [])
    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if not video_stream:
        raise ValueError("Uploaded file does not contain a valid video stream.")

    duration_sec = float(payload.get("format", {}).get("duration") or video_stream.get("duration") or 0)
    if duration_sec <= 0:
        raise ValueError("Unable to determine video duration.")

    width = int(video_stream["width"])
    height = int(video_stream["height"])
    fps_raw = video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate") or "24/1"
    fps = 24.0
    if "/" in fps_raw:
        num, den = fps_raw.split("/", 1)
        if float(den) > 0:
            fps = round(float(num) / float(den), 2)

    return {
        "durationSec": round(duration_sec, 2),
        "width": width,
        "height": height,
        "fps": fps,
        "hasAudio": audio_stream is not None,
        "orientation": "portrait" if height > width else "landscape",
        "codec": video_stream.get("codec_name", "unknown"),
        "fileSizeBytes": os.path.getsize(file_path),
    }


def extract_original_audio(input_path: str, audio_out_path: str) -> bool:
    try:
        _run_cmd(
            [
                "ffmpeg",
                "-y",
                "-i",
                input_path,
                "-vn",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-ar",
                "48000",
                audio_out_path,
            ],
            timeout=120,
        )
        return os.path.exists(audio_out_path) and os.path.getsize(audio_out_path) > 0
    except subprocess.CalledProcessError:
        return False


def extract_frame_at(input_path: str, timestamp_sec: float, out_path: str) -> None:
    _run_cmd(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{max(0.0, timestamp_sec):.3f}",
            "-i",
            input_path,
            "-frames:v",
            "1",
            "-q:v",
            "2",
            out_path,
        ],
        timeout=30,
    )


def extract_keyframes(input_path: str, frames_dir: str, duration_sec: float) -> List[str]:
    os.makedirs(frames_dir, exist_ok=True)
    count = min(12, max(3, int(duration_sec / 4) + 1))
    interval = duration_sec / count
    paths: List[str] = []
    for idx in range(count):
        ts = min(max(0.1, idx * interval + interval * 0.25), max(0.1, duration_sec - 0.15))
        out = os.path.join(frames_dir, f"frame_{idx:02d}.jpg")
        extract_frame_at(input_path, ts, out)
        if os.path.exists(out):
            paths.append(out)
    return paths


def slice_scene_video(input_path: str, start_sec: float, duration_sec: float, out_path: str) -> None:
    _run_cmd(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{max(0.0, start_sec):.3f}",
            "-i",
            input_path,
            "-t",
            f"{max(0.5, duration_sec):.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "22",
            "-pix_fmt",
            "yuv420p",
            "-an",
            "-movflags",
            "+faststart",
            out_path,
        ],
        timeout=120,
    )


def target_dimensions(metadata: Dict) -> Tuple[int, int]:
    w, h = int(metadata["width"]), int(metadata["height"])
    if metadata["orientation"] == "portrait":
        target_h = max(1280, min(h, 1920))
        target_w = max(720, min(1080, int(round(target_h * (w / h) / 2.0) * 2)))
        return target_w - (target_w % 2), target_h - (target_h % 2)
    target_h = max(720, min(h, 1080))
    target_h -= target_h % 2
    target_w = max(1280, min(1920, int(round(target_h * (w / h) / 2.0) * 2)))
    return target_w - (target_w % 2), target_h


def normalize_clip(
    input_clip: str, output_clip: str, target_w: int, target_h: int, target_duration_sec: float
) -> Dict:
    clip_meta = probe_video(input_clip)
    clip_dur = float(clip_meta["durationSec"])
    if clip_dur < 0.3:
        raise ValueError("Generated scene clip is shorter than 0.3s.")

    pts_factor = min(1.35, target_duration_sec / clip_dur) if clip_dur < target_duration_sec else 1.0
    filters = [
        f"setpts={pts_factor:.4f}*PTS",
        "fps=24",
        f"scale={target_w}:{target_h}:force_original_aspect_ratio=increase",
        f"crop={target_w}:{target_h}",
        "setsar=1",
        "format=yuv420p",
    ]
    if clip_dur * pts_factor < target_duration_sec - 0.05:
        pad = target_duration_sec - (clip_dur * pts_factor) + 0.1
        filters.append(f"tpad=stop_mode=clone:stop_duration={pad:.3f}")

    _run_cmd(
        [
            "ffmpeg",
            "-y",
            "-i",
            input_clip,
            "-vf",
            ",".join(filters),
            "-t",
            f"{target_duration_sec:.3f}",
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-an",
            output_clip,
        ],
        timeout=180,
    )
    return probe_video(output_clip)


def combine_and_mux_final(
    normalized_clips: List[str],
    original_audio_path: Optional[str],
    combined_silent_path: str,
    final_mp4_path: str,
    target_total_duration: float,
) -> Dict:
    concat_txt = f"{combined_silent_path}.txt"
    with open(concat_txt, "w", encoding="utf-8") as fh:
        for clip in normalized_clips:
            escaped = clip.replace("'", "'\\''")
            fh.write(f"file '{escaped}'\n")

    _run_cmd(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            concat_txt,
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "19",
            "-pix_fmt",
            "yuv420p",
            "-an",
            combined_silent_path,
        ],
        timeout=300,
    )

    if original_audio_path and os.path.exists(original_audio_path) and os.path.getsize(original_audio_path) > 0:
        _run_cmd(
            [
                "ffmpeg",
                "-y",
                "-i",
                combined_silent_path,
                "-i",
                original_audio_path,
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:v",
                "libx264",
                "-profile:v",
                "high",
                "-level",
                "4.1",
                "-preset",
                "medium",
                "-crf",
                "19",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-ar",
                "48000",
                "-af",
                f"apad=whole_dur={target_total_duration:.2f}",
                "-shortest",
                "-movflags",
                "+faststart",
                final_mp4_path,
            ],
            timeout=300,
        )
    else:
        _run_cmd(
            [
                "ffmpeg",
                "-y",
                "-i",
                combined_silent_path,
                "-f",
                "lavfi",
                "-i",
                "anullsrc=channel_layout=stereo:sample_rate=48000",
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:v",
                "libx264",
                "-profile:v",
                "high",
                "-level",
                "4.1",
                "-preset",
                "medium",
                "-crf",
                "19",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-shortest",
                "-movflags",
                "+faststart",
                final_mp4_path,
            ],
            timeout=300,
        )

    return probe_video(final_mp4_path)
