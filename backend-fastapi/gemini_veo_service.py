import base64
import json
import os
import time
from typing import Dict, List, Optional
from google import genai
from google.genai import types
from tenacity import retry, stop_after_attempt, wait_exponential

DEFAULT_VISUAL_STYLE = "pixar_3d"

VISUAL_STYLES: Dict[str, Dict[str, str]] = {
    "pixar_3d": {
        "id": "pixar_3d",
        "name": "Classic / Pixar-Inspired 3D",
        "description": "Features expressive proportions, rich lighting, and detailed textures while keeping a clearly cartoon aesthetic.",
        "analysis_guidance": "Describe cohesive Pixar-inspired 3D animation lighting, warm cinematic subsurface scattering, expressive eyes, sculpted hair strands, and tactile cartoon cloth/environment textures.",
        "character_ref_directive": "Classic Pixar-inspired 3D animated feature aesthetic: expressive animated proportions, rich global illumination, soft subsurface skin scattering, finely sculpted stylized hair, detailed fabric weave, and appealing cartoon clarity.",
        "video_scene_directive": "Classic Pixar-inspired 3D animated cinema rendering with expressive proportions, rich volumetric lighting, soft global illumination, subsurface skin scattering, tactile fabric and environment textures, and smooth theatrical 3D animation.",
    },
    "stylized_3d": {
        "id": "stylized_3d",
        "name": "Stylized 3D",
        "description": "Uses exaggerated anatomy, bold colors, and simplified shapes for high visual clarity and personality.",
        "analysis_guidance": "Describe bold graphic color contrast, strong silhouette readability, simplified sculptural forms, exaggerated expressive anatomy, and snappy modern stylized 3D lighting.",
        "character_ref_directive": "Modern Stylized 3D character art: exaggerated expressive anatomy, bold saturated color blocks, clean simplified sculptural shapes, crisp silhouette clarity, and stylized rim lighting.",
        "video_scene_directive": "Modern Stylized 3D animation with exaggerated anatomy, bold saturated color palettes, simplified sculptural geometry, crisp readable silhouettes, painterly stylized shaders, and high-personality motion.",
    },
    "cel_shaded_npr": {
        "id": "cel_shaded_npr",
        "name": "Cel-Shaded / Non-Photorealistic (NPR)",
        "description": "Renders 3D models with flat color blocks and outlines to mimic 2D hand-drawn or comic-book art.",
        "analysis_guidance": "Describe crisp non-photorealistic cel-shading rules: stepped flat shadow bands, consistent dark ink contour lines, comic/anime halftone or rim highlights, and vivid flat color blocks over 3D volume.",
        "character_ref_directive": "Cel-Shaded Non-Photorealistic (NPR) 3D character render: crisp black ink outlines, flat stepped toon shading color blocks, sharp specular accents, and 3D dimensional volume that faithfully mimics hand-drawn anime or comic-book art.",
        "video_scene_directive": "Cel-Shaded Non-Photorealistic (NPR) 3D animation: 3D character and environment models rendered with stepped flat color blocks, clean dark ink contour outlines, graphic shadow shapes, and dynamic 2D-inspired comic/anime framing.",
    },
    "low_poly": {
        "id": "low_poly",
        "name": "Low Poly",
        "description": "Relies on minimal polygons and sharp geometric facets for a clean, blocky, or minimalist look.",
        "analysis_guidance": "Describe clean minimal polygon counts, flat-shaded triangular and quad facets, sharp geometric silhouettes, crisp faceted lighting gradients, and minimalist stylized color harmony.",
        "character_ref_directive": "Clean Low Poly 3D character model: minimal polygon count, crisp flat-shaded triangular and quad geometric facets, sharp angular planes, clean blocky silhouette, and minimalist studio lighting.",
        "video_scene_directive": "Low Poly 3D animated scene built from minimal polygons and sharp flat-shaded geometric facets, clean blocky character and environment geometry, crisp directional lighting across angular planes, and cohesive minimalist color harmony.",
    },
    "chibi_sd": {
        "id": "chibi_sd",
        "name": "Chibi / Super-Deformed",
        "description": "Shrinks body proportions with large heads and small limbs for cute, comedic characters.",
        "analysis_guidance": "Describe adorable Chibi / Super-Deformed 3D character conversion: oversized expressive heads (roughly 1:2 head-to-body ratio), compact cute bodies, tiny limbs, glossy large eyes, and playful vibrant lighting.",
        "character_ref_directive": "Chibi / Super-Deformed (SD) 3D character render: cute oversized head (1:2 head-to-body ratio), compact miniature torso, tiny expressive hands and feet, large sparkling anime eyes, and charming soft-gloss 3D toy-like shading while preserving exact hair, colors, and outfit details.",
        "video_scene_directive": "Chibi / Super-Deformed (SD) 3D animated scene: adorable shrunken body proportions with oversized expressive heads, small bouncy limbs, big sparkling eyes, vibrant cheerful lighting, and playful comedic 3D animation.",
    },
    "stop_motion_clay": {
        "id": "stop_motion_clay",
        "name": "Stop-Motion / Clay-Inspired 3D",
        "description": "Digitally replicates physical clay, puppet, or tactile handcrafted textures and frame motion.",
        "analysis_guidance": "Describe handcrafted stop-motion claymation aesthetics: subtle sculpted plasticine/clay thumbprint textures, miniature physical puppet seams, felted wool fabrics, warm practical miniature set lighting, shallow macro depth of field, and stepped on-twos stop-motion cadence.",
        "character_ref_directive": "Stop-Motion / Clay-Inspired 3D puppet character portrait: handcrafted sculpted clay and plasticine surface micro-textures, subtle fingerprint impressions, felt/fabric puppet clothing details, miniature studio lighting, and tactile physical charm.",
        "video_scene_directive": "Stop-Motion / Clay-Inspired 3D animation (claymation / handcrafted puppet film): sculpted clay and plasticine surface textures with subtle handmade imperfections, tactile felt and miniature set props, warm practical studio lighting with shallow macro depth of field, and authentic stepped stop-motion frame cadence.",
    },
}


def resolve_visual_style(style_id: Optional[str]) -> Dict[str, str]:
    if style_id and style_id in VISUAL_STYLES:
        return VISUAL_STYLES[style_id]
    return VISUAL_STYLES[DEFAULT_VISUAL_STYLE]


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
def analyze_full_cartoon_video(
    video_path: str, duration_sec: float, style_id: Optional[str] = None
) -> Dict:
    """Uses Gemini video understanding across the full duration (up to 60s) with 503 failover."""
    style = resolve_visual_style(style_id)
    client = get_genai_client()
    uploaded = _upload_and_wait(client, video_path, "video/mp4")
    try:
        prompt = (
            f"Analyze the ENTIRE 2D cartoon video from 0.0s to {duration_sec:.2f}s. "
            f"Target 3D visual style: {style['name']} — {style['description']} "
            "Return strict JSON with keys: overallStyleNotes (string tailored to the target style: "
            f"{style['analysis_guidance']}), characters (array of objects with "
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
    source_frame_path: str,
    character_profile: Dict,
    out_png_path: str,
    style_id: Optional[str] = None,
) -> bool:
    """Creates a canonical 3D character reference sheet in the chosen style with 503 model failover."""
    style = resolve_visual_style(style_id)
    client = get_genai_client()
    with open(source_frame_path, "rb") as fh:
        frame_bytes = fh.read()

    prompt = (
        f"Transform character '{character_profile['name']}' ({character_profile['characterId']}) from this "
        f"2D cartoon frame into a clean {style['name']} character reference portrait on a neutral studio backdrop. "
        f"Face: {character_profile['facialFeatures']}. Hair: {character_profile['hairStyleAndColor']}. "
        f"Eyes: {character_profile['eyeShapeAndColor']}. Outfit: {character_profile['clothingAndAccessories']}. "
        f"Source proportions: {character_profile['bodyProportions']}. Colors: {character_profile['colorPalette']}. "
        f"Distinctive traits: {character_profile['distinctiveFeatures']}. "
        f"TARGET VISUAL STYLE ({style['name']}): {style['character_ref_directive']}"
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
