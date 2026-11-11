from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from google.adk.runners import Runner
from app.agent.agent import build_agent, root_agent
from app.sessions.service import create_session_service
from app.api import chat, health, stt, tts
from app import config
import logging
import os

logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL, logging.INFO),
    format="%(message)s" if config.ENVIRONMENT == "production" else "%(asctime)s %(levelname)s %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    session_service = create_session_service()
    runners = {
        m: Runner(
            agent=root_agent if m == config.GEMINI_MODEL else build_agent(m),
            app_name="medical_chat",
            session_service=session_service,
        )
        for m in config.ALLOWED_MODELS
    }
    chat.init(runners, session_service)
    print(f"ADK agent ready (env={config.ENVIRONMENT}, models={list(runners)})")
    yield


app = FastAPI(title="Medical Lab Assistant", lifespan=lifespan)

ALLOWED_ORIGINS = os.environ.get(
    "ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:8080"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(chat.router)
app.include_router(tts.router)
app.include_router(stt.router)

frontend_build = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "build")
if os.path.isdir(frontend_build):
    app.mount("/", StaticFiles(directory=frontend_build, html=True), name="static")
