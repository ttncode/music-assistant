import hmac
import secrets
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Header
from config import Settings, get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

_TICKET_TTL = timedelta(minutes=5)
_pending_tickets: dict[str, datetime] = {}


def issue_ticket() -> str:
    ticket = secrets.token_urlsafe(24)
    _pending_tickets[ticket] = datetime.utcnow() + _TICKET_TTL
    return ticket


def consume_ticket(ticket: str) -> bool:
    expires_at = _pending_tickets.pop(ticket, None)
    if expires_at is None:
        return False
    return datetime.utcnow() < expires_at


@router.post("/verify")
async def verify(
    body: dict,
    settings: Settings = Depends(get_settings),
):
    code = body.get("code", "")
    if not hmac.compare_digest(code, settings.access_code):
        raise HTTPException(status_code=401, detail="Invalid access code")
    return {"ok": True, "ticket": issue_ticket()}


# Reusable dependency for all protected routes
async def get_device_id(x_device_id: str = Header(..., alias="X-Device-ID")) -> str:
    return x_device_id
