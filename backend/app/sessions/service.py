from app.sessions.firestore_session_service import FirestoreSessionService


def create_session_service():
    return FirestoreSessionService()
