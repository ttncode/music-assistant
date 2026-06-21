# Platform Filter + TikTok Playlist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a platform filter row to the song list UI, ensure the TikTok playlist always appears, and save TikTok downloads to the shared library.

**Architecture:** Three independent tasks — frontend-only UI change, a one-line backend API injection, and a backend endpoint refactor with TDD. Tasks 2 and 3 are backend; their test command is `docker compose build --quiet && docker compose run --rm app python -m pytest tests/ -v 2>&1 | tail -20`.

**Tech Stack:** React 19, TypeScript strict (`noUnusedLocals`, `noUnusedParameters`), Tailwind CSS v4, Vite (frontend); FastAPI, Python 3.12, pytest, Docker (backend).

---

## File Map

| File | Task | Change |
|---|---|---|
| `web/src/components/FilterBar.tsx` | 1 | Replace entirely — add platform filter row, new props |
| `web/src/components/SongList.tsx` | 1 | Add `activePlatform` prop, filter condition, useEffect dep |
| `web/src/App.tsx` | 1 | Add `activePlatform` state, update `filteredUndownloadedIds`, pass new props |
| `api/routers/songs.py` | 2 | `get_songs`: inject TikTok into playlists/playlist_sources |
| `api/tests/test_songs.py` | 2 | 1 new test |
| `api/routers/download.py` | 3 | `download_tiktok`: save to library, track device download |
| `api/tests/test_download.py` | 3 | 2 new tests |

---

## Task 1: Platform Filter UI

**Files:**
- Replace: `web/src/components/FilterBar.tsx`
- Modify: `web/src/components/SongList.tsx`
- Modify: `web/src/App.tsx`

No frontend test framework. Verification: `cd web && npx tsc -b --noEmit` (zero errors).

- [ ] **Step 1: Replace FilterBar.tsx**

Replace the entire contents of `web/src/components/FilterBar.tsx` with:

```tsx
import { useState } from 'react'
import { MagnifyingGlass, YoutubeLogo, SoundcloudLogo, TiktokLogo } from '@phosphor-icons/react'
import { clsx } from 'clsx'

type Platform = 'all' | 'youtube' | 'soundcloud' | 'tiktok'

const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  tiktok: 'TikTok',
}

const PLATFORM_IDS: Platform[] = ['all', 'youtube', 'soundcloud', 'tiktok']

const PLATFORM_UI_LABELS: Record<Platform, string> = {
  all: 'All',
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  tiktok: 'TikTok',
}

function PlatformIcon({ id, active }: { id: Platform; active: boolean }) {
  const size = 12
  if (id === 'youtube') return <YoutubeLogo size={size} color={active ? 'currentColor' : 'var(--color-platform-youtube)'} />
  if (id === 'soundcloud') return <SoundcloudLogo size={size} color={active ? 'currentColor' : 'var(--color-platform-soundcloud)'} />
  if (id === 'tiktok') return <TiktokLogo size={size} color={active ? 'currentColor' : 'var(--color-platform-tiktok)'} />
  return null
}

interface Props {
  playlists: string[]
  activePlaylist: string
  search: string
  playlistSources: Record<string, string>
  activePlatform: Platform
  onPlaylistChange: (p: string) => void
  onSearchChange: (s: string) => void
  onPlatformChange: (p: Platform) => void
  onEnterSelectMode: () => void
}

export function FilterBar({
  playlists,
  activePlaylist,
  search,
  playlistSources,
  activePlatform,
  onPlaylistChange,
  onSearchChange,
  onPlatformChange,
  onEnterSelectMode,
}: Props) {
  const [tooltipInfo, setTooltipInfo] = useState<{ label: string; x: number; y: number } | null>(null)

  return (
    <>
      <div className="space-y-3 px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {PLATFORM_IDS.map(id => {
            const isActive = activePlatform === id
            return (
              <button
                key={id}
                onClick={() => onPlatformChange(id)}
                className={clsx(
                  'shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors flex items-center gap-1.5',
                  isActive
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
                )}
              >
                <PlatformIcon id={id} active={isActive} />
                {PLATFORM_UI_LABELS[id]}
              </button>
            )
          })}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {['All', ...playlists].map(pl => {
            const platformLabel = pl !== 'All' ? PLATFORM_LABELS[playlistSources[pl]] : undefined
            return (
              <button
                key={pl}
                onClick={() => onPlaylistChange(pl)}
                onMouseEnter={platformLabel ? (e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setTooltipInfo({ label: platformLabel, x: rect.left + rect.width / 2, y: rect.top })
                } : undefined}
                onMouseLeave={platformLabel ? () => setTooltipInfo(null) : undefined}
                className={clsx(
                  'shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  activePlaylist === pl
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
                )}
              >
                {pl}
              </button>
            )
          })}

          <button
            onClick={onEnterSelectMode}
            className="md:hidden shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs font-medium bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
          >
            Select
          </button>
        </div>

        <div className="relative">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search songs..."
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-4 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition-colors placeholder:text-[var(--color-text-muted)]"
          />
        </div>
      </div>

      {tooltipInfo && (
        <div
          className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full px-2 py-1 rounded text-[10px] bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] whitespace-nowrap"
          style={{ left: tooltipInfo.x, top: tooltipInfo.y - 6 }}
        >
          {tooltipInfo.label}
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: Update SongList.tsx**

In `web/src/components/SongList.tsx`, make three edits:

**2a — Add `activePlatform` to the Props interface** (after the existing `loading: boolean` line):

Change:
```tsx
interface Props {
  songs: SongResponse[]
  activePlaylist: string
  search: string
  loading: boolean
```
To:
```tsx
interface Props {
  songs: SongResponse[]
  activePlaylist: string
  search: string
  activePlatform: 'all' | 'youtube' | 'soundcloud' | 'tiktok'
  loading: boolean
```

**2b — Destructure the new prop** (in the function signature, after `search,`):

Change:
```tsx
export function SongList({
  songs,
  activePlaylist,
  search,
  loading,
```
To:
```tsx
export function SongList({
  songs,
  activePlaylist,
  search,
  activePlatform,
  loading,
```

**2c — Update `useEffect` dependency array and `filtered` computation** (around lines 39–64):

Change:
```tsx
  useEffect(() => {
    setPage(1)
  }, [activePlaylist, search])
```
To:
```tsx
  useEffect(() => {
    setPage(1)
  }, [activePlaylist, search, activePlatform])
```

Change:
```tsx
  const filtered = songs.filter(s => {
    const matchPlaylist = activePlaylist === 'All' || s.playlist === activePlaylist
    const matchSearch = !search || s.title.toLowerCase().includes(search.toLowerCase())
    return matchPlaylist && matchSearch
  })
```
To:
```tsx
  const filtered = songs.filter(s => {
    const matchPlaylist = activePlaylist === 'All' || s.playlist === activePlaylist
    const matchSearch = !search || s.title.toLowerCase().includes(search.toLowerCase())
    const matchPlatform = activePlatform === 'all' || s.platform === activePlatform
    return matchPlaylist && matchSearch && matchPlatform
  })
```

- [ ] **Step 3: Update App.tsx**

In `web/src/App.tsx`, make four edits:

**3a — Add `activePlatform` state** (after the `const [historyVersion, setHistoryVersion] = useState(0)` line):

Change:
```tsx
  const [historyVersion, setHistoryVersion] = useState(0)
```
To:
```tsx
  const [historyVersion, setHistoryVersion] = useState(0)
  const [activePlatform, setActivePlatform] = useState<'all' | 'youtube' | 'soundcloud' | 'tiktok'>('all')
```

**3b — Add platform filter to `filteredUndownloadedIds`**:

Change:
```tsx
  const filteredUndownloadedIds = songs
    .filter(s => {
      const matchPlaylist = activePlaylist === 'All' || s.playlist === activePlaylist
      const matchSearch = !search || s.title.toLowerCase().includes(search.toLowerCase())
      return matchPlaylist && matchSearch && !s.downloaded
    })
    .map(s => s.id)
```
To:
```tsx
  const filteredUndownloadedIds = songs
    .filter(s => {
      const matchPlaylist = activePlaylist === 'All' || s.playlist === activePlaylist
      const matchSearch = !search || s.title.toLowerCase().includes(search.toLowerCase())
      const matchPlatform = activePlatform === 'all' || s.platform === activePlatform
      return matchPlaylist && matchSearch && matchPlatform && !s.downloaded
    })
    .map(s => s.id)
```

**3c — Pass new props to FilterBar**:

Change:
```tsx
      <FilterBar
        playlists={playlists}
        activePlaylist={activePlaylist}
        search={search}
        playlistSources={playlistSources}
        onPlaylistChange={setActivePlaylist}
        onSearchChange={setSearch}
        onEnterSelectMode={enterSelectMode}
      />
```
To:
```tsx
      <FilterBar
        playlists={playlists}
        activePlaylist={activePlaylist}
        search={search}
        playlistSources={playlistSources}
        activePlatform={activePlatform}
        onPlaylistChange={setActivePlaylist}
        onSearchChange={setSearch}
        onPlatformChange={setActivePlatform}
        onEnterSelectMode={enterSelectMode}
      />
```

**3d — Pass new prop to SongList**:

Change:
```tsx
        <SongList
          songs={songs}
          activePlaylist={activePlaylist}
          search={search}
          loading={loading}
```
To:
```tsx
        <SongList
          songs={songs}
          activePlaylist={activePlaylist}
          search={search}
          activePlatform={activePlatform}
          loading={loading}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/ttndev/workspace/personal/music-assistant/web && npx tsc -b --noEmit 2>&1
```

Expected: no output (zero errors).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/FilterBar.tsx web/src/components/SongList.tsx web/src/App.tsx
git commit -m "feat: add platform filter row to song list"
```

---

## Task 2: TikTok Playlist Always Present

**Files:**
- Modify: `api/routers/songs.py`
- Modify: `api/tests/test_songs.py`

- [ ] **Step 1: Write the failing test**

Add to `api/tests/test_songs.py` (after the last existing test):

```python
def test_get_songs_always_includes_tiktok_playlist(client):
    res = client.get("/api/songs", headers=HEADERS)
    assert res.status_code == 200
    data = res.json()
    assert "TikTok" in data["playlists"]
    assert data["playlist_sources"]["TikTok"] == "tiktok"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose build --quiet && docker compose run --rm app python -m pytest tests/test_songs.py::test_get_songs_always_includes_tiktok_playlist -v 2>&1 | tail -10
```

Expected: `FAILED` — `"TikTok" not in []`.

- [ ] **Step 3: Implement in songs.py**

In `api/routers/songs.py`, replace the `get_songs` function:

Change:
```python
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
    return {"songs": songs_out, "playlists": data.playlists, "playlist_sources": data.playlist_sources}
```
To:
```python
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
docker compose build --quiet && docker compose run --rm app python -m pytest tests/test_songs.py -v 2>&1 | tail -15
```

Expected: all songs tests pass, including `test_get_songs_always_includes_tiktok_playlist`.

- [ ] **Step 5: Commit**

```bash
git add api/routers/songs.py api/tests/test_songs.py
git commit -m "feat: always include TikTok playlist in songs response"
```

---

## Task 3: TikTok Download → Shared Library

**Files:**
- Modify: `api/routers/download.py`
- Modify: `api/tests/test_download.py`

**Context:** `download_tiktok` currently downloads to a temp directory, returns the blob, and discards the file — no library entry is created. The new behaviour saves to `music_dir/TikTok/`, adds a `Song` to the shared store, and marks the requesting device as having downloaded it.

- [ ] **Step 1: Write the failing tests**

Add to `api/tests/test_download.py` (after the last existing test):

```python
def test_tiktok_download_adds_song_to_library(client, data_dir, music_dir):
    mp3 = _make_mp3(music_dir, "TikTok", "Cool Song.mp3")

    with patch("routers.download.download_song", return_value=str(mp3)):
        res = client.post(
            "/api/download/tiktok",
            json={"url": "https://www.tiktok.com/@user/video/123"},
            headers={"X-Device-ID": DEV},
        )

    assert res.status_code == 200
    data = read_songs(data_dir)
    assert len(data.songs) == 1
    song = data.songs[0]
    assert song.platform == "tiktok"
    assert song.playlist == "TikTok"
    assert song.url == "https://www.tiktok.com/@user/video/123"
    assert "TikTok" in data.playlists
    assert data.playlist_sources["TikTok"] == "tiktok"
    assert song.device_downloads[DEV].downloaded is True


def test_tiktok_download_deduplicates_by_url(client, data_dir, music_dir):
    url = "https://www.tiktok.com/@user/video/456"
    existing = Song(title="Old", url=url, platform="tiktok", playlist="TikTok")
    write_songs(SongsFile(songs=[existing], playlists=["TikTok"], devices=[]), data_dir)
    mp3 = _make_mp3(music_dir, "TikTok", "Old.mp3")

    with patch("routers.download.get_file_path", return_value=str(mp3)):
        res = client.post(
            "/api/download/tiktok",
            json={"url": url},
            headers={"X-Device-ID": DEV},
        )

    assert res.status_code == 200
    data = read_songs(data_dir)
    assert len(data.songs) == 1
    assert data.songs[0].device_downloads[DEV].downloaded is True
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
docker compose build --quiet && docker compose run --rm app python -m pytest tests/test_download.py::test_tiktok_download_adds_song_to_library tests/test_download.py::test_tiktok_download_deduplicates_by_url -v 2>&1 | tail -15
```

Expected: both `FAILED` — the endpoint returns 200 but makes no library changes.

- [ ] **Step 3: Implement in download.py**

In `api/routers/download.py`, make two changes:

**3a — Add `Song` to the imports** (line 13 currently imports `DeviceDownload`):

Change:
```python
from models import DeviceDownload
```
To:
```python
from models import DeviceDownload, Song
```

**3b — Replace the `download_tiktok` function**:

Change:
```python
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
```
To:
```python
@router.post("/tiktok")
async def download_tiktok(
    body: TikTokBody,
    device_id: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    data = read_songs(settings.data_dir)
    existing = next((s for s in data.songs if s.url == body.url), None)

    if existing:
        mp3_path = get_file_path(existing.url, existing.playlist, settings.music_dir)
        if not mp3_path or not Path(mp3_path).exists():
            mp3_path = await asyncio.to_thread(download_song, existing.url, existing.playlist, settings.music_dir)
        song = existing
    else:
        mp3_path = await asyncio.to_thread(download_song, body.url, "TikTok", settings.music_dir)
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
```

Note: `tempfile` is no longer used. Remove its import too.

**3c — Remove the unused `tempfile` import**:

Change:
```python
import asyncio
import tempfile
from datetime import datetime
```
To:
```python
import asyncio
from datetime import datetime
```

- [ ] **Step 4: Run the two new tests to verify they pass**

```bash
docker compose build --quiet && docker compose run --rm app python -m pytest tests/test_download.py::test_tiktok_download_adds_song_to_library tests/test_download.py::test_tiktok_download_deduplicates_by_url -v 2>&1 | tail -15
```

Expected: both `PASSED`.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
docker compose run --rm app python -m pytest tests/ -v 2>&1 | tail -20
```

Expected: all previously passing tests still pass, plus the 3 new tests (1 from Task 2, 2 from Task 3). The pre-existing `test_protected_route_requires_device_id` failure in `test_auth.py` is unrelated and pre-dates this work.

- [ ] **Step 6: Commit**

```bash
git add api/routers/download.py api/tests/test_download.py
git commit -m "feat: save TikTok downloads to shared library"
```
