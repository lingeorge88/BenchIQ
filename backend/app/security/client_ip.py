"""Resolve the real client IP for rate limiting."""
import hashlib
from fastapi import Request
from app import config


def client_ip(request: Request) -> str:
    """Return the caller's IP address.

    On Cloud Run the container only sees Google's front end; the front end appends the
    real client address as the right-most X-Forwarded-For entry. Left-most entries come
    from the client and can be forged, so they are ignored.
    """
    if config.TRUST_FORWARDED_FOR:
        forwarded = request.headers.get("x-forwarded-for", "")
        hops = [h.strip() for h in forwarded.split(",") if h.strip()]
        if hops:
            return hops[-1]
    return request.client.host if request.client else "unknown"


def ip_key(ip: str) -> str:
    """Short, non-reversible identifier for an IP (used in doc ids and logs)."""
    return hashlib.sha256(f"ip:{ip}".encode()).hexdigest()[:16]
