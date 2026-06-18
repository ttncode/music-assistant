from fastapi import APIRouter, Depends, HTTPException, Header
from config import Settings, get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/verify")
async def verify(
    body: dict,
    settings: Settings = Depends(get_settings),
):
    code = body.get("code", "")
    if code != settings.access_code:
        raise HTTPException(status_code=401, detail="Invalid access code")
    return {"ok": True}


# Reusable dependency for all protected routes
async def get_device_id(x_device_id: str = Header(..., alias="X-Device-ID")) -> str:
    return x_device_id
