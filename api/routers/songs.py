from fastapi import APIRouter, Depends
from routers.auth import get_device_id

router = APIRouter(prefix="/api/songs", tags=["songs"])


@router.get("")
async def list_songs(device_id: str = Depends(get_device_id)):
    return {"songs": []}
