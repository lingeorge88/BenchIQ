import time
import uuid
from typing import Any, Optional

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from google.adk.sessions.base_session_service import BaseSessionService, ListSessionsResponse
from google.adk.sessions import Session
from google.adk.events.event import Event
from app import config

SESSIONS_COLLECTION = config.FIRESTORE_SESSIONS_COLLECTION


class FirestoreSessionService(BaseSessionService):

    def __init__(self):
        self._db = firestore.Client(
            project=config.GOOGLE_CLOUD_PROJECT,
            database="(default)",
        )

    def _doc_ref(self, app_name: str, user_id: str, session_id: str):
        return self._db.collection(SESSIONS_COLLECTION).document(
            f"{app_name}_{user_id}_{session_id}"
        )

    async def create_session(
        self,
        *,
        app_name: str,
        user_id: str,
        state: Optional[dict[str, Any]] = None,
        session_id: Optional[str] = None,
    ) -> Session:
        session_id = session_id or str(uuid.uuid4())
        session = Session(
            id=session_id,
            app_name=app_name,
            user_id=user_id,
            state=state or {},
            events=[],
            last_update_time=time.time(),
        )
        self._doc_ref(app_name, user_id, session_id).set({
            "app_name": app_name,
            "user_id": user_id,
            "session_id": session_id,
            "state": session.state,
            "events": [],
            "last_update_time": session.last_update_time,
        })
        return session

    async def get_session(
        self,
        *,
        app_name: str,
        user_id: str,
        session_id: str,
        config: Optional[Any] = None,
    ) -> Optional[Session]:
        doc = self._doc_ref(app_name, user_id, session_id).get()
        if not doc.exists:
            return None

        data = doc.to_dict()
        events = []
        for e_data in data.get("events", []):
            try:
                events.append(Event.model_validate(e_data))
            except Exception:
                pass

        return Session(
            id=session_id,
            app_name=app_name,
            user_id=user_id,
            state=data.get("state", {}),
            events=events,
            last_update_time=data.get("last_update_time", 0.0),
        )

    async def list_sessions(
        self, *, app_name: str, user_id: Optional[str] = None
    ) -> ListSessionsResponse:
        collection = self._db.collection(SESSIONS_COLLECTION)
        query = collection.where(filter=FieldFilter("app_name", "==", app_name))
        if user_id:
            query = query.where(filter=FieldFilter("user_id", "==", user_id))
        query = query.order_by("last_update_time")

        sessions = []
        for doc in query.stream():
            data = doc.to_dict()
            sessions.append(Session(
                id=data["session_id"],
                app_name=data["app_name"],
                user_id=data["user_id"],
                state=data.get("state", {}),
                events=[],
                last_update_time=data.get("last_update_time", 0.0),
            ))
        return ListSessionsResponse(sessions=sessions)

    async def delete_session(
        self, *, app_name: str, user_id: str, session_id: str
    ) -> None:
        self._doc_ref(app_name, user_id, session_id).delete()

    async def append_event(self, session: Session, event: Event) -> Event:
        event = await super().append_event(session, event)

        try:
            event_data = event.model_dump(mode="python", exclude_none=True)
            for key in ("content", "actions", "node_info"):
                if key in event_data and hasattr(event_data[key], "model_dump"):
                    event_data[key] = event_data[key].model_dump(exclude_none=True)
        except Exception:
            event_data = {"id": event.id, "author": event.author, "timestamp": event.timestamp}

        now = time.time()
        self._doc_ref(session.app_name, session.user_id, session.id).update({
            "events": firestore.ArrayUnion([event_data]),
            "state": session.state,
            "last_update_time": now,
        })
        session.last_update_time = now
        return event
