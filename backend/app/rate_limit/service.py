import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from google.cloud import firestore
from app import config
from app.rate_limit.models import QuotaState, QuotaResponse

logger = logging.getLogger("medical_chat")

COLLECTION = config.FIRESTORE_RATE_LIMITS_COLLECTION
DAY_SECONDS = 86400
MINUTE_SECONDS = 60


@dataclass
class Bucket:
    """One fixed-window counter stored as a Firestore document."""
    doc_id: str
    daily_limit: int
    reason: str
    status: int = 429
    burst_limit: int | None = None  # optional per-minute limit
    cost: int = 1  # units consumed by this request (1 request, or N characters)


@dataclass
class BucketState:
    count: int
    window_start: float
    burst_count: int


@dataclass
class LimitResult:
    allowed: bool
    reason: str = ""
    status: int = 200


class RateLimitService:
    """Layered, Firestore-backed limits shared by all Cloud Run instances.

    Every check reads all of its buckets and either increments all of them or none,
    inside one Firestore transaction, so a rejected request never burns quota.
    """

    def __init__(self):
        self._db = firestore.Client(
            project=config.GOOGLE_CLOUD_PROJECT,
            database="(default)",
        )
        self._active_sessions: set[str] = set()

    def _doc_ref(self, doc_id: str):
        return self._db.collection(COLLECTION).document(doc_id)

    @staticmethod
    def _windowed(data: dict | None, now: float) -> BucketState:
        data = data or {}
        window_start = data.get("window_start", now)
        count = data.get("request_count", 0)
        burst_start = data.get("burst_window_start", now)
        burst_count = data.get("burst_count", 0)
        if now - window_start >= DAY_SECONDS:
            window_start, count = now, 0
        if now - burst_start >= MINUTE_SECONDS:
            burst_count = 0
        return BucketState(count=count, window_start=window_start, burst_count=burst_count)

    def _consume(self, buckets: list[Bucket]) -> tuple[Bucket | None, dict[str, BucketState]]:
        """Atomically consume all buckets. Returns (first failing bucket or None, states)."""
        refs = {b.doc_id: self._doc_ref(b.doc_id) for b in buckets}
        now = time.time()

        @firestore.transactional
        def run(transaction):
            snapshots = {doc_id: ref.get(transaction=transaction) for doc_id, ref in refs.items()}
            states: dict[str, BucketState] = {}
            raw: dict[str, dict] = {}
            for b in buckets:
                snap = snapshots[b.doc_id]
                raw[b.doc_id] = snap.to_dict() if snap.exists else {}
                states[b.doc_id] = self._windowed(raw[b.doc_id], now)

            for b in buckets:
                s = states[b.doc_id]
                if s.count + b.cost > b.daily_limit:
                    return b, states
                if b.burst_limit is not None and s.burst_count >= b.burst_limit:
                    return b, states

            for b in buckets:
                s = states[b.doc_id]
                data = raw[b.doc_id]
                burst_start = data.get("burst_window_start", now)
                if now - burst_start >= MINUTE_SECONDS or s.burst_count == 0:
                    burst_start = now
                s.count += b.cost
                s.burst_count += 1
                transaction.set(refs[b.doc_id], {
                    "client_id": b.doc_id,
                    "window_start": s.window_start,
                    "request_count": s.count,
                    "burst_window_start": burst_start,
                    "burst_count": s.burst_count,
                    "updated_at": now,
                })
            return None, states

        return run(self._db.transaction())

    def _session_state(self, client_id: str, state: BucketState | None) -> QuotaState:
        now = time.time()
        state = state or BucketState(count=0, window_start=now, burst_count=0)
        return QuotaState(
            client_id=client_id,
            used=state.count,
            limit=config.DAILY_REQUEST_LIMIT,
            remaining=max(0, config.DAILY_REQUEST_LIMIT - state.count),
            reset_at=datetime.fromtimestamp(state.window_start + DAY_SECONDS, tz=timezone.utc).isoformat(),
            burst_used=state.burst_count,
            burst_limit=config.BURST_REQUEST_LIMIT,
        )

    # ---- Chat -------------------------------------------------------------

    def check_chat(self, client_id: str, ip_hash: str, session_id: str) -> QuotaResponse:
        """Per-session (5/day, 3/min) + per-IP + global daily chat limits."""
        if session_id in self._active_sessions:
            return QuotaResponse(
                allowed=False,
                state=self.get_quota(client_id),
                reason="A response is already being generated for this session.",
            )

        buckets = [
            Bucket(client_id, config.DAILY_REQUEST_LIMIT,
                   f"Daily limit of {config.DAILY_REQUEST_LIMIT} requests reached.",
                   burst_limit=config.BURST_REQUEST_LIMIT),
            Bucket(f"chat-ip-{ip_hash}", config.IP_DAILY_REQUEST_LIMIT,
                   "Too many requests from your network today. Please try again tomorrow."),
            Bucket("chat-global", config.GLOBAL_DAILY_REQUEST_LIMIT,
                   "BenchIQ has reached its demo capacity for today. Please try again tomorrow.",
                   status=503),
        ]
        try:
            failed, states = self._consume(buckets)
        except Exception as e:  # contention or Firestore outage: fail closed
            logger.error(f"Rate limit check failed: {type(e).__name__}: {e}")
            return QuotaResponse(
                allowed=False, state=self._session_state(client_id, None),
                reason="The service is busy. Please try again in a moment.", status_code=503,
            )

        state = self._session_state(client_id, states.get(client_id))
        if failed is None:
            return QuotaResponse(allowed=True, state=state)
        reason = failed.reason
        if failed.doc_id == client_id and failed.burst_limit is not None \
                and states[client_id].count + 1 <= failed.daily_limit:
            reason = f"Burst limit of {config.BURST_REQUEST_LIMIT} requests per minute reached."
        return QuotaResponse(allowed=False, state=state, reason=reason, status_code=failed.status)

    def mark_active(self, session_id: str):
        self._active_sessions.add(session_id)

    def mark_done(self, session_id: str):
        self._active_sessions.discard(session_id)

    def get_quota(self, client_id: str) -> QuotaState:
        doc = self._doc_ref(client_id).get()
        state = self._windowed(doc.to_dict() if doc.exists else None, time.time())
        return self._session_state(client_id, state)

    # ---- Voice --------------------------------------------------------------

    def _check(self, buckets: list[Bucket]) -> LimitResult:
        try:
            failed, _ = self._consume(buckets)
        except Exception as e:
            logger.error(f"Rate limit check failed: {type(e).__name__}: {e}")
            return LimitResult(False, "The service is busy. Please try again in a moment.", 503)
        if failed is None:
            return LimitResult(True)
        return LimitResult(False, failed.reason, failed.status)

    def check_tts(self, ip_hash: str, chars: int) -> LimitResult:
        return self._check([
            Bucket(f"tts-ip-{ip_hash}", config.TTS_IP_DAILY_CHARS,
                   "Daily voice playback limit reached for your network.", cost=chars),
            Bucket("tts-global", config.TTS_GLOBAL_DAILY_CHARS,
                   "Voice playback has reached its demo capacity for today.", status=503, cost=chars),
        ])

    def check_stt(self, ip_hash: str) -> LimitResult:
        return self._check([
            Bucket(f"stt-ip-{ip_hash}", config.STT_IP_DAILY_LIMIT,
                   "Daily voice input limit reached for your network."),
            Bucket("stt-global", config.STT_GLOBAL_DAILY_LIMIT,
                   "Voice input has reached its demo capacity for today.", status=503),
        ])


_instance: RateLimitService | None = None


def get_rate_limiter() -> RateLimitService:
    """Shared limiter (one Firestore client) for chat, TTS and STT."""
    global _instance
    if _instance is None:
        _instance = RateLimitService()
    return _instance
