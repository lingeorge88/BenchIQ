import logging
import os
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger("medical_chat")

GOOGLE_CLOUD_PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT")
GOOGLE_CLOUD_LOCATION = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-west1")
RETRIEVAL_PROVIDER = os.environ.get("RETRIEVAL_PROVIDER", "legacy")
ENVIRONMENT = os.environ.get("ENVIRONMENT", "development")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()

EMBEDDING_MODEL = "gemini-embedding-001"
EMBEDDING_DIMENSION = 2048

DAILY_REQUEST_LIMIT = int(os.environ.get("DAILY_REQUEST_LIMIT", "10"))
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
