import json
import logging
import time
import uuid
from contextlib import contextmanager
from typing import Any

logger = logging.getLogger("medical_chat")


class RequestContext:
    def __init__(self, session_id: str = ""):
        self.request_id = str(uuid.uuid4())[:8]
        self.session_id = session_id
        self.start_time = time.time()
        self.tools_used: list[str] = []
        self.timings: dict[str, float] = {}
        self.kb_used = False
        self.web_used = False
        self.clarification_used = False
        self.status_code = 200
        self.error_type: str | None = None
        self._generation_start: float | None = None

    @contextmanager
    def time(self, label: str):
        t = time.time()
        yield
        self.timings[label] = round((time.time() - t) * 1000)

    def mark_generation_start(self):
        self._generation_start = time.time()

    def log_complete(self):
        total_ms = round((time.time() - self.start_time) * 1000)
        entry: dict[str, Any] = {
            "severity": "ERROR" if self.error_type else "INFO",
            "request_id": self.request_id,
            "session_id": self.session_id,
            "tools_used": self.tools_used,
            "kb_used": self.kb_used,
            "web_used": self.web_used,
            "status_code": self.status_code,
            "total_ms": total_ms,
        }

        if self._generation_start:
            entry["gemini_ttft_ms"] = round(
                (self._generation_start - self.start_time) * 1000
            )

        for k, v in self.timings.items():
            entry[f"{k}_ms"] = v

        if self.error_type:
            entry["error_type"] = self.error_type

        logger.info(json.dumps(entry))
