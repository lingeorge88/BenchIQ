from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from google.cloud import texttospeech
from app import config
from collections import defaultdict, deque
import asyncio
import logging
import time

logger = logging.getLogger("medical_chat")

router = APIRouter()

MAX_TEXT_CHARS = 1000
THROTTLE_LIMIT = 60
THROTTLE_WINDOW_S = 60.0

_client: texttospeech.TextToSpeechAsyncClient | None = None
_client_lock = asyncio.Lock()
_requests: dict[str, deque] = defaultdict(deque)


class TTSRequest(BaseModel):
    text: str
    voice: str | None = None


async def _get_client() -> texttospeech.TextToSpeechAsyncClient:
    global _client
    if _client is None:
        async with _client_lock:
            if _client is None:
                _client = texttospeech.TextToSpeechAsyncClient()
    return _client


def _throttled(client_ip: str) -> bool:
    now = time.monotonic()
    q = _requests[client_ip]
    while q and now - q[0] > THROTTLE_WINDOW_S:
        q.popleft()
    if len(q) >= THROTTLE_LIMIT:
        return True
    q.append(now)
    return False


@router.post("/tts")
async def tts(request: Request, body: TTSRequest):
    text = body.text.strip()
    if not text:
        return JSONResponse(status_code=400, content={"error": "empty_text", "message": "Text is required."})
    if len(text) > MAX_TEXT_CHARS:
        return JSONResponse(
            status_code=413,
            content={"error": "text_too_long", "message": f"Text exceeds {MAX_TEXT_CHARS} characters."},
        )

    voice = (body.voice or config.TTS_VOICE).strip()
    if not voice.startswith("en-US-"):
        return JSONResponse(status_code=400, content={"error": "invalid_voice", "message": "Unsupported voice."})

    client_ip = request.client.host if request.client else "unknown"
    if _throttled(client_ip):
        return JSONResponse(
            status_code=429,
            content={"error": "rate_limit_exceeded", "message": "Too many speech requests. Please slow down."},
        )

    try:
        client = await _get_client()
        response = await client.synthesize_speech(
            input=texttospeech.SynthesisInput(text=text),
            voice=texttospeech.VoiceSelectionParams(language_code="en-US", name=voice),
            audio_config=texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3),
        )
    except Exception as e:
        logger.error(f"TTS synthesis failed: {type(e).__name__}: {e}")
        return JSONResponse(
            status_code=502,
            content={"error": "tts_failed", "message": "Speech synthesis failed. Please try again."},
        )

    return Response(
        content=response.audio_content,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )
