import asyncio
import logging
from fastapi import APIRouter, BackgroundTasks, Depends
from config import Settings, get_settings
from models import Song, SongsFile
from store import read_songs, write_songs
from routers.auth import get_device_id
from routers.songs import detect_platform
from services.youtube import fetch_youtube_playlists
from services.soundcloud import fetch_soundcloud_playlists
from services.downloader import download_song, get_file_path, _get_lock, remove_song_files

logger = logging.getLogger(__name__)

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


async def _auto_prepare_all(settings: Settings) -> None:
    data = read_songs(settings.data_dir)
    to_mark: set[str] = set()
    logger.info("👉 Auto prepare all undownloaded songs")
    for song in data.songs:
        if get_file_path(song.url, song.playlist, settings.music_dir):
            if not song.prepared:
                to_mark.add(song.id)
        else:
            async with _get_lock(song.id):
                if not get_file_path(song.url, song.playlist, settings.music_dir):
                    logger.info(f"👉 Downloading - {song.title}...")
                    try:
                        await asyncio.to_thread(download_song, song.url, song.playlist, settings.music_dir)
                        to_mark.add(song.id)
                    except Exception as e:
                        logger.error(f"❌ Failed - {song.title}: {e}")
    if to_mark:
        fresh = read_songs(settings.data_dir)
        changed = False
        for song in fresh.songs:
            if song.id in to_mark and not song.prepared:
                song.prepared = True
                changed = True
        if changed:
            write_songs(fresh, settings.data_dir)
    logger.info("✅ Prepared all songs")


async def _run_sync(settings: Settings):
    global _status
    _status = {"running": True, "added": 0, "total": 0, "error": None}
    try:
        all_playlists: list[dict] = []

        sync_platforms: set[str] = set()
        if settings.youtube_api_key and settings.youtube_channel_id:
            yt = await fetch_youtube_playlists(settings.youtube_api_key, settings.youtube_channel_id)
            all_playlists.extend(yt)
            sync_platforms.add("youtube")

        if settings.soundcloud_profile_url:
            sc = await asyncio.to_thread(fetch_soundcloud_playlists, settings.soundcloud_profile_url)
            all_playlists.extend(sc)
            sync_platforms.add("soundcloud")

        # Build source truth indexed by URL (first occurrence wins for duplicates)
        source_by_url: dict[str, dict] = {}
        playlist_order: dict[str, int] = {}   # playlist name -> source index
        song_order: dict[str, int] = {}        # url -> position within its playlist
        playlist_sources: dict[str, str] = {}  # playlist name -> platform

        for pl in all_playlists:
            pl_name = pl["title"]
            pl_platform = pl.get("platform", "other")
            if pl_name not in playlist_order:
                playlist_order[pl_name] = len(playlist_order)
            playlist_sources[pl_name] = pl_platform
            for i, track in enumerate(pl["songs"]):
                url = track.get("url", "")
                if not url:
                    continue
                if url not in source_by_url:
                    source_by_url[url] = {
                        "title": track["title"],
                        "url": url,
                        "platform": pl_platform,
                        "playlist": pl_name,
                        "thumbnail": track.get("thumbnail", ""),
                    }
                    song_order[url] = i

        data = read_songs(settings.data_dir)

        # A song is sync-managed if it comes from a configured platform and was not manually added
        def is_sync_managed(s: Song) -> bool:
            return s.platform in sync_platforms and not s.manually_added

        sync_songs_by_url = {s.url: s for s in data.songs if is_sync_managed(s)}
        manual_songs = [s for s in data.songs if not is_sync_managed(s)]

        # Delete MP3 files and sidecars for songs no longer in the source playlist
        stale_songs = [s for url, s in sync_songs_by_url.items() if url not in source_by_url]
        for stale in stale_songs:
            logger.info(f"🧹 [sync] stale file removed: {stale.title}")
            remove_song_files(stale.url, stale.playlist, settings.music_dir)

        # Rebuild sync songs from source, preserving existing ids and device_downloads
        new_sync_songs: list[Song] = []
        added = 0

        for url, track in source_by_url.items():
            if url in sync_songs_by_url:
                existing = sync_songs_by_url[url]
                existing.title = track["title"]
                existing.thumbnail = track["thumbnail"]
                existing.playlist = track["playlist"]
                new_sync_songs.append(existing)
            else:
                new_sync_songs.append(Song(
                    title=track["title"],
                    url=url,
                    platform=detect_platform(url),
                    playlist=track["playlist"],
                    thumbnail=track["thumbnail"],
                ))
                added += 1

        # Sort by source playlist order then by position within playlist
        new_sync_songs.sort(
            key=lambda s: (playlist_order.get(s.playlist, 9999), song_order.get(s.url, 0))
        )

        data.songs = new_sync_songs + manual_songs

        # Playlists: source order first, then any manual-only playlists appended
        manual_only_playlists = [
            p for p in dict.fromkeys(s.playlist for s in manual_songs)
            if p not in playlist_sources
        ]
        data.playlists = list(playlist_order.keys()) + manual_only_playlists
        data.playlist_sources = playlist_sources

        write_songs(data, settings.data_dir)
        _status = {"running": False, "added": added, "total": len(data.songs), "error": None}

        if settings.auto_prepare:
            asyncio.create_task(_auto_prepare_all(settings))
    except Exception as e:
        _status = {"running": False, "added": 0, "total": 0, "error": str(e)}
