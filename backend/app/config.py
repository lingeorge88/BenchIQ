import logging
import os
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("medical_chat")

GOOGLE_CLOUD_PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT")
GOOGLE_CLOUD_LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-west1")
RETRIEVAL_PROVIDER = os.environ.get("RETRIEVAL_PROVIDER", "legacy")
ENVIRONMENT = os.environ.get("ENVIRONMENT", "development")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash-lite")
ALLOWED_MODELS = [
    m.strip()
    for m in os.environ.get(
        "ALLOWED_MODELS",
        "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash",
    ).split(",")
    if m.strip()
]
if GEMINI_MODEL not in ALLOWED_MODELS:
    ALLOWED_MODELS.insert(0, GEMINI_MODEL)
THINKING_LEVEL = os.environ.get("THINKING_LEVEL", "LOW")

MODEL_INFO = {
    "gemini-3.5-flash-lite": {"label": "Balanced (default)", "price_note": "$0.30/$2.50 per 1M"},
    "gemini-3.1-flash-lite": {"label": "Cheapest", "price_note": "$0.25/$1.50 per 1M"},
    "gemini-2.5-flash": {"label": "Legacy baseline", "price_note": "retiring"},
}
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()

EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIMENSION = 2048
EMBEDDING_LOCATION = os.environ.get("EMBEDDING_LOCATION", "us-west1")

TTS_VOICE = os.environ.get("TTS_VOICE", "en-US-Chirp3-HD-Aoede")
STT_MODEL = os.environ.get("STT_MODEL", "gemini-3.1-flash-lite")
STT_LOCATION = os.environ.get("STT_LOCATION", "global")

DAILY_REQUEST_LIMIT = int(os.environ.get("DAILY_REQUEST_LIMIT", "5"))
BURST_REQUEST_LIMIT = int(os.environ.get("BURST_REQUEST_LIMIT", "3"))

FIRESTORE_CHUNKS_COLLECTION = "medical_chunks"
FIRESTORE_SESSIONS_COLLECTION = "adk_sessions"
FIRESTORE_RATE_LIMITS_COLLECTION = "rate_limits"

RETRIEVAL_TIMEOUT = int(os.environ.get("RETRIEVAL_TIMEOUT", "30"))
WEB_SEARCH_TIMEOUT = int(os.environ.get("WEB_SEARCH_TIMEOUT", "15"))
GENERATION_TIMEOUT = int(os.environ.get("GENERATION_TIMEOUT", "120"))


def _get_secret(secret_id: str) -> str | None:
    try:
        from google.cloud import secretmanager
        client = secretmanager.SecretManagerServiceClient()
        name = f"projects/{GOOGLE_CLOUD_PROJECT}/secrets/{secret_id}/versions/latest"
        response = client.access_secret_version(request={"name": name})
        return response.payload.data.decode("UTF-8")
    except Exception as e:
        logger.warning(f"Secret Manager lookup failed for {secret_id}: {e}")
        return None


def _resolve_secret(secret_id: str, env_var: str) -> str | None:
    value = os.environ.get(env_var)
    if value:
        return value
    if ENVIRONMENT == "production" and GOOGLE_CLOUD_PROJECT:
        return _get_secret(secret_id)
    return None


TAVILY_API_KEY = _resolve_secret("tavily-api-key", "TAVILY_API_KEY")
