from dataclasses import dataclass
from datetime import datetime


@dataclass
class QuotaState:
    client_id: str
    used: int
    limit: int
    remaining: int
    reset_at: str
    burst_used: int
    burst_limit: int


@dataclass
class QuotaResponse:
    allowed: bool
    state: QuotaState
    reason: str = ""
