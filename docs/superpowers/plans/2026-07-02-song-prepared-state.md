# Song Prepared State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `prepared` boolean to songs that tracks whether the MP3 is on the server disk, expose it in the API, show a subtle dot badge in the UI, and log all server-side prepare activity.

**Architecture:** `prepared: bool = False` lives on the `Song` model and is set to `True` by four code paths: `prepare_download`, `serve_download`, `download_tiktok`, and `_auto_prepare_all`. The startup scan piggybacks on `_auto_prepare_all` (which already checks `get_file_path` for every song). `get_songs` exposes `prepared` in the response; `SongRow` shows an 8px muted dot in the thumbnail's bottom-left corner when `prepared && !isDownloaded`.

**Tech Stack:** FastAPI + Python 3.12 (backend), React 19 + TypeScript strict + Tailwind CSS v4 (frontend)

## Global Constraints

- TypeScript strict mode — `cd web && npx tsc --noEmit` must pass zero errors
- No new npm or Python dependencies
- Only the six files listed in this task may be modified
- Docker build must succeed with no import errors
- Logging uses `print()` with bracketed prefixes — no logging library

---

### Task 1: Song Prepared State — Full Stack

**Files:**
- Modify: `api/models.py`
- Modify: `api/routers/songs.py`
- Modify: `api/routers/download.py`
- Modify: `api/routers/sync.py`
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/components/SongRow.tsx`

**Interfaces:**
- `Song.prepared: bool = False` (new field, persisted in songs.json)
- `SongResponse.prepared: boolean` (new field in TypeScript API type)
- `get_songs` response dict includes `"prepared": s.prepared`
- `_auto_prepare_all` marks `song.prepared = True` and calls `write_songs` once if anything changed

---

- [ ] **Step 1: Add `prepared` field to `Song` model**

Replace the entire `api/models.py`:

```python
from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field
import uuid


def new_id() -> str:
    return str(uuid.uuid4())


class DeviceDownload(BaseModel):
    name: str
    downloaded: bool = False
    downloaded_at: datetime | None = None


class Song(BaseModel):
    id: str = Field(default_factory=new_id)
    title: str
    url: str
    platform: Literal["youtube", "soundcloud", "tiktok", "other"]
    playlist: str = "Default"
    thumbnail: str = ""
    added_at: datetime = Field(default_factory=datetime.utcnow)
    device_downloads: dict[str, DeviceDownload] = Field(default_factory=dict)
    manually_added: bool = False
    prepared: bool = False


class Device(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str
    last_seen: datetime = Field(default_factory=datetime.utcnow)


class SongsFile(BaseModel):
    songs: list[Song] = Field(default_factory=list)
    playlists: list[str] = Field(default_factory=list)
    devices: list[Device] = Field(default_factory=list)
    playlist_sources: dict[str, str] = Field(default_factory=dict)
```

- [ ] **Step 2: Expose `prepared` in `get_songs` response**

Replace the entire `api/routers/songs.py`:

```python
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
            "prepared": s.prepared,
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
```

- [ ] **Step 3: Update `download.py` — mark prepared and add logging**

Replace the entire `api/routers/download.py`:

```python
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
```

- [ ] **Step 4: Update `sync.py` — add logging and mark prepared in `_auto_prepare_all`**

Replace the entire `api/routers/sync.py`:

```python
import asyncio
from fastapi import APIRouter, BackgroundTasks, Depends
from config import Settings, get_settings
from models import Song, SongsFile
from store import read_songs, write_songs
from routers.auth import get_device_id
from routers.songs import detect_platform
from services.youtube import fetch_youtube_playlists
from services.soundcloud import fetch_soundcloud_playlists
from services.downloader import download_song, get_file_path, _get_lock, remove_song_files

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
    changed = False
    for song in data.songs:
        if get_file_path(song.url, song.playlist, settings.music_dir):
            if not song.prepared:
                print(f"[auto-prepare] {song.title} — already on disk, marking prepared")
                song.prepared = True
                changed = True
        else:
            async with _get_lock(song.id):
                if not get_file_path(song.url, song.playlist, settings.music_dir):
                    print(f"[auto-prepare] {song.title} — downloading…")
                    try:
                        await asyncio.to_thread(download_song, song.url, song.playlist, settings.music_dir)
                        print(f"[auto-prepare] {song.title} — ready")
                        song.prepared = True
                        changed = True
                    except Exception as e:
                        print(f"[auto-prepare] {song.title} — failed: {e}")
    if changed:
        write_songs(data, settings.data_dir)


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
        playlist_order: dict[str, int] = {}
        song_order: dict[str, int] = {}
        playlist_sources: dict[str, str] = {}

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

        def is_sync_managed(s: Song) -> bool:
            return s.platform in sync_platforms and not s.manually_added

        sync_songs_by_url = {s.url: s for s in data.songs if is_sync_managed(s)}
        manual_songs = [s for s in data.songs if not is_sync_managed(s)]

        # Delete MP3 files and sidecars for songs no longer in the source playlist
        stale_songs = [s for url, s in sync_songs_by_url.items() if url not in source_by_url]
        for stale in stale_songs:
            print(f"[sync] stale file removed: {stale.title}")
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

        new_sync_songs.sort(
            key=lambda s: (playlist_order.get(s.playlist, 9999), song_order.get(s.url, 0))
        )

        data.songs = new_sync_songs + manual_songs

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
```

- [ ] **Step 5: Add `prepared` to `SongResponse` in `api.ts`**

In `web/src/lib/api.ts`, add `prepared: boolean` to the `SongResponse` interface. The updated interface:

```ts
export interface SongResponse {
  id: string
  title: string
  url: string
  platform: 'youtube' | 'soundcloud' | 'tiktok' | 'other'
  playlist: string
  thumbnail: string
  added_at: string
  downloaded: boolean
  prepared: boolean
}
```

- [ ] **Step 6: Add dot badge to `SongRow.tsx`**

In `web/src/components/SongRow.tsx`, add the prepared dot badge inside the thumbnail container. The existing structure has the downloaded checkmark badge at `-bottom-1 -right-1`. Add the prepared dot at `-bottom-1 -left-1`, directly after the downloaded badge block:

Find this block (the thumbnail container with the downloaded badge, around line 195):
```tsx
        <div className="relative shrink-0 w-10 h-10 rounded-md bg-[var(--color-surface-elevated)] overflow-visible flex items-center justify-center">
          <div className="w-10 h-10 rounded-md overflow-hidden flex items-center justify-center">
            {song.thumbnail ? (
              <img src={song.thumbnail} alt="" className="w-full h-full object-cover" />
            ) : (
              <PlatformIcon size={18} color={PLATFORM_COLORS[song.platform]} />
            )}
          </div>
          {isDownloaded && (
            <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[var(--color-bg)] flex items-center justify-center">
              <CheckCircle size={13} weight="fill" className="text-[var(--color-accent)]" />
            </span>
          )}
        </div>
```

Replace it with:
```tsx
        <div className="relative shrink-0 w-10 h-10 rounded-md bg-[var(--color-surface-elevated)] overflow-visible flex items-center justify-center">
          <div className="w-10 h-10 rounded-md overflow-hidden flex items-center justify-center">
            {song.thumbnail ? (
              <img src={song.thumbnail} alt="" className="w-full h-full object-cover" />
            ) : (
              <PlatformIcon size={18} color={PLATFORM_COLORS[song.platform]} />
            )}
          </div>
          {isDownloaded && (
            <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[var(--color-bg)] flex items-center justify-center">
              <CheckCircle size={13} weight="fill" className="text-[var(--color-accent)]" />
            </span>
          )}
          {song.prepared && !isDownloaded && (
            <span className="absolute -bottom-1 -left-1 w-2 h-2 rounded-full bg-[var(--color-text-muted)] ring-1 ring-[var(--color-bg)]" />
          )}
        </div>
```

- [ ] **Step 7: TypeScript check**

```bash
cd /home/ttndev/workspace/personal/music-assistant/web && npx tsc --noEmit
```

Expected: zero errors. Fix any before continuing.

- [ ] **Step 8: Docker build and deploy**

```bash
cd /home/ttndev/workspace/personal/music-assistant && docker compose up --build -d
```

Check logs:
```bash
docker compose logs app --tail=30
```

Expected: server starts cleanly, no import errors. If `AUTO_PREPARE=true` and songs exist, you should see `[auto-prepare]` lines appearing.

- [ ] **Step 9: Manual verification**

1. Open the app — songs whose MP3 files already exist on disk should show the small muted dot badge in the bottom-left of their thumbnail
2. Click "Download" on an unprepared song — watch `docker compose logs app -f` for `[prepare] … — downloading…` then `[prepare] … — ready`; dot badge should appear on that song row
3. After the dot appears, tap to download to phone — dot disappears, green ✓ appears
4. Trigger sync — check logs for `[sync] stale file removed:` entries if any songs were removed from source

- [ ] **Step 10: Commit**

```bash
git add api/models.py api/routers/songs.py api/routers/download.py api/routers/sync.py web/src/lib/api.ts web/src/components/SongRow.tsx
git commit -m "feat: add prepared state to songs with dot badge and server logging"
```
