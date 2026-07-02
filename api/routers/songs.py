import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from config import Settings, get_settings
from models import Song
from store import read_songs, write_songs
from routers.auth import get_device_id

router = APIRouter(prefix="/api/songs", tags=["songs"])

_PLATFORM_PATTERNS = [
    (r"youtube\.com|youtu\.be", "youtube"),
    (r"soundcloud\.com", "soundcloud"),
    (r"tiktok\.com", "tiktok"),
]


def detect_platform(url: str) -> str:
    for pattern, platform in _PLATFORM_PATTERNS:
        if re.search(pattern, url):
            return platform
    return "other"


class AddSongBody(BaseModel):
    url: str
    playlist: str = "Default"


@router.get("")
async def get_songs(
    device_id: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    data = read_songs(settings.data_dir)
    songs_out = []
    for s in data.songs:
        dd = s.device_downloads.get(device_id)
        songs_out.append({
            **s.model_dump(),
            "downloaded": dd.downloaded if dd else False,
        })
    playlists = list(data.playlists)
    if "TikTok" not in playlists:
        playlists.append("TikTok")
    playlist_sources = dict(data.playlist_sources)
    playlist_sources["TikTok"] = "tiktok"
    return {"songs": songs_out, "playlists": playlists, "playlist_sources": playlist_sources}


@router.post("", status_code=201)
async def add_song(
    body: AddSongBody,
    device_id: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    data = read_songs(settings.data_dir)
    if any(s.url == body.url for s in data.songs):
        raise HTTPException(status_code=409, detail="Already exists")
    song = Song(
        title=body.url,
        url=body.url,
        platform=detect_platform(body.url),
        playlist=body.playlist,
        manually_added=True,
    )
    data.songs.insert(0, song)
    if body.playlist not in data.playlists:
        data.playlists.append(body.playlist)
    write_songs(data, settings.data_dir)
    return song


@router.delete("/{song_id}")
async def delete_song(
    song_id: str,
    _: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    data = read_songs(settings.data_dir)
    data.songs = [s for s in data.songs if s.id != song_id]
    write_songs(data, settings.data_dir)
    return {"ok": True}
