from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from config import Settings, get_settings
from models import Device
from store import read_songs, write_songs
from routers.auth import get_device_id

router = APIRouter(prefix="/api/devices", tags=["devices"])


class RegisterBody(BaseModel):
    name: str


@router.post("/register", status_code=201)
async def register_device(body: RegisterBody, settings: Settings = Depends(get_settings)):
    data = read_songs(settings.data_dir)
    device = Device(name=body.name)
    data.devices.append(device)
    write_songs(data, settings.data_dir)
    return {"id": device.id, "name": device.name}


@router.delete("/{device_id}/history")
async def clear_history(
    device_id: str,
    _: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    data = read_songs(settings.data_dir)
    for song in data.songs:
        if device_id in song.device_downloads:
            song.device_downloads[device_id].downloaded = False
            song.device_downloads[device_id].downloaded_at = None
    write_songs(data, settings.data_dir)
    return {"ok": True}
