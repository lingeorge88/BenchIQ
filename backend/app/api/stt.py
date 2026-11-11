"""Speech-to-text for voice mode: browser posts a short WAV clip, Gemini transcribes it."""
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from google import genai
from google.genai import types
from app import config
from app.rate_limit.service import get_rate_limiter
from app.security.client_ip import client_ip, ip_key
from collections import defaultdict, deque
import logging
import time

logger = logging.getLogger("medical_chat")

router = APIRouter()

MAX_AUDIO_BYTES = 2_000_000  # ~60s of 16 kHz mono 16-bit PCM
ALLOWED_TYPES = {"audio/wav", "audio/x-wav", "audio/wave"}
THROTTLE_LIMIT = 30
THROTTLE_WINDOW_S = 60.0

PROMPT = (
    "Transcribe the user's speech exactly. Context: a medical laboratory assistant; likely terms include "
    "AU5812, AU680, DXI800 (DxI 800), Beckman Coulter, IFU, QC, calibration, reagent, assay, ISE, cuvette, "
    "photometer, sample probe, wash solution. Write analyzer model names in canonical form (e.g. AU680, DXI800). "
    "Output only the transcript, with no quotes or commentary. If there is no intelligible speech, output nothing."
)

_client: genai.Client | None = None
_requests: dict[str, deque] = defaultdict(deque)


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(
            vertexai=True,
            project=config.GOOGLE_CLOUD_PROJECT,
            location=config.STT_LOCATION,
        )
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


def _error(status: int, error: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": error, "message": message})


@router.post("/stt")
async def stt(request: Request):
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_TYPES:
        return _error(415, "unsupported_media_type", "Send audio as audio/wav.")

    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_AUDIO_BYTES:
        return _error(413, "audio_too_long", "Audio clip is too long.")

    audio = await request.body()
    if len(audio) < 1000:
        return _error(400, "empty_audio", "Audio clip is empty.")
    if len(audio) > MAX_AUDIO_BYTES:
        return _error(413, "audio_too_long", "Audio clip is too long.")

    ip = client_ip(request)
    if _throttled(ip):
        return _error(429, "rate_limit_exceeded", "Too many speech requests. Please slow down.")
    budget = get_rate_limiter().check_stt(ip_key(ip))
    if not budget.allowed:
        return _error(budget.status, "rate_limit_exceeded", budget.reason)

    started = time.monotonic()
    try:
        response = await _get_client().aio.models.generate_content(
            model=config.STT_MODEL,
            contents=[types.Part.from_bytes(data=audio, mime_type="audio/wav"), PROMPT],
            config=types.GenerateContentConfig(
                temperature=0,
                max_output_tokens=512,
                thinking_config=types.ThinkingConfig(thinking_level="MINIMAL"),
            ),
        )
    except Exception as e:
        logger.error(f"STT failed: {type(e).__name__}: {e}")
        return _error(502, "stt_failed", "Speech recognition failed. Please try again.")

    text = (response.text or "").strip().strip('"').strip()
    logger.info(f'{{"stage": "stt", "model": "{config.STT_MODEL}", "bytes": {len(audio)}, '
                f'"chars": {len(text)}, "ms": {int((time.monotonic() - started) * 1000)}}}')
    return {"text": text}
