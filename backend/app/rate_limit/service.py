import time
from datetime import datetime, timezone
from google.cloud import firestore
from app import config
from app.rate_limit.models import QuotaState, QuotaResponse

COLLECTION = config.FIRESTORE_RATE_LIMITS_COLLECTION
DAY_SECONDS = 86400
MINUTE_SECONDS = 60


class RateLimitService:
    def __init__(self):
        self._db = firestore.Client(
            project=config.GOOGLE_CLOUD_PROJECT,
            database="(default)",
        )
        self._active_sessions: set[str] = set()

    def _doc_ref(self, client_id: str):
        return self._db.collection(COLLECTION).document(client_id)

    def check_and_increment(self, client_id: str, session_id: str) -> QuotaResponse:
        if session_id in self._active_sessions:
            state = self._get_quota_state(client_id)
            return QuotaResponse(
                allowed=False,
                state=state,
                reason="A response is already being generated for this session.",
            )

        ref = self._doc_ref(client_id)
        now = time.time()

        @firestore.transactional
        def update_in_transaction(transaction):
            doc = ref.get(transaction=transaction)

            if doc.exists:
                data = doc.to_dict()
            else:
                data = {
                    "client_id": client_id,
                    "window_start": now,
                    "request_count": 0,
                    "burst_window_start": now,
                    "burst_count": 0,
                }

            window_start = data.get("window_start", now)
            request_count = data.get("request_count", 0)
            burst_window_start = data.get("burst_window_start", now)
            burst_count = data.get("burst_count", 0)

            if now - window_start >= DAY_SECONDS:
                window_start = now
                request_count = 0

            if now - burst_window_start >= MINUTE_SECONDS:
                burst_window_start = now
                burst_count = 0

            reset_at = datetime.fromtimestamp(
                window_start + DAY_SECONDS, tz=timezone.utc
            ).isoformat()

            state = QuotaState(
                client_id=client_id,
                used=request_count,
                limit=config.DAILY_REQUEST_LIMIT,
                remaining=max(0, config.DAILY_REQUEST_LIMIT - request_count),
                reset_at=reset_at,
                burst_used=burst_count,
                burst_limit=config.BURST_REQUEST_LIMIT,
            )

            if request_count >= config.DAILY_REQUEST_LIMIT:
                return QuotaResponse(
                    allowed=False,
                    state=state,
                    reason=f"Daily limit of {config.DAILY_REQUEST_LIMIT} requests reached.",
                )

            if burst_count >= config.BURST_REQUEST_LIMIT:
                return QuotaResponse(
                    allowed=False,
                    state=state,
                    reason=f"Burst limit of {config.BURST_REQUEST_LIMIT} requests per minute reached.",
                )

            request_count += 1
            burst_count += 1

            transaction.set(ref, {
                "client_id": client_id,
                "window_start": window_start,
                "request_count": request_count,
                "burst_window_start": burst_window_start,
                "burst_count": burst_count,
                "updated_at": now,
            })

            state.used = request_count
            state.remaining = max(0, config.DAILY_REQUEST_LIMIT - request_count)
            state.burst_used = burst_count

            return QuotaResponse(allowed=True, state=state)

        transaction = self._db.transaction()
        return update_in_transaction(transaction)

    def mark_active(self, session_id: str):
        self._active_sessions.add(session_id)

    def mark_done(self, session_id: str):
        self._active_sessions.discard(session_id)

    def get_quota(self, client_id: str) -> QuotaState:
        return self._get_quota_state(client_id)

    def _get_quota_state(self, client_id: str) -> QuotaState:
        doc = self._doc_ref(client_id).get()
        now = time.time()

        if not doc.exists:
            reset_at = datetime.fromtimestamp(
                now + DAY_SECONDS, tz=timezone.utc
            ).isoformat()
            return QuotaState(
                client_id=client_id,
                used=0,
                limit=config.DAILY_REQUEST_LIMIT,
                remaining=config.DAILY_REQUEST_LIMIT,
                reset_at=reset_at,
                burst_used=0,
                burst_limit=config.BURST_REQUEST_LIMIT,
            )

        data = doc.to_dict()
        window_start = data.get("window_start", now)
        request_count = data.get("request_count", 0)

        if now - window_start >= DAY_SECONDS:
            request_count = 0
            window_start = now

        reset_at = datetime.fromtimestamp(
            window_start + DAY_SECONDS, tz=timezone.utc
        ).isoformat()

        return QuotaState(
            client_id=client_id,
            used=request_count,
            limit=config.DAILY_REQUEST_LIMIT,
            remaining=max(0, config.DAILY_REQUEST_LIMIT - request_count),
            reset_at=reset_at,
            burst_used=data.get("burst_count", 0),
            burst_limit=config.BURST_REQUEST_LIMIT,
        )
