import os

import httpx
from dotenv import load_dotenv

load_dotenv(override=False)

ELEVENLABS_API_KEY = os.getenv("ELEVENLABS_API_KEY", "")
ELEVENLABS_TTS_MODEL = os.getenv("ELEVENLABS_TTS_MODEL", "eleven_multilingual_v2")
DEFAULT_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
ELEVENLABS_BASE = "https://api.elevenlabs.io/v1"

DEFAULT_VOICE_SCRIPT = (
    "Hi, this is the store assistant speaking. I help customers with products, "
    "sizes, stock, and orders. Please listen to this sample so I can answer in "
    "this same voice. Thank you for shopping with us."
)


def voice_configured() -> bool:
    return bool(ELEVENLABS_API_KEY.strip())


def resolve_voice_id(saved_voice_id: str = "") -> str:
    return (saved_voice_id or "").strip() or DEFAULT_VOICE_ID


def _headers() -> dict[str, str]:
    return {"xi-api-key": ELEVENLABS_API_KEY}


def _error_message(data: object, fallback: str) -> str:
    if isinstance(data, dict):
        detail = data.get("detail")
        if isinstance(detail, dict):
            return str(detail.get("message") or fallback)
        if isinstance(detail, str) and detail.strip():
            return detail
        if data.get("message"):
            return str(data["message"])
    return fallback


def clone_voice(
    name: str,
    files: list[tuple[str, bytes, str]],
    previous_voice_id: str = "",
) -> tuple[str, str]:
    if not voice_configured():
        return "", "Add ELEVENLABS_API_KEY to the backend .env file."
    if not files:
        return "", "Upload or record a voice sample first."

    if previous_voice_id and previous_voice_id != DEFAULT_VOICE_ID:
        try:
            httpx.delete(
                f"{ELEVENLABS_BASE}/voices/{previous_voice_id}",
                headers=_headers(),
                timeout=20,
            )
        except Exception:
            pass

    uploads = [
        ("files", (filename, data, mime or "application/octet-stream"))
        for filename, data, mime in files
    ]
    try:
        response = httpx.post(
            f"{ELEVENLABS_BASE}/voices/add",
            headers=_headers(),
            data={
                "name": name,
                "description": "Aibot store assistant voice",
                "remove_background_noise": "true",
            },
            files=uploads,
            timeout=90,
        )
        data = response.json()
        voice_id = str(data.get("voice_id") or "").strip()
        if response.is_success and voice_id:
            return voice_id, ""
        return "", _error_message(data, "Could not clone that voice.")
    except Exception as error:
        return "", str(error)


def synthesize_speech(voice_id: str, text: str) -> tuple[bytes | None, str, str]:
    if not voice_configured():
        return None, "", "ElevenLabs is not configured."
    clean = " ".join((text or "").split())
    if not clean:
        return None, "", "Nothing to read."
    try:
        response = httpx.post(
            f"{ELEVENLABS_BASE}/text-to-speech/{voice_id}",
            headers={**_headers(), "Accept": "audio/mpeg"},
            json={
                "text": clean[:2000],
                "model_id": ELEVENLABS_TTS_MODEL,
            },
            params={"output_format": "mp3_44100_128"},
            timeout=60,
        )
        if response.is_success and response.content:
            return response.content, "audio/mpeg", ""
        try:
            data = response.json()
        except Exception:
            data = {}
        return None, "", _error_message(data, "Could not generate speech.")
    except Exception as error:
        return None, "", str(error)
