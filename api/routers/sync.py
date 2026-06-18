import asyncio
from fastapi import APIRouter, BackgroundTasks, Depends
from config import Settings, get_settings
from models import Song, SongsFile
from store import read_songs, write_songs
from routers.auth import get_device_id
from routers.songs import detect_platform
from services.youtube import fetch_youtube_playlists
from services.soundcloud import fetch_soundcloud_playlists

router = APIRouter(prefix="/api/sync", tags=["sync"])

_status: dict = {"running": False, "added": 0, "total": 0, "error": None}


@router.post("")
async def trigger_sync(
    background_tasks: BackgroundTasks,
    _: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    if _status["running"]:
        return {"message": "Sync already running"}
    background_tasks.add_task(_run_sync, settings)
    return {"message": "Sync started"}


@router.get("/status")
async def sync_status(_: str = Depends(get_device_id)):
    return _status


async def _run_sync(settings: Settings):
    global _status
    _status = {"running": True, "added": 0, "total": 0, "error": None}
    try:
        all_playlists: list[dict] = []

        if settings.youtube_api_key and settings.youtube_channel_id:
            yt = await fetch_youtube_playlists(settings.youtube_api_key, settings.youtube_channel_id)
            all_playlists.extend(yt)

        if settings.soundcloud_profile_url:
            sc = await asyncio.to_thread(fetch_soundcloud_playlists, settings.soundcloud_profile_url)
            all_playlists.extend(sc)

        data = read_songs(settings.data_dir)
        existing_urls = {s.url for s in data.songs}
        added = 0

        for pl in all_playlists:
            pl_name = pl["title"]
            if pl_name not in data.playlists:
                data.playlists.append(pl_name)
            for track in pl["songs"]:
                if track["url"] in existing_urls:
                    continue
                song = Song(
                    title=track["title"],
                    url=track["url"],
                    platform=detect_platform(track["url"]),
                    playlist=pl_name,
                    thumbnail=track.get("thumbnail", ""),
                )
                data.songs.append(song)
                existing_urls.add(track["url"])
                added += 1

        write_songs(data, settings.data_dir)
        _status = {"running": False, "added": added, "total": len(data.songs), "error": None}
    except Exception as e:
        _status = {"running": False, "added": 0, "total": 0, "error": str(e)}
