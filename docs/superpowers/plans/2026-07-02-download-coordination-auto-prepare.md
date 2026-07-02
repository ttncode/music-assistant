# Download Coordination & Auto-Prepare Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disable per-song download buttons during any active download, and auto-prepare MP3 files on server startup + after sync, with stale file cleanup.

**Architecture:** Task 1 is pure frontend — coordinate download state across SongRows via SongList parent. Task 2 is pure backend — add `AUTO_PREPARE` env var, a fire-and-forget `_auto_prepare_all` coroutine, and stale MP3 deletion in the sync router.

**Tech Stack:** React 19 + TypeScript (frontend), FastAPI + Python 3.12 + asyncio (backend)

## Global Constraints

- TypeScript strict mode — no `any`, no unused locals/parameters (`cd web && npx tsc --noEmit` must pass zero errors)
- No new npm or Python dependencies
- No backend automated tests — manual verification only
- Match existing code style in each file (clsx for classNames, existing import order)

---

### Task 1: Frontend Download Coordination

**Files:**
- Modify: `web/src/components/SongRow.tsx`
- Modify: `web/src/components/SongList.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Produces: `SongRow` accepts `anyDownloading: boolean`, `isBatchRunning: boolean`, `onDownloadStart: () => void`, `onDownloadEnd: () => void`
- Produces: `SongList` accepts `isBatchRunning: boolean`

- [ ] **Step 1: Update `SongRow.tsx` — add props and coordination callbacks**

Add the four new props, compute `isDisabled`, call `onDownloadStart`/`onDownloadEnd` in `handleDownload`, and update the button's disabled state and visual style.

Replace the existing `Props` interface and `handleDownload` function and the download button JSX in `web/src/components/SongRow.tsx`:

```tsx
interface Props {
  song: SongResponse
  onDelete: (id: string) => void
  onDownloaded: () => void
  onError: (message: string) => void
  isSelectMode: boolean
  selected: boolean
  onToggle: (id: string) => void
  onEnterSelectMode: () => void
  isJustDownloaded?: boolean
  historyVersion: number
  anyDownloading: boolean
  isBatchRunning: boolean
  onDownloadStart: () => void
  onDownloadEnd: () => void
}
```

Update the destructure in `export function SongRow(...)`:
```tsx
export function SongRow({ song, onDelete, onDownloaded, onError, isSelectMode, selected, onToggle, onEnterSelectMode, isJustDownloaded, historyVersion, anyDownloading, isBatchRunning, onDownloadStart, onDownloadEnd }: Props) {
```

Replace `handleDownload`:
```tsx
async function handleDownload() {
  onDownloadStart()
  setDownloading(true)
  try {
    await api.download.prepare(song.id)
    api.download.file(song.id)
    setLocalDownloaded(true)
    onDownloaded()
  } catch (e) {
    onError(e instanceof Error ? e.message : 'Download failed')
  } finally {
    setDownloading(false)
    onDownloadEnd()
  }
}
```

Add `isDisabled` just before the `return` statement (after the `isDownloaded` line):
```tsx
const isDisabled = downloading || anyDownloading || isBatchRunning
```

Replace the download button JSX (inside `{!isDownloaded && (...)}`, currently starting at `<button onClick={handleDownload}`):
```tsx
{!isDownloaded && (
  <button
    onClick={handleDownload}
    disabled={isDisabled}
    className={clsx(
      'flex items-center gap-1 cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
      downloading
        ? 'text-[var(--color-text-muted)]'
        : isDisabled
          ? 'text-[var(--color-text-muted)] opacity-50'
          : 'text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)]',
    )}
  >
    <ArrowCircleDown size={14} className={downloading ? 'animate-spin' : ''} />
    {downloading ? 'Preparing...' : 'Download'}
  </button>
)}
```

- [ ] **Step 2: Update `SongList.tsx` — add `downloadingCount` state and pass new props**

Add `isBatchRunning` to Props, add `downloadingCount` state, define the two handlers, and thread them into each `<SongRow>`.

Add `isBatchRunning: boolean` to the Props interface in `web/src/components/SongList.tsx`:
```tsx
interface Props {
  songs: SongResponse[]
  activePlaylist: string
  search: string
  activePlatform: 'all' | 'youtube' | 'soundcloud' | 'tiktok'
  loading: boolean
  onDelete: (id: string) => void
  onDownloaded: () => void
  onError: (message: string) => void
  isSelectMode: boolean
  selected: Set<string>
  onToggle: (id: string) => void
  onEnterSelectMode: () => void
  justDownloaded: Set<string>
  historyVersion: number
  isBatchRunning: boolean
}
```

Add `isBatchRunning` to the destructure in `export function SongList(...)`:
```tsx
export function SongList({
  songs,
  activePlaylist,
  search,
  activePlatform,
  loading,
  onDelete,
  onDownloaded,
  onError,
  isSelectMode,
  selected,
  onToggle,
  onEnterSelectMode,
  justDownloaded,
  historyVersion,
  isBatchRunning,
}: Props) {
```

Add state and handlers right after the existing `const [page, setPage] = useState(1)` line:
```tsx
const [downloadingCount, setDownloadingCount] = useState(0)

function handleDownloadStart() { setDownloadingCount(c => c + 1) }
function handleDownloadEnd() { setDownloadingCount(c => Math.max(0, c - 1)) }
```

Replace the `<SongRow ... />` in the `pageItems.map` render:
```tsx
{pageItems.map(song => (
  <SongRow
    key={song.id}
    song={song}
    onDelete={onDelete}
    onDownloaded={onDownloaded}
    onError={onError}
    isSelectMode={isSelectMode}
    selected={selected.has(song.id)}
    onToggle={onToggle}
    onEnterSelectMode={onEnterSelectMode}
    isJustDownloaded={justDownloaded.has(song.id)}
    historyVersion={historyVersion}
    anyDownloading={downloadingCount > 0}
    isBatchRunning={isBatchRunning}
    onDownloadStart={handleDownloadStart}
    onDownloadEnd={handleDownloadEnd}
  />
))}
```

- [ ] **Step 3: Update `App.tsx` — pass `isRunning` to `SongList`**

In `web/src/App.tsx`, add `isBatchRunning={isRunning}` to the `<SongList>` JSX. The `isRunning` value is already destructured from `useBatchDownload` on line 59.

Find the `<SongList` block (around line 131) and add the prop:
```tsx
<SongList
  songs={songs}
  activePlaylist={activePlaylist}
  search={search}
  activePlatform={activePlatform}
  loading={loading}
  onDelete={handleDelete}
  onDownloaded={refetch}
  onError={(msg) => toast.error(msg)}
  isSelectMode={isSelectMode}
  selected={selected}
  onToggle={toggle}
  onEnterSelectMode={enterSelectMode}
  justDownloaded={justDownloaded}
  historyVersion={historyVersion}
  isBatchRunning={isRunning}
/>
```

- [ ] **Step 4: TypeScript check**

```bash
cd /home/ttndev/workspace/personal/music-assistant/web && npx tsc --noEmit
```

Expected: zero errors. If errors appear, fix them before continuing.

- [ ] **Step 5: Manual verification**

Build and run the app:
```bash
cd /home/ttndev/workspace/personal/music-assistant && docker compose up --build -d
```

Open the app in the browser. Verify:
1. Click "Download" on one song → all other Download buttons become grey/muted and unclickable while it prepares
2. Once that download finishes → all other Download buttons re-enable
3. Start a batch download (select multiple songs, click "Download N songs") → all per-song Download buttons are disabled during the batch

- [ ] **Step 6: Commit**

```bash
git add web/src/components/SongRow.tsx web/src/components/SongList.tsx web/src/App.tsx
git commit -m "feat: disable per-song download buttons during any active download"
```

---

### Task 2: Backend Auto-Prepare & Stale MP3 Cleanup

**Files:**
- Modify: `api/config.py`
- Modify: `api/routers/sync.py`
- Modify: `api/main.py`

**Interfaces:**
- Consumes: `get_file_path(url: str, playlist: str, music_dir: str) -> str | None` from `services.downloader`
- Consumes: `download_song(url: str, playlist: str, music_dir: str) -> str` from `services.downloader`
- Produces: `_auto_prepare_all(settings: Settings) -> None` coroutine in `sync.py`, imported by `main.py`

- [ ] **Step 1: Add `auto_prepare` setting to `api/config.py`**

Replace the entire `api/config.py`:
```python
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    access_code: str
    youtube_api_key: str = ""
    youtube_channel_id: str = ""
    soundcloud_profile_url: str = ""
    music_dir: str = "/music"
    data_dir: str = "/data"
    auto_prepare: bool = True

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 2: Update `api/routers/sync.py` — add imports, `_auto_prepare_all`, stale cleanup, post-sync trigger**

Replace the entire `api/routers/sync.py`:
```python
import asyncio
from pathlib import Path
from fastapi import APIRouter, BackgroundTasks, Depends
from config import Settings, get_settings
from models import Song, SongsFile
from store import read_songs, write_songs
from routers.auth import get_device_id
from routers.songs import detect_platform
from services.youtube import fetch_youtube_playlists
from services.soundcloud import fetch_soundcloud_playlists
from services.downloader import download_song, get_file_path

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
    for song in data.songs:
        if not get_file_path(song.url, song.playlist, settings.music_dir):
            try:
                await asyncio.to_thread(download_song, song.url, song.playlist, settings.music_dir)
            except Exception:
                pass  # non-fatal: skip and continue to next song


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

        # Delete MP3 files for songs that are no longer in the source playlist
        stale_songs = [s for url, s in sync_songs_by_url.items() if url not in source_by_url]
        for stale in stale_songs:
            mp3_path = get_file_path(stale.url, stale.playlist, settings.music_dir)
            if mp3_path:
                Path(mp3_path).unlink(missing_ok=True)

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
```

- [ ] **Step 3: Update `api/main.py` — import `_auto_prepare_all` and call it on startup**

Replace the entire `api/main.py`:
```python
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from config import get_settings, Settings
from routers import auth, devices, songs, sync, download, status
from routers.sync import _run_sync, _auto_prepare_all


async def _maybe_auto_sync(settings: Settings) -> None:
    if (Path(settings.data_dir) / "songs.json").exists():
        return
    from routers.sync import _status
    _status["running"] = True
    asyncio.create_task(_run_sync(settings))


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    await _maybe_auto_sync(settings)
    if settings.auto_prepare:
        asyncio.create_task(_auto_prepare_all(settings))
    yield


app = FastAPI(title="Music Assistant", lifespan=lifespan)

# API routes must be registered before the SPA catch-all
app.include_router(auth.router)
app.include_router(devices.router)
app.include_router(songs.router)
app.include_router(sync.router)
app.include_router(download.router)
app.include_router(status.router)

# Serve React build — only in production (web/dist must exist)
_DIST = Path(__file__).parent / "web" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(_DIST / "assets")), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def serve_spa(path: str):
        return FileResponse(str(_DIST / "index.html"))
```

- [ ] **Step 4: Docker build and deploy**

```bash
cd /home/ttndev/workspace/personal/music-assistant && docker compose up --build -d
```

Expected: build succeeds, container starts. Check logs to confirm no import errors:
```bash
docker compose logs app --tail=30
```

Expected: server starts with no tracebacks. If `AUTO_PREPARE=true` (default), you should see yt-dlp activity in the logs as it prepares songs in the background.

- [ ] **Step 5: Manual verification**

1. **Auto-prepare on startup** — restart the container with undownloaded songs in the library. Check the music directory (`docker exec music-assistant-app-1 ls /music`) to confirm MP3 files appear without any user action.

2. **Post-sync auto-prepare** — trigger a sync from the UI (sync button in header). After sync completes, watch logs for download activity: `docker compose logs app -f`. New songs should be prepared automatically.

3. **Stale MP3 cleanup** — if a song is removed from a source playlist, the next sync should delete its MP3 file from `/music`. (Can verify by checking `/music` before and after sync when a source song is gone.)

4. **AUTO_PREPARE=false** — add `AUTO_PREPARE=false` to your `.env` file, rebuild, and confirm no auto-downloading happens on startup or after sync. Stale cleanup still runs (check: a removed source song's MP3 disappears after sync).

- [ ] **Step 6: Commit**

```bash
git add api/config.py api/routers/sync.py api/main.py
git commit -m "feat: auto-prepare MP3s on startup and after sync, clean up stale files"
```
