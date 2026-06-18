import asyncio
import httpx
from fastapi import APIRouter, Depends
from config import Settings, get_settings

router = APIRouter(prefix="/api/status", tags=["status"])


async def _check_youtube(api_key: str, channel_id: str) -> dict:
    if not api_key or not channel_id:
        return {"configured": False, "reachable": False, "error": "Not configured"}
    url = (
        "https://www.googleapis.com/youtube/v3/channels"
        f"?key={api_key}&id={channel_id}&part=id&maxResults=1"
    )
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(url)
        if r.status_code == 200 and r.json().get("items"):
            return {"configured": True, "reachable": True, "error": None}
        return {"configured": True, "reachable": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"configured": True, "reachable": False, "error": str(e)}


async def _check_soundcloud(profile_url: str) -> dict:
    if not profile_url:
        return {"configured": False, "reachable": False, "error": "Not configured"}
    try:
        async with httpx.AsyncClient(timeout=5, follow_redirects=True) as client:
            r = await client.get(profile_url)
        if r.status_code == 200:
            return {"configured": True, "reachable": True, "error": None}
        return {"configured": True, "reachable": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"configured": True, "reachable": False, "error": str(e)}


@router.get("/providers")
async def provider_status(settings: Settings = Depends(get_settings)):
    youtube, soundcloud = await asyncio.gather(
        _check_youtube(settings.youtube_api_key, settings.youtube_channel_id),
        _check_soundcloud(settings.soundcloud_profile_url),
    )
    return {"youtube": youtube, "soundcloud": soundcloud}
