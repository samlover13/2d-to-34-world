import base64
import json
import os
import time
from typing import Dict, List
from google import genai
from google.genai import types
from tenacity import retry, stop_after_attempt, wait_exponential


def get_genai_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY environment variable is not configured.")
    return genai.Client(api_key=api_key)


def _upload_and_wait(client: genai.Client, file_path: str, mime_type: str):
    uploaded = client.files.upload(file=file_path, config={"mime_type": mime_type})
    for _ in range(40):
        if uploaded.state.name != "PROCESSING":
            break
        time.sleep(4)
        uploaded = client.files.get(name=uploaded.name)
    if uploaded.state.name == "FAILED":
        raise RuntimeError("Google File API failed while processing uploaded video.")
    return uploaded


@retry(stop=stop_after_attempt(4), wait=wait_exponential(multiplier=2, min=4, max=25), reraise=True)
def analyze_full_cartoon_video(video_path: str, duration_sec: float) -> Dict:
    """Uses Gemini video understanding across the full duration (up to 60s) with 503 failover."""
    client = get_genai_client()
    uploaded = _upload_and_wait(client, video_path, "video/mp4")
    try:
        prompt = (
            f"Analyze the ENTIRE 2D cartoon video from 0.0s to {duration_sec:.2f}s. "
            "Return strict JSON with keys: overallStyleNotes (string), characters (array of objects with "
            "characterId, name, facialFeatures, hairStyleAndColor, eyeShapeAndColor, clothingAndAccessories, "
            "bodyProportions, colorPalette, distinctiveFeatures, bestFrameTimestampSec), and scenes "
            "(chronological array covering 0.0s to full duration in 4-9s segments with startSec, endSec, "
            "summary, expressionsAndActions, cameraAndMovement, backgroundAndLighting, characterIds)."
        )
        last_exc = None
        for model_name in ("gemini-4-hydrogen", "gemini-4-neon", "gemini-3.1-flash-lite"):
            try:
                response = client.models.generate_content(
                    model=model_name,
                    contents=[uploaded, prompt],
                    config=types.GenerateContentConfig(response_mime_type="application/json"),
                )
                return json.loads((response.text or "{}").strip())
            except Exception as exc:
                last_exc = exc
                err_str = str(exc)
                if "503" in err_str or "UNAVAILABLE" in err_str or "429" in err_str:
                    continue
                raise
        raise last_exc or RuntimeError("All Gemini video analysis models failed.")
    finally:
        try:
            client.files.delete(name=uploaded.name)
        except Exception:
            pass


@retry(stop=stop_after_attempt(4), wait=wait_exponential(multiplier=2, min=4, max=25), reraise=True)
def generate_3d_anime_character_reference(
    source_frame_path: str, character_profile: Dict, out_png_path: str
) -> bool:
    """Creates a canonical 3D Anime character reference sheet with 503 model failover."""
    client = get_genai_client()
    with open(source_frame_path, "rb") as fh:
        frame_bytes = fh.read()

    prompt = (
        f"Transform character '{character_profile['name']}' ({character_profile['characterId']}) from this "
        "2D cartoon frame into a clean theatrical 3D CG Anime character reference portrait on a neutral studio backdrop. "
        f"Face: {character_profile['facialFeatures']}. Hair: {character_profile['hairStyleAndColor']}. "
        f"Eyes: {character_profile['eyeShapeAndColor']}. Outfit: {character_profile['clothingAndAccessories']}. "
        f"Proportions: {character_profile['bodyProportions']}. Colors: {character_profile['colorPalette']}. "
        f"Distinctive traits: {character_profile['distinctiveFeatures']}."
    )

    last_exc = None
    for model_name in ("gemini-3.1-flash-lite-image", "gemini-nano-banana-2.1"):
        try:
            response = client.models.generate_content(
                model=model_name,
                contents=[
                    types.Part.from_bytes(data=frame_bytes, mime_type="image/jpeg"),
                    prompt,
                ],
            )
            for part in response.candidates[0].content.parts:
                if part.inline_data and part.inline_data.data:
                    with open(out_png_path, "wb") as out:
                        out.write(part.inline_data.data)
                    return True
            return False
        except Exception as exc:
            last_exc = exc
            err_str = str(exc)
            if "503" in err_str or "UNAVAILABLE" in err_str or "429" in err_str:
                continue
            raise
    raise last_exc or RuntimeError("Failed to generate 3D anime character reference portrait.")


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=3, min=4, max=25), reraise=True)
def generate_veo_3d_anime_scene(
    scene_video_slice_path: str,
    character_ref_paths: List[str],
    conversion_prompt: str,
    aspect_ratio: str,
    duration_sec: int,
    output_mp4_path: str,
) -> None:
    """Converts one scene segment into 3D Anime using Google Veo / Omni Flash with character reference locking."""
    client = get_genai_client()
    uploaded_slice = _upload_and_wait(client, scene_video_slice_path, "video/mp4")

    inputs = [{"type": "video", "uri": uploaded_slice.uri}]
    for ref_path in character_ref_paths[:4]:
        if os.path.exists(ref_path):
            with open(ref_path, "rb") as fh:
                b64 = base64.b64encode(fh.read()).decode("utf-8")
            mime = "image/png" if ref_path.endswith(".png") else "image/jpeg"
            inputs.append({"type": "image", "mime_type": mime, "data": b64})
    inputs.append({"type": "text", "text": conversion_prompt})

    try:
        interaction = client.interactions.create(
            model="gemini-omni-1.2-flash",
            input=inputs,
            background=False,
            store=False,
            stream=False,
            response_format={
                "type": "video",
                "aspect_ratio": aspect_ratio,
                "duration": f"{max(3, min(10, duration_sec))}s",
                "resolution": "720p",
            },
        )
        video_part = getattr(interaction, "output_video", None)
        if video_part and getattr(video_part, "data", None):
            with open(output_mp4_path, "wb") as out:
                out.write(base64.b64decode(video_part.data))
            return
        raise RuntimeError("Veo interaction completed without returning video bytes.")
    finally:
        try:
            client.files.delete(name=uploaded_slice.name)
        except Exception:
            pass
