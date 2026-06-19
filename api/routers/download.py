import asyncio
import tempfile
from datetime import datetime
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from config import Settings, get_settings
from models import DeviceDownload
from store import read_songs, write_songs
from routers.auth import get_device_id
from services.downloader import download_song, get_file_path

router = APIRouter(prefix="/api/download", tags=["download"])

_preparing: set[str] = set()  # song IDs currently being prepared


class TikTokBody(BaseModel):
    url: str


@router.post("/{song_id}/prepare")
async def prepare_download(
    song_id: str,
    device_id: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    data = read_songs(settings.data_dir)
    song = next((s for s in data.songs if s.id == song_id), None)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    existing = get_file_path(song.url, song.playlist, settings.music_dir)
    if existing:
        return {"status": "ready"}

    if song_id not in _preparing:
        _preparing.add(song_id)
        asyncio.create_task(_do_prepare(song_id, song.url, song.playlist, settings.music_dir))

    return {"status": "downloading"}


async def _do_prepare(song_id: str, url: str, playlist: str, music_dir: str):
    try:
        await asyncio.to_thread(download_song, url, playlist, music_dir)
    finally:
        _preparing.discard(song_id)


@router.get("/{song_id}")
async def serve_download(
    song_id: str,
    device_id: str = Query(...),
    settings: Settings = Depends(get_settings),
):
    data = read_songs(settings.data_dir)
    song = next((s for s in data.songs if s.id == song_id), None)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    mp3_path = get_file_path(song.url, song.playlist, settings.music_dir)
    if not mp3_path or not Path(mp3_path).exists():
        try:
            mp3_path = await asyncio.to_thread(download_song, song.url, song.playlist, settings.music_dir)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    # Mark as downloaded for this device
    if device_id not in song.device_downloads:
        device = next((d for d in data.devices if d.id == device_id), None)
        device_name = device.name if device else "Unknown"
        song.device_downloads[device_id] = DeviceDownload(name=device_name)
    song.device_downloads[device_id].downloaded = True
    song.device_downloads[device_id].downloaded_at = datetime.utcnow()
    write_songs(data, settings.data_dir)

    filename = Path(mp3_path).name
    return FileResponse(
        mp3_path,
        media_type="audio/mpeg",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/tiktok")
async def download_tiktok(
    body: TikTokBody,
    _: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    with tempfile.TemporaryDirectory() as tmpdir:
        mp3_path = await asyncio.to_thread(download_song, body.url, "_tiktok_tmp", tmpdir)
        filename = Path(mp3_path).name
        content = Path(mp3_path).read_bytes()

    return Response(
        content=content,
        media_type="audio/mpeg",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
