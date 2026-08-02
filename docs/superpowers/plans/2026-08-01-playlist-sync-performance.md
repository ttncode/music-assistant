# Playlist Sync Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make playlist sync (`POST /api/sync`) and its background download pass fast, by parallelizing network fetches and downloads, eliminating an O(playlists) rescan on every download check, and unblocking the event loop during sync — without changing the sync/download contract (same songs, same playlists, same `device_downloads` tracking).

**Architecture:** Six independent, sequential changes to `api/config.py`, `api/services/youtube.py`, `api/services/downloader.py`, `api/routers/sync.py`, and `api/main.py`. Each task is self-contained and independently testable; later tasks (5, 6) consume settings/functions introduced by earlier tasks (1, 3).

**Tech Stack:** Python 3.12, FastAPI, `asyncio`, pytest + `pytest-asyncio` (`asyncio_mode = auto`, see `api/pytest.ini`).

## Global Constraints

- No changes to `Song`, `SongsFile`, or any API request/response shape.
- No changes to `music_dir` layout — folder-per-playlist storage stays exactly as-is (evaluated and rejected flattening; see `docs/superpowers/specs/2026-08-01-playlist-sync-performance-design.md` Context section).
- `get_file_path(url, playlist, music_dir)`'s existing 3-arg call sites (`api/routers/download.py`) must keep working unchanged — the new `index` parameter is optional and defaults to `None`.
- Run tests from the `api/` directory using the existing venv: `cd api && .venv/bin/python -m pytest tests/<file>.py::<test> -v`.

---

## Task 1: Add `max_concurrent_downloads` setting

**Files:**
- Modify: `api/config.py`
- Test: Create `api/tests/test_config.py`

**Interfaces:**
- Produces: `Settings.max_concurrent_downloads: int` (default `3`), consumed by Task 5.

- [ ] **Step 1: Write the failing test**

Create `api/tests/test_config.py`:

```python
def test_settings_default_max_concurrent_downloads():
    from config import Settings
    settings = Settings(access_code="secret")
    assert settings.max_concurrent_downloads == 3


def test_settings_max_concurrent_downloads_overridable(monkeypatch):
    from config import Settings
    monkeypatch.setenv("MAX_CONCURRENT_DOWNLOADS", "7")
    settings = Settings(access_code="secret")
    assert settings.max_concurrent_downloads == 7
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && .venv/bin/python -m pytest tests/test_config.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'max_concurrent_downloads'`

- [ ] **Step 3: Write minimal implementation**

In `api/config.py`, add the field to the `Settings` class (after `auto_prepare: bool = True`):

```python
class Settings(BaseSettings):
    app_name: str = "Music Assistant"
    app_env: str = "local"
    app_version: str = "0.1.0"
    access_code: str
    youtube_api_key: str = ""
    youtube_channel_id: str = ""
    soundcloud_profile_url: str = ""
    music_dir: str = "/music"
    data_dir: str = "/data"
    auto_prepare: bool = True
    max_concurrent_downloads: int = 3

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && .venv/bin/python -m pytest tests/test_config.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add api/config.py api/tests/test_config.py
git commit -m "feat: add max_concurrent_downloads setting"
```

---

## Task 2: Parallelize YouTube per-playlist item fetch

**Files:**
- Modify: `api/services/youtube.py`
- Test: Modify `api/tests/test_sync.py`

**Interfaces:**
- No cross-task dependency. `fetch_youtube_playlists(api_key: str, channel_id: str) -> list[dict]` signature unchanged.

- [ ] **Step 1: Write the failing test**

In `api/tests/test_sync.py`, add a new test alongside the existing
`test_fetch_youtube_playlists_returns_structured_data`:

```python
@pytest.mark.asyncio
async def test_fetch_youtube_playlists_fetches_playlist_items_concurrently():
    playlists_response = {
        "items": [
            {"id": "PLabc", "snippet": {"title": "Chill"}},
            {"id": "PLdef", "snippet": {"title": "Workout"}},
        ]
    }
    items_by_playlist = {
        "PLabc": {"items": [{
            "snippet": {"title": "Song One", "resourceId": {"videoId": "vid1"}, "thumbnails": {}},
        }]},
        "PLdef": {"items": [{
            "snippet": {"title": "Song Two", "resourceId": {"videoId": "vid2"}, "thumbnails": {}},
        }]},
    }
    state = {"current": 0, "max": 0}

    async def mock_get(self_or_url, url_or_none=None, **kwargs):
        url = url_or_none if url_or_none is not None else self_or_url
        params = kwargs.get("params", {})

        class R:
            def raise_for_status(self): pass
            def json(self):
                if "playlistItems" in url:
                    return items_by_playlist[params["playlistId"]]
                return playlists_response

        if "playlistItems" in url:
            state["current"] += 1
            state["max"] = max(state["max"], state["current"])
            await asyncio.sleep(0.05)
            state["current"] -= 1
        return R()

    with patch("httpx.AsyncClient.get", new=mock_get):
        from services.youtube import fetch_youtube_playlists
        result = await fetch_youtube_playlists("key123", "UCchannel")

    assert state["max"] == 2
    songs_by_title = {pl["title"]: pl["songs"][0]["title"] for pl in result}
    assert songs_by_title["Chill"] == "Song One"
    assert songs_by_title["Workout"] == "Song Two"
```

`test_sync.py` doesn't import `asyncio` yet — add `import asyncio` to its
top-level imports alongside the existing `import pytest`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && .venv/bin/python -m pytest tests/test_sync.py::test_fetch_youtube_playlists_fetches_playlist_items_concurrently -v`
Expected: FAIL — `assert 1 == 2` (the current sequential `for` loop never has two `_get_playlist_items` calls in flight at once)

- [ ] **Step 3: Write minimal implementation**

In `api/services/youtube.py`, add the `asyncio` import and change
`fetch_youtube_playlists`:

```python
import asyncio
import httpx

_BASE = "https://www.googleapis.com/youtube/v3"


async def fetch_youtube_playlists(api_key: str, channel_id: str) -> list[dict]:
    async with httpx.AsyncClient() as client:
        playlists = await _get_playlists(client, api_key, channel_id)
        songs_lists = await asyncio.gather(
            *(_get_playlist_items(client, api_key, pl["id"]) for pl in playlists)
        )
        return [
            {"title": pl["snippet"]["title"], "playlist_id": pl["id"], "platform": "youtube", "songs": songs}
            for pl, songs in zip(playlists, songs_lists)
        ]
```

(`_get_playlists` and `_get_playlist_items` are unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && .venv/bin/python -m pytest tests/test_sync.py -k fetch_youtube -v`
Expected: PASS (both youtube fetch tests)

- [ ] **Step 5: Commit**

```bash
git add api/services/youtube.py api/tests/test_sync.py
git commit -m "perf: fetch youtube playlist items concurrently"
```

---

## Task 3: Index-once self-heal lookup in `get_file_path`

**Files:**
- Modify: `api/services/downloader.py`
- Test: Modify `api/tests/test_download.py`

**Interfaces:**
- Produces: `build_sidecar_index(music_dir: str) -> dict[str, Path]`, and extends
  `get_file_path(url: str, playlist: str, music_dir: str, index: dict[str, Path] | None = None) -> str | None`.
  Consumed by Task 5. Existing 3-arg callers (`api/routers/download.py`) are unaffected — `index` defaults to `None`, preserving the current per-call scan behavior exactly.

- [ ] **Step 1: Write the failing test**

In `api/tests/test_download.py`, add (near the existing `get_file_path` tests):

```python
def test_build_sidecar_index_maps_hash_to_sidecar_across_playlists(tmp_path):
    from services.downloader import build_sidecar_index, _url_hash, _sanitize
    folder_a = tmp_path / _sanitize("Chill")
    folder_a.mkdir()
    url_a = "https://youtube.com/watch?v=aaa"
    sidecar_a = folder_a / f".{_url_hash(url_a)}.done"
    sidecar_a.write_text(str(folder_a / "Song A.mp3"))

    folder_b = tmp_path / _sanitize("Workout")
    folder_b.mkdir()
    url_b = "https://youtube.com/watch?v=bbb"
    sidecar_b = folder_b / f".{_url_hash(url_b)}.done"
    sidecar_b.write_text(str(folder_b / "Song B.mp3"))

    index = build_sidecar_index(str(tmp_path))

    assert index[_url_hash(url_a)] == sidecar_a
    assert index[_url_hash(url_b)] == sidecar_b


def test_build_sidecar_index_empty_when_music_dir_missing(tmp_path):
    from services.downloader import build_sidecar_index
    missing = tmp_path / "does-not-exist"
    assert build_sidecar_index(str(missing)) == {}


@pytest.mark.parametrize("use_index", [False, True])
def test_get_file_path_relocates_file_from_different_playlist_folder_with_and_without_index(tmp_path, use_index):
    from services.downloader import get_file_path, build_sidecar_index, _url_hash, _sanitize
    url = "https://youtube.com/watch?v=moved2"
    old_folder = tmp_path / _sanitize("OldPlaylist")
    old_folder.mkdir()
    mp3 = old_folder / "Moved Song.mp3"
    mp3.write_text("fake")
    old_sidecar = old_folder / f".{_url_hash(url)}.done"
    old_sidecar.write_text(str(mp3))

    index = build_sidecar_index(str(tmp_path)) if use_index else None
    result = get_file_path(url, "NewPlaylist", str(tmp_path), index)

    new_folder = tmp_path / _sanitize("NewPlaylist")
    new_mp3 = new_folder / "Moved Song.mp3"
    assert result == str(new_mp3)
    assert new_mp3.exists()
    assert not mp3.exists()
    assert not old_sidecar.exists()
    assert (new_folder / f".{_url_hash(url)}.done").exists()


@pytest.mark.parametrize("use_index", [False, True])
def test_get_file_path_cleans_up_stale_sidecar_with_and_without_index(tmp_path, use_index):
    from services.downloader import get_file_path, build_sidecar_index, _url_hash, _sanitize
    url = "https://youtube.com/watch?v=gone2"
    old_folder = tmp_path / _sanitize("OldPlaylist")
    old_folder.mkdir()
    old_sidecar = old_folder / f".{_url_hash(url)}.done"
    old_sidecar.write_text(str(old_folder / "Deleted Song.mp3"))

    index = build_sidecar_index(str(tmp_path)) if use_index else None
    result = get_file_path(url, "NewPlaylist", str(tmp_path), index)

    assert result is None
    assert not old_sidecar.exists()
```

`test_download.py` already has `import pytest` at the top — no new import needed for `parametrize`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && .venv/bin/python -m pytest tests/test_download.py -k "sidecar_index or with_and_without_index" -v`
Expected: FAIL — `ImportError: cannot import name 'build_sidecar_index'`

- [ ] **Step 3: Write minimal implementation**

In `api/services/downloader.py`, replace the existing `get_file_path` function
with this (keep everything else in the file — `_get_lock`, `_sanitize`,
`_url_hash`, `download_song`, `remove_song_files` — unchanged):

```python
def build_sidecar_index(music_dir: str) -> dict[str, Path]:
    """Map url_hash -> sidecar path for every sidecar under music_dir, built with one directory walk."""
    index: dict[str, Path] = {}
    root = Path(music_dir)
    if not root.exists():
        return index
    for folder in root.iterdir():
        if not folder.is_dir():
            continue
        for sidecar in folder.glob(".*.done"):
            h = sidecar.name[1:-5]  # strip leading "." and trailing ".done"
            index[h] = sidecar
    return index


def _relocate(other_sidecar: Path, sidecar: Path, folder: Path) -> str | None:
    """Move the MP3 recorded by other_sidecar into folder, rewrite the sidecar there.

    Returns the new path, or None (and deletes other_sidecar) if the recorded MP3 no longer exists.
    """
    old_mp3 = Path(other_sidecar.read_text().strip())
    if not old_mp3.exists():
        other_sidecar.unlink(missing_ok=True)
        return None
    folder.mkdir(parents=True, exist_ok=True)
    new_mp3 = folder / old_mp3.name
    old_mp3.rename(new_mp3)
    other_sidecar.unlink()
    sidecar.write_text(str(new_mp3))
    return str(new_mp3)


def get_file_path(url: str, playlist: str, music_dir: str, index: dict[str, Path] | None = None) -> str | None:
    """Return path to existing MP3 for this URL if already downloaded, else None.

    Self-heals across playlist moves: if the song was downloaded while it
    belonged to a different playlist, the file is found under that old
    playlist's folder and relocated into the current one here, so the song
    is never redownloaded just because its playlist changed.

    If `index` is provided (a hash -> sidecar path map from
    build_sidecar_index), the fallback lookup uses it instead of scanning
    music_dir directly — for batch callers that already built one index for
    the whole run.
    """
    url_hash = _url_hash(url)
    hash_name = f".{url_hash}.done"
    safe_playlist = _sanitize(playlist)
    folder = Path(music_dir) / safe_playlist

    sidecar = folder / hash_name
    if sidecar.exists():
        return sidecar.read_text().strip()

    if index is not None:
        other_sidecar = index.get(url_hash)
        if other_sidecar is None or other_sidecar.parent == folder:
            return None
        return _relocate(other_sidecar, sidecar, folder)

    root = Path(music_dir)
    if not root.exists():
        return None

    for other in root.iterdir():
        if not other.is_dir() or other == folder:
            continue
        other_sidecar = other / hash_name
        if not other_sidecar.exists():
            continue
        result = _relocate(other_sidecar, sidecar, folder)
        if result is not None:
            return result
        continue

    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && .venv/bin/python -m pytest tests/test_download.py -v`
Expected: PASS (all tests in the file, including the pre-existing ones — confirms no regression)

- [ ] **Step 5: Commit**

```bash
git add api/services/downloader.py api/tests/test_download.py
git commit -m "perf: build sidecar index once per run instead of rescanning per lookup"
```

---

## Task 4: Run YouTube and SoundCloud discovery concurrently

**Files:**
- Modify: `api/routers/sync.py` (`_run_sync` only)
- Test: Modify `api/tests/test_sync.py`

**Interfaces:**
- No cross-task dependency. `_run_sync(settings: Settings) -> None` signature unchanged.

- [ ] **Step 1: Write the failing test**

In `api/tests/test_sync.py`, add:

```python
@pytest.mark.asyncio
async def test_run_sync_fetches_youtube_and_soundcloud_concurrently(data_dir, tmp_path):
    import time
    from config import Settings
    from routers.sync import _run_sync
    from store import read_songs

    settings = Settings(
        access_code="secret",
        data_dir=data_dir,
        music_dir=str(tmp_path / "music"),
        youtube_api_key="key",
        youtube_channel_id="chan",
        soundcloud_profile_url="https://soundcloud.com/someone",
        auto_prepare=False,
    )

    async def fake_youtube(*args, **kwargs):
        await asyncio.sleep(0.1)
        return [{"title": "YT Playlist", "platform": "youtube",
                  "songs": [{"title": "YT Song", "url": "https://youtube.com/watch?v=yt1", "thumbnail": ""}]}]

    def fake_soundcloud(*args, **kwargs):
        time.sleep(0.1)
        return [{"title": "SC Playlist", "platform": "soundcloud",
                  "songs": [{"title": "SC Song", "url": "https://soundcloud.com/track1", "thumbnail": ""}]}]

    with patch("routers.sync.fetch_youtube_playlists", side_effect=fake_youtube), \
         patch("routers.sync.fetch_soundcloud_playlists", side_effect=fake_soundcloud):
        start = time.monotonic()
        await _run_sync(settings)
        elapsed = time.monotonic() - start

    assert elapsed < 0.18  # sequential (0.1s + 0.1s) would take >= 0.2s; concurrent takes ~0.1s
    data = read_songs(data_dir)
    urls = {s.url for s in data.songs}
    assert "https://youtube.com/watch?v=yt1" in urls
    assert "https://soundcloud.com/track1" in urls
```

`auto_prepare=False` avoids scheduling a real `_auto_prepare_all` background
task (which would try to invoke real `yt_dlp` downloads) at the end of
`_run_sync`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && .venv/bin/python -m pytest tests/test_sync.py::test_run_sync_fetches_youtube_and_soundcloud_concurrently -v`
Expected: FAIL — `assert 0.2... < 0.18` (the current sequential `await`/`await` takes the sum of both fetch times, not the max)

- [ ] **Step 3: Write minimal implementation**

In `api/routers/sync.py`, in `_run_sync`, replace this block:

```python
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
```

with:

```python
        all_playlists: list[dict] = []
        sync_platforms: set[str] = set()

        fetch_tasks = []
        fetch_platforms = []
        if settings.youtube_api_key and settings.youtube_channel_id:
            fetch_tasks.append(fetch_youtube_playlists(settings.youtube_api_key, settings.youtube_channel_id))
            fetch_platforms.append("youtube")
        if settings.soundcloud_profile_url:
            fetch_tasks.append(asyncio.to_thread(fetch_soundcloud_playlists, settings.soundcloud_profile_url))
            fetch_platforms.append("soundcloud")

        if fetch_tasks:
            results = await asyncio.gather(*fetch_tasks)
            for platform, playlists in zip(fetch_platforms, results):
                all_playlists.extend(playlists)
                sync_platforms.add(platform)
```

Also change `data = read_songs(settings.data_dir)` (a few lines further
down, right after the `source_by_url`/`playlist_order`/`song_order`/
`playlist_sources` build loop) to:

```python
        data = await asyncio.to_thread(read_songs, settings.data_dir)
```

And change `write_songs(data, settings.data_dir)` (near the end, right
before `_status = {"running": False, ...}`) to:

```python
        await asyncio.to_thread(write_songs, data, settings.data_dir)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && .venv/bin/python -m pytest tests/test_sync.py -v`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add api/routers/sync.py api/tests/test_sync.py
git commit -m "perf: run youtube and soundcloud discovery concurrently, unblock event loop in _run_sync"
```

---

## Task 5: Bounded-parallel downloads in `_auto_prepare_all`

**Files:**
- Modify: `api/routers/sync.py` (`_auto_prepare_all` and its import line only)
- Test: Modify `api/tests/test_sync.py`

**Interfaces:**
- Consumes: `Settings.max_concurrent_downloads` (Task 1), `build_sidecar_index` and the 4-arg `get_file_path` (Task 3).
- `_auto_prepare_all(settings: Settings) -> None` signature unchanged.

- [ ] **Step 1: Write the failing test**

In `api/tests/test_sync.py`, add:

```python
@pytest.mark.asyncio
async def test_auto_prepare_all_downloads_missing_songs_within_concurrency_limit(data_dir, tmp_path, monkeypatch):
    import threading
    import time
    from config import Settings
    from routers.sync import _auto_prepare_all
    from models import Song, SongsFile
    from store import write_songs

    music_dir = tmp_path / "music"
    settings = Settings(access_code="secret", data_dir=data_dir, music_dir=str(music_dir),
                         max_concurrent_downloads=3, auto_prepare=False)

    songs = [Song(title=f"Song {i}", url=f"https://youtube.com/watch?v=song{i}",
                  platform="youtube", playlist="Pop") for i in range(6)]
    write_songs(SongsFile(songs=songs, playlists=["Pop"], devices=[]), data_dir)

    lock = threading.Lock()
    state = {"current": 0, "max": 0}

    def fake_download_song(url, playlist, music_dir_arg):
        with lock:
            state["current"] += 1
            state["max"] = max(state["max"], state["current"])
        time.sleep(0.05)
        folder = Path(music_dir_arg) / playlist
        folder.mkdir(parents=True, exist_ok=True)
        mp3 = folder / f"{url[-1]}.mp3"
        mp3.write_bytes(b"fake")
        with lock:
            state["current"] -= 1
        return str(mp3)

    monkeypatch.setattr("routers.sync.download_song", fake_download_song)

    await _auto_prepare_all(settings)

    assert state["max"] == 3


@pytest.mark.asyncio
async def test_auto_prepare_all_continues_after_one_download_failure(data_dir, tmp_path):
    from config import Settings
    from routers.sync import _auto_prepare_all
    from models import Song, SongsFile
    from store import write_songs, read_songs

    music_dir = tmp_path / "music"
    settings = Settings(access_code="secret", data_dir=data_dir, music_dir=str(music_dir), auto_prepare=False)

    good = Song(title="Good", url="https://youtube.com/watch?v=good", platform="youtube", playlist="Pop")
    bad = Song(title="Bad", url="https://youtube.com/watch?v=bad", platform="youtube", playlist="Pop")
    write_songs(SongsFile(songs=[good, bad], playlists=["Pop"], devices=[]), data_dir)

    def fake_download_song(url, playlist, music_dir_arg):
        if "bad" in url:
            raise Exception("boom")
        folder = Path(music_dir_arg) / playlist
        folder.mkdir(parents=True, exist_ok=True)
        mp3 = folder / "good.mp3"
        mp3.write_bytes(b"fake")
        return str(mp3)

    with patch("routers.sync.download_song", side_effect=fake_download_song):
        await _auto_prepare_all(settings)

    data = read_songs(data_dir)
    good_updated = next(s for s in data.songs if s.id == good.id)
    bad_updated = next(s for s in data.songs if s.id == bad.id)
    assert good_updated.prepared is True
    assert bad_updated.prepared is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && .venv/bin/python -m pytest tests/test_sync.py::test_auto_prepare_all_downloads_missing_songs_within_concurrency_limit -v`
Expected: FAIL — `assert 1 == 3` (current sequential implementation never exceeds concurrency of 1)

- [ ] **Step 3: Write minimal implementation**

In `api/routers/sync.py`, update the import line to include
`build_sidecar_index`:

```python
from services.downloader import download_song, get_file_path, _get_lock, remove_song_files, build_sidecar_index
```

Replace the entire `_auto_prepare_all` function with:

```python
async def _auto_prepare_all(settings: Settings) -> None:
    data = await asyncio.to_thread(read_songs, settings.data_dir)
    to_mark: set[str] = set()
    logger.info("👉 Auto prepare all undownloaded songs")

    index = build_sidecar_index(settings.music_dir)
    missing: list[Song] = []
    for song in data.songs:
        if get_file_path(song.url, song.playlist, settings.music_dir, index):
            if not song.prepared:
                to_mark.add(song.id)
        else:
            missing.append(song)

    sem = asyncio.Semaphore(settings.max_concurrent_downloads)

    async def _download_one(song: Song) -> None:
        async with sem, _get_lock(song.id):
            if get_file_path(song.url, song.playlist, settings.music_dir, index):
                to_mark.add(song.id)
                return
            logger.info(f"👉 Downloading - {song.title}")
            try:
                await asyncio.to_thread(download_song, song.url, song.playlist, settings.music_dir)
                to_mark.add(song.id)
            except Exception as e:
                logger.error(f"❌ Failed - {song.title}: {e}")

    if missing:
        await asyncio.gather(*(_download_one(song) for song in missing))

    if to_mark:
        fresh = await asyncio.to_thread(read_songs, settings.data_dir)
        changed = False
        for song in fresh.songs:
            if song.id in to_mark and not song.prepared:
                song.prepared = True
                changed = True
        if changed:
            await asyncio.to_thread(write_songs, fresh, settings.data_dir)
    logger.info("✅ Prepared all songs")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && .venv/bin/python -m pytest tests/test_sync.py -v`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add api/routers/sync.py api/tests/test_sync.py
git commit -m "perf: download missing songs with bounded concurrency in _auto_prepare_all"
```

---

## Task 6: Fix startup double-fire and cold-boot race

**Files:**
- Modify: `api/main.py`
- Test: Modify `api/tests/test_sync.py`

**Interfaces:**
- `_maybe_auto_sync(settings: Settings) -> bool` (was `-> None`) — returns whether it triggered a sync.

- [ ] **Step 1: Write the failing test**

In `api/tests/test_sync.py`, modify the two existing startup tests to
assert on the new return value, and add two tests for `lifespan`'s
scheduling behavior:

```python
@pytest.mark.asyncio
async def test_startup_sync_triggers_when_no_songs_file(data_dir):
    from config import Settings
    settings = Settings(access_code="secret", data_dir=data_dir)

    with patch("main.asyncio.create_task") as mock_create_task:
        mock_create_task.return_value = None
        import main
        did_sync = await main._maybe_auto_sync(settings)
        mock_create_task.assert_called_once()
        assert did_sync is True


@pytest.mark.asyncio
async def test_startup_sync_skips_when_songs_file_exists(data_dir):
    from config import Settings
    settings = Settings(access_code="secret", data_dir=data_dir)
    (Path(data_dir) / "songs.json").write_text(
        '{"songs": [], "playlists": [], "playlist_sources": {}}'
    )

    with patch("main.asyncio.create_task") as mock_create_task:
        import main
        did_sync = await main._maybe_auto_sync(settings)
        mock_create_task.assert_not_called()
        assert did_sync is False


@pytest.mark.asyncio
async def test_lifespan_only_creates_one_task_on_cold_boot(monkeypatch, data_dir, tmp_path):
    from config import get_settings
    monkeypatch.setenv("ACCESS_CODE", "secret")
    monkeypatch.setenv("DATA_DIR", data_dir)
    monkeypatch.setenv("MUSIC_DIR", str(tmp_path / "music"))
    monkeypatch.setenv("AUTO_PREPARE", "true")
    get_settings.cache_clear()

    with patch("main.asyncio.create_task") as mock_create_task:
        mock_create_task.return_value = None
        import main
        async with main.lifespan(main.app):
            pass

    assert mock_create_task.call_count == 1


@pytest.mark.asyncio
async def test_lifespan_creates_auto_prepare_task_on_warm_restart(monkeypatch, data_dir, tmp_path):
    from config import get_settings
    (Path(data_dir) / "songs.json").write_text(
        '{"songs": [], "playlists": [], "playlist_sources": {}}'
    )
    monkeypatch.setenv("ACCESS_CODE", "secret")
    monkeypatch.setenv("DATA_DIR", data_dir)
    monkeypatch.setenv("MUSIC_DIR", str(tmp_path / "music"))
    monkeypatch.setenv("AUTO_PREPARE", "true")
    get_settings.cache_clear()

    with patch("main.asyncio.create_task") as mock_create_task:
        mock_create_task.return_value = None
        import main
        async with main.lifespan(main.app):
            pass

    assert mock_create_task.call_count == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && .venv/bin/python -m pytest tests/test_sync.py::test_lifespan_only_creates_one_task_on_cold_boot -v`
Expected: FAIL — `assert 2 == 1` (today's `lifespan` schedules both `_run_sync` and a standalone `_auto_prepare_all` on cold boot)

- [ ] **Step 3: Write minimal implementation**

In `api/main.py`, replace `_maybe_auto_sync` and the `lifespan` body's
scheduling lines:

```python
async def _maybe_auto_sync(settings: Settings) -> bool:
    if (Path(settings.data_dir) / "songs.json").exists():
        return False
    from routers.sync import _status
    _status["running"] = True
    asyncio.create_task(_run_sync(settings))
    return True
```

In `lifespan`, replace:

```python
    await _maybe_auto_sync(settings)
    if settings.auto_prepare:
        asyncio.create_task(_auto_prepare_all(settings))
```

with:

```python
    did_sync = await _maybe_auto_sync(settings)
    if settings.auto_prepare and not did_sync:
        asyncio.create_task(_auto_prepare_all(settings))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && .venv/bin/python -m pytest tests/test_sync.py -v`
Expected: PASS (all tests in the file)

- [ ] **Step 5: Commit**

```bash
git add api/main.py api/tests/test_sync.py
git commit -m "fix: stop firing a redundant auto_prepare_all task on cold boot"
```

---

## Final verification

- [ ] Run the full backend test suite: `cd api && .venv/bin/python -m pytest -v`
- [ ] Expected: all tests pass, no warnings about unawaited coroutines beyond the pre-existing ones in the startup tests (matches established pattern in `test_startup_sync_triggers_when_no_songs_file`).
