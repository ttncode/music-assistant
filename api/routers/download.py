import asyncio
from datetime import datetime
from pathlib import Path
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from config import Settings, get_settings
from models import DeviceDownload, Song
from store import read_songs, write_songs
from routers.auth import get_device_id
from services.downloader import download_song, get_file_path

router = APIRouter(prefix="/api/download", tags=["download"])

_preparing: set[str] = set()  # song IDs currently being prepared
_download_locks: dict[str, asyncio.Lock] = {}  # per-song-id serialization


def _get_lock(song_id: str) -> asyncio.Lock:
    if song_id not in _download_locks:
        _download_locks[song_id] = asyncio.Lock()
    return _download_locks[song_id]


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
    async with _get_lock(song_id):
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
        async with _get_lock(song_id):
            # Re-check after acquiring lock — a concurrent prepare may have finished
            mp3_path = get_file_path(song.url, song.playlist, settings.music_dir)
            if not mp3_path or not Path(mp3_path).exists():
                try:
                    mp3_path = await asyncio.to_thread(download_song, song.url, song.playlist, settings.music_dir)
                except Exception as e:
                    raise HTTPException(status_code=500, detail=str(e).replace('\r', ' ').strip())

    filename = Path(mp3_path).name
    response = FileResponse(
        mp3_path,
        media_type="audio/mpeg",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}"},
    )

    # Mark as downloaded only after the response is successfully constructed
    if device_id not in song.device_downloads:
        device = next((d for d in data.devices if d.id == device_id), None)
        device_name = device.name if device else "Unknown"
        song.device_downloads[device_id] = DeviceDownload(name=device_name)
    song.device_downloads[device_id].downloaded = True
    song.device_downloads[device_id].downloaded_at = datetime.utcnow()
    write_songs(data, settings.data_dir)

    return response


@router.post("/tiktok")
async def download_tiktok(
    body: TikTokBody,
    device_id: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    async with _get_lock(body.url):
        data = read_songs(settings.data_dir)
        existing = next((s for s in data.songs if s.url == body.url), None)

        if existing:
            mp3_path = get_file_path(existing.url, existing.playlist, settings.music_dir)
            if not mp3_path or not Path(mp3_path).exists():
                try:
                    mp3_path = await asyncio.to_thread(download_song, existing.url, existing.playlist, settings.music_dir)
                except Exception as e:
                    raise HTTPException(status_code=500, detail=str(e).replace('\r', ' ').strip())
            song = existing
        else:
            try:
                mp3_path = await asyncio.to_thread(download_song, body.url, "TikTok", settings.music_dir)
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e).replace('\r', ' ').strip())
            song = Song(
                title=Path(mp3_path).stem,
                url=body.url,
                platform="tiktok",
                playlist="TikTok",
                manually_added=True,
            )
            data.songs.insert(0, song)
            if "TikTok" not in data.playlists:
                data.playlists.append("TikTok")

        data.playlist_sources["TikTok"] = "tiktok"

        if device_id not in song.device_downloads:
            device = next((d for d in data.devices if d.id == device_id), None)
            song.device_downloads[device_id] = DeviceDownload(name=device.name if device else "Unknown")
        song.device_downloads[device_id].downloaded = True
        song.device_downloads[device_id].downloaded_at = datetime.utcnow()
        write_songs(data, settings.data_dir)

    filename = Path(mp3_path).name
    content = Path(mp3_path).read_bytes()
    return Response(
        content=content,
        media_type="audio/mpeg",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}"},
    )
