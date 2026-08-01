# Playlist sync performance

## Context

`POST /api/sync` (`api/routers/sync.py`) is slow. Tracing the full path —
`_run_sync` → `_auto_prepare_all`, plus the equivalent startup path in
`api/main.py` — surfaces seven independent problems, none of which change
the sync/download *contract* (same songs, same playlists, same
`device_downloads` tracking); all of them are internal to how the work gets
done.

**Discovery phase** (finding out what should exist):

1. `services/youtube.py:fetch_youtube_playlists` fetches each playlist's
   items one at a time in a `for` loop — N playlists means N sequential
   round-trip chains.
2. `routers/sync.py:_run_sync` fully awaits the YouTube fetch before
   starting the SoundCloud fetch, even though they're independent sources.
3. `services/soundcloud.py:fetch_soundcloud_playlists` does a full
   `yt_dlp.extract_info()` scrape per playlist, sequential — this is the
   single slowest network call in the app, run once per playlist with no
   overlap.

**Prepare phase** (making songs exist on disk):

4. `routers/sync.py:_auto_prepare_all` downloads missing songs one at a
   time — `await asyncio.to_thread(download_song, ...)` inside a plain
   `for` loop. Wall time is the sum of every song's fetch + ffmpeg
   transcode, with zero overlap. This is the dominant cost once more than a
   handful of songs are missing.
5. `services/downloader.py:get_file_path`'s self-heal fallback (added by
   `2026-07-20-fix-redownload-on-playlist-move-design.md`) scans every
   playlist folder under `music_dir` on a lookup miss. It's called once per
   undownloaded song on every `_auto_prepare_all` run, so the scan cost
   scales with playlist count × missing-song count.

**Event loop:**

6. `store.py:read_songs`/`write_songs` are plain blocking file IO under a
   `FileLock`. They're called directly (no `asyncio.to_thread`) from inside
   `async def _run_sync` and `async def _auto_prepare_all`, blocking the
   event loop — and therefore every other in-flight API request — for the
   duration of JSON (de)serialization and lock acquisition.

**Startup wiring** (`api/main.py:lifespan`):

7. `_maybe_auto_sync` schedules `_run_sync` as a background task on first
   boot (`songs.json` missing). Immediately after, if `settings.auto_prepare`
   is true, `lifespan` *also* unconditionally schedules a separate
   `_auto_prepare_all` task — regardless of whether a sync was just
   triggered. Two consequences: on cold boot, this second task races the
   sync, reads an empty/stale `songs.json`, and no-ops (wasted task,
   harmless but pointless) — the sync's own completion already schedules
   its own `_auto_prepare_all` at `sync.py:163-164`. On every *warm* restart
   (`songs.json` already exists, no sync triggered), the full-library
   `_auto_prepare_all` still runs unconditionally, hitting problems 4 and 5
   on every deploy, not just on a manual sync.

One design question was resolved during investigation and does **not**
require a fix: whether to flatten `music_dir` storage (drop
folder-per-playlist) to make problem 5 cheaper. Once problem 5 is fixed via
an index built once per run (see below), the per-run cost is O(library
size) either way — the same order flattening would achieve — so flattening
buys nothing further and would cost the host-browsable-by-playlist-folder
property that a prior design (`2026-07-20-fix-redownload-on-playlist-move-design.md`)
deliberately preserved. **Folder-per-playlist storage stays as-is.**

Scope: `api/services/youtube.py`, `api/services/soundcloud.py`,
`api/services/downloader.py`, `api/routers/sync.py`, `api/config.py`,
`api/main.py`, and their tests. No API contract, data model, or frontend
changes — `Song`, `SongsFile`, and every router response shape stay
identical.

## Fix

### A. Parallelize YouTube per-playlist fetch

`fetch_youtube_playlists` currently does:

```python
for pl in playlists:
    songs = await _get_playlist_items(client, api_key, pl["id"])
    result.append({...})
```

Change to gather all playlists' item-fetches concurrently:

```python
songs_lists = await asyncio.gather(
    *(_get_playlist_items(client, api_key, pl["id"]) for pl in playlists)
)
result = [{"title": pl["snippet"]["title"], "playlist_id": pl["id"],
           "platform": "youtube", "songs": songs}
          for pl, songs in zip(playlists, songs_lists)]
```

No concurrency cap — this is the official YouTube Data API (not scraping),
and per-channel playlist counts are small enough that quota exhaustion from
running them in parallel rather than serial is not a realistic risk (total
number of requests is unchanged, only their scheduling).

### B. Run YouTube and SoundCloud discovery concurrently

In `_run_sync`, replace the sequential `await`/`await` with
`asyncio.gather`, building a list of only the configured sources:

```python
tasks = []
if settings.youtube_api_key and settings.youtube_channel_id:
    tasks.append(fetch_youtube_playlists(settings.youtube_api_key, settings.youtube_channel_id))
if settings.soundcloud_profile_url:
    tasks.append(asyncio.to_thread(fetch_soundcloud_playlists, settings.soundcloud_profile_url))
results = await asyncio.gather(*tasks)
all_playlists = [pl for r in results for pl in r]
```

`sync_platforms` is still derived from which sources were configured, same
as today — just decoupled from await order.

### C. Bounded-parallel downloads in `_auto_prepare_all`

This is the biggest lever: today it's a single loop that both checks and
downloads each song in turn. Split into two passes:

1. **Scan** (sequential, cheap): walk `data.songs`, call `get_file_path`
   for each (using the index from fix D), and build a list of songs that
   need downloading. Songs already on disk get added to `to_mark` exactly
   as today if `not song.prepared`.
2. **Download** (bounded parallel): for the songs needing download, run
   them through a semaphore-bounded `asyncio.gather`:

```python
sem = asyncio.Semaphore(settings.max_concurrent_downloads)

async def _download_one(song):
    async with sem, _get_lock(song.id):
        if get_file_path(song.url, song.playlist, settings.music_dir, index):
            return
        try:
            await asyncio.to_thread(download_song, song.url, song.playlist, settings.music_dir)
            to_mark.add(song.id)
        except Exception as e:
            logger.error(f"❌ Failed - {song.title}: {e}")

await asyncio.gather(*(_download_one(s) for s in missing_songs))
```

Each task keeps its own `try/except` (matching today's per-song isolation —
one failed download doesn't stop or cancel the others). The re-check
inside the lock guards the same race the current code already guards
against (a concurrent `/api/download/{id}/prepare` call finishing first).

New setting in `config.py`:

```python
max_concurrent_downloads: int = 3
```

Env-overridable via the existing `pydantic_settings` `.env` mechanism, same
as every other `Settings` field — no separate wiring needed.

### D. Index-once self-heal lookup

Add to `services/downloader.py`:

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
```

`get_file_path` gets an optional parameter: `get_file_path(url, playlist,
music_dir, index=None)`. Current-folder fast path is unchanged. The
fallback scan changes from `root.iterdir()` to a dict lookup when `index`
is provided:

```python
if index is not None:
    other_sidecar = index.get(_url_hash(url))
    if other_sidecar is None or other_sidecar.parent == folder:
        return None
    # ... same stale-check / move / rewrite logic as today, operating on other_sidecar
else:
    # existing root.iterdir() scan — unchanged, used by single-song callers
```

Single-song callers (`prepare_download`, `serve_download` in
`routers/download.py`) don't pass `index` and keep today's per-call scan —
they're one-off lookups, not run in a loop over the whole library, so the
scan cost there is already negligible. `_auto_prepare_all` calls
`build_sidecar_index(settings.music_dir)` once at the top of the scan pass
and threads it through every `get_file_path` call in that run.

### E. Stop blocking the event loop during sync

Wrap the three `read_songs`/`write_songs` call sites inside `_run_sync` and
`_auto_prepare_all` in `asyncio.to_thread`:

```python
data = await asyncio.to_thread(read_songs, settings.data_dir)
...
await asyncio.to_thread(write_songs, data, settings.data_dir)
```

`store.py` itself is unchanged — it's still a plain synchronous module used
directly (unwrapped) by non-async call sites like `routers/songs.py` and
`routers/download.py`, which run inside FastAPI's per-request sync context
and aren't part of this fix's scope.

### F+G. Fix startup double-fire and cold-boot race

`_maybe_auto_sync` returns whether it triggered a sync:

```python
async def _maybe_auto_sync(settings: Settings) -> bool:
    if (Path(settings.data_dir) / "songs.json").exists():
        return False
    from routers.sync import _status
    _status["running"] = True
    asyncio.create_task(_run_sync(settings))
    return True
```

`lifespan` only schedules the standalone `_auto_prepare_all` when a sync
wasn't just triggered:

```python
did_sync = await _maybe_auto_sync(settings)
if settings.auto_prepare and not did_sync:
    asyncio.create_task(_auto_prepare_all(settings))
```

Cold boot: `_run_sync` runs, and its own completion already schedules
`_auto_prepare_all` (`sync.py:163-164`) — no second, racing, no-op task.
Warm restart (`songs.json` exists): `_auto_prepare_all` still runs once,
same as today — this is intentional, it catches songs that failed to
download in a previous session — but it's no longer duplicated or raced,
and it's cheap now thanks to fix D.

## Error handling

- Parallel downloads (C): each song's download keeps its own `try/except`,
  logged and skipped on failure — matches current per-song isolation
  exactly, just running concurrently instead of sequentially. A failure in
  one task never cancels or blocks siblings (`asyncio.gather` without
  `return_exceptions` would abort the whole batch on first exception, so
  each task swallows its own exception internally instead).
- Index lookup (D): a stale sidecar (recorded MP3 path no longer exists)
  found via the index is handled identically to the existing non-indexed
  path — deleted, lookup continues to report `None` if nothing else
  matches. The index itself is read-only within a run; it's rebuilt fresh
  on the next `_auto_prepare_all` call, so a stale index entry from a
  sidecar deleted mid-run at worst causes one extra `Path.exists()` check
  that correctly falls through to "not found."
- Startup fix (F+G): if `_run_sync` itself raises, it already sets
  `_status["error"]` and does not reach the `auto_prepare` scheduling line
  (`sync.py:163-164`, inside the same `try` block) — no `_auto_prepare_all`
  runs after a failed sync. This is existing behavior, unchanged.

## Testing

`api/tests/`, existing pytest + fixture conventions (`data_dir`,
`music_dir`, `client` fixtures already in `conftest.py`/`test_download.py`).

- **A/B (discovery):** extend `test_sync.py`'s existing YouTube mock test
  with a second playlist, assert both are represented correctly in the
  aggregated result. Add a test on `_run_sync` (mocking
  `fetch_youtube_playlists` and `fetch_soundcloud_playlists`) asserting
  both are invoked when both platforms are configured, and the resulting
  `songs.json` contains songs from both.
- **C (parallel downloads):** mock `download_song` with a shared counter
  (increment on entry, decrement on exit, track the max concurrent value
  seen) to assert the observed concurrency is `> 1` and `<=
  max_concurrent_downloads` — proves real parallelism without relying on
  timing/sleep. Add a test where one song's mocked `download_song` raises
  and assert the others still complete and get marked `prepared`.
- **D (index):** `build_sidecar_index` returns the correct
  `hash -> sidecar path` map across multiple playlist folders. Parametrize
  the three existing `get_file_path` relocation/stale-sidecar tests in
  `test_download.py` to run both with and without a prebuilt `index`
  argument, asserting identical behavior either way.
- **E (event loop):** no new dedicated test — covered indirectly by every
  existing `_run_sync`/`_auto_prepare_all` test continuing to pass
  unchanged, since output is identical, only execution context changes.
- **F+G (startup):** extend the two existing tests in `test_sync.py`
  (`test_startup_sync_triggers_when_no_songs_file`,
  `test_startup_sync_skips_when_songs_file_exists`) — assert
  `_maybe_auto_sync`'s return value (`True`/`False`), and add a test on
  `lifespan`'s scheduling logic: cold boot → `_auto_prepare_all` not
  independently scheduled; warm restart with `auto_prepare=true` → it is
  scheduled exactly once.

## Out of scope

- Flattening `music_dir` storage layout — evaluated and rejected (see
  Context); folder-per-playlist stays.
- Any change to the `Song`/`SongsFile` data model, API request/response
  shapes, or frontend code.
- Rate-limit-aware backoff for YouTube/SoundCloud — parallelizing
  discovery (A/B) doesn't change total request volume, only scheduling, so
  existing quota/error handling is untouched.
- `read_songs`/`write_songs` call sites outside `routers/sync.py`
  (`routers/download.py`, `routers/songs.py`) — those run inside
  synchronous per-request handlers already scoped to a single request, not
  part of the sync performance path this spec addresses.
