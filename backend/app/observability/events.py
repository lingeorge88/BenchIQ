import json
from dataclasses import dataclass
from typing import Any


@dataclass
class SSEEvent:
    type: str
    data: dict[str, Any]

    def encode(self) -> str:
        return f"data: {json.dumps({'type': self.type, **self.data})}\n\n"


def status_event(message: str) -> str:
    return SSEEvent(type="status", data={"message": message}).encode()


def tool_start_event(tool: str, message: str) -> str:
    return SSEEvent(type="tool_start", data={"tool": tool, "message": message}).encode()


def tool_result_event(tool: str, result_count: int) -> str:
    return SSEEvent(type="tool_result", data={"tool": tool, "result_count": result_count}).encode()


def generation_start_event() -> str:
    return SSEEvent(type="generation_start", data={"message": "Generating response…"}).encode()


def token_event(text: str) -> str:
    return SSEEvent(type="token", data={"text": text}).encode()


def done_event(tools_used: list[str], quota: dict | None = None) -> str:
    data: dict[str, Any] = {"tools_used": tools_used}
    if quota:
        data["quota"] = quota
    return SSEEvent(type="done", data=data).encode()


def error_event(message: str) -> str:
    return SSEEvent(type="error", data={"message": message}).encode()


TOOL_MESSAGES = {
    "search_knowledge_base": "Searching analyzer documentation…",
    "web_search": "Checking web sources…",
    "ask_clarification": "Preparing clarification…",
}
