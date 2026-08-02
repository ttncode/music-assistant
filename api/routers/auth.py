import hmac
import secrets
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from config import Settings, get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

_TICKET_TTL = timedelta(minutes=5)
_pending_tickets: dict[str, datetime] = {}

_RATE_LIMIT_WINDOW = timedelta(minutes=15)
_RATE_LIMIT_MAX_ATTEMPTS = 10
# NOTE: keyed by request.client.host — if this app is ever placed behind a
# reverse proxy that doesn't forward the real client IP, all proxied clients
# share one rate-limit bucket. Fix proxy config if that ever applies; not
# handled here.
_attempts: dict[str, list[datetime]] = {}


def issue_ticket() -> str:
    ticket = secrets.token_urlsafe(24)
    _pending_tickets[ticket] = datetime.utcnow() + _TICKET_TTL
    return ticket


def consume_ticket(ticket: str) -> bool:
    expires_at = _pending_tickets.pop(ticket, None)
    if expires_at is None:
        return False
    return datetime.utcnow() < expires_at


def _check_rate_limit(client_key: str) -> None:
    now = datetime.utcnow()
    attempts = [t for t in _attempts.get(client_key, []) if now - t < _RATE_LIMIT_WINDOW]
    if len(attempts) >= _RATE_LIMIT_MAX_ATTEMPTS:
        _attempts[client_key] = attempts
        raise HTTPException(
            status_code=429,
            detail="Too many attempts, try again later",
            headers={"Retry-After": str(int(_RATE_LIMIT_WINDOW.total_seconds()))},
        )
    attempts.append(now)
    _attempts[client_key] = attempts


def _reset_rate_limit(client_key: str) -> None:
    _attempts.pop(client_key, None)


@router.post("/verify")
async def verify(
    request: Request,
    body: dict,
    settings: Settings = Depends(get_settings),
):
    client_key = request.client.host if request.client else "unknown"
    _check_rate_limit(client_key)
    code = body.get("code", "")
    if not hmac.compare_digest(code, settings.access_code):
        raise HTTPException(status_code=401, detail="Invalid access code")
    _reset_rate_limit(client_key)
    return {"ok": True, "ticket": issue_ticket()}


# Reusable dependency for all protected routes
async def get_device_id(x_device_id: str = Header(..., alias="X-Device-ID")) -> str:
    return x_device_id
