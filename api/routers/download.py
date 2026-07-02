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
from services.downloader import download_song, get_file_path, _get_lock

router = APIRouter(prefix="/api/download", tags=["download"])


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

    if not get_file_path(song.url, song.playlist, settings.music_dir):
        async with _get_lock(song_id):
            if not get_file_path(song.url, song.playlist, settings.music_dir):
                print(f"[prepare] {song.title} — downloading…")
                try:
                    await asyncio.to_thread(download_song, song.url, song.playlist, settings.music_dir)
                    print(f"[prepare] {song.title} — ready")
                except Exception as e:
                    print(f"[prepare] {song.title} — failed: {e}")
                    raise HTTPException(status_code=500, detail=str(e).replace('\r', ' ').strip())
    else:
        if not song.prepared:
            print(f"[prepare] {song.title} — already on disk, marking prepared")

    if not song.prepared:
        song.prepared = True
        write_songs(data, settings.data_dir)

    return {"status": "ready"}


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

    if device_id not in song.device_downloads:
        device = next((d for d in data.devices if d.id == device_id), None)
        device_name = device.name if device else "Unknown"
        song.device_downloads[device_id] = DeviceDownload(name=device_name)
    song.device_downloads[device_id].downloaded = True
    song.device_downloads[device_id].downloaded_at = datetime.utcnow()
    song.prepared = True
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
        song.prepared = True
        write_songs(data, settings.data_dir)

    filename = Path(mp3_path).name
    content = Path(mp3_path).read_bytes()
    return Response(
        content=content,
        media_type="audio/mpeg",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}"},
    )
