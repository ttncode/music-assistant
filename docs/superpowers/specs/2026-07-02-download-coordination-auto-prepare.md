# Download Coordination & Auto-Prepare Design Spec

**Date:** 2026-07-02

---

## Overview

Two independent features, implemented together because they are both small:

1. **Download coordination** — disable per-song download buttons while any download (single or batch) is active, preventing concurrent download errors.
2. **Auto-prepare on startup** — server-side background task that pre-fetches MP3 files for all undownloaded songs when the container starts and after every sync. Gated by `AUTO_PREPARE` env var. Sync also cleans up orphaned MP3 files for songs removed from source playlists.

---

## Feature 1: Download Coordination (Frontend Only)

### Problem

Each `SongRow` manages its own `downloading` state. Rows are unaware of each other, so a user can click multiple download buttons simultaneously, causing concurrent server-side downloads that can fail.

The same problem exists if a per-song download is triggered while a batch download (`isRunning`) is running.

### Design

**State coordination in `SongList.tsx`:**

Add a `downloadingCount: number` state (starts at 0). Pass two new callbacks to each `SongRow`:
- `onDownloadStart(): void` — called when `SongRow` begins a download (`setDownloading(true)` step); increments counter in SongList
- `onDownloadEnd(): void` — called in the `finally` block of `handleDownload`; decrements counter

Pass `anyDownloading={downloadingCount > 0}` to each `SongRow`.

**Disable logic in `SongRow.tsx`:**

The download button is disabled when either:
- `anyDownloading && !downloading` — another row is downloading
- `isBatchRunning` — a batch download is in progress

Add two new props to `SongRow`:
- `anyDownloading: boolean`
- `isBatchRunning: boolean`

Compute a single `isDisabled` boolean:
```ts
const isDisabled = downloading || anyDownloading || isBatchRunning
```

Use it for both the `disabled` attribute and the visual style:
```tsx
<button
  disabled={isDisabled}
  className={clsx(
    '...',
    downloading ? 'text-[var(--color-text-muted)]' :
    isDisabled ? 'text-[var(--color-text-muted)] opacity-50' :
    'text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)]'
  )}
>
```

**`App.tsx`:**

Pass `isRunning` (from `useBatchDownload`) to `<SongList>` as `isBatchRunning`.

### Files Changed

| File | Change |
|---|---|
| `web/src/components/SongList.tsx` | Add `downloadingCount` state; add `isBatchRunning` prop; pass `anyDownloading`, `onDownloadStart`, `onDownloadEnd`, `isBatchRunning` to each `SongRow` |
| `web/src/components/SongRow.tsx` | Add `anyDownloading`, `isBatchRunning`, `onDownloadStart`, `onDownloadEnd` props; call start/end callbacks; update button disabled logic |
| `web/src/App.tsx` | Pass `isRunning` as `isBatchRunning` to `<SongList>` |

---

## Feature 2: Auto-Prepare & Stale MP3 Cleanup (Backend Only)

### Problem

After sync discovers new songs, the MP3 files are not fetched from YouTube/SoundCloud until a user explicitly clicks Download. On a personal server, it's more convenient to have all files pre-fetched automatically.

Additionally, when sync removes songs that are no longer in their source playlist, their MP3 files remain on disk indefinitely (wasting space).

### Env Var

Add to `api/config.py`:

```python
auto_prepare: bool = True
```

Reads from `AUTO_PREPARE` environment variable. Default `true` (opt-out).

In `docker-compose.yml` / `.env`, set `AUTO_PREPARE=false` to disable.

### Startup Auto-Prepare

In `main.py`, after `_maybe_auto_sync`, add:

```python
if get_settings().auto_prepare:
    asyncio.create_task(_auto_prepare_all(get_settings()))
```

The `_auto_prepare_all` coroutine is defined in `sync.py` (where it has access to `read_songs`, `get_file_path`, `download_song` without circular imports) and imported into `main.py`:

```python
async def _auto_prepare_all(settings: Settings) -> None:
    data = read_songs(settings.data_dir)
    for song in data.songs:
        if not get_file_path(song.url, song.playlist, settings.music_dir):
            try:
                await asyncio.to_thread(download_song, song.url, song.playlist, settings.music_dir)
            except Exception:
                pass  # individual failures are non-fatal; skip and continue
```

This runs as a fire-and-forget background task. Startup is non-blocking.

### Post-Sync Auto-Prepare

At the end of `_run_sync` in `sync.py`, after `write_songs(data, ...)`:

```python
if settings.auto_prepare:
    asyncio.create_task(_auto_prepare_all(settings))
```

This re-uses the same `_auto_prepare_all` coroutine, which skips songs that already have MP3 files (idempotent via `get_file_path` check).


### Stale MP3 Cleanup (Always Runs During Sync)

This runs regardless of `AUTO_PREPARE` — it is a sync correctness concern.

In `_run_sync`, after building `sync_songs_by_url` and `source_by_url`, identify stale songs:

```python
stale_songs = [s for url, s in sync_songs_by_url.items() if url not in source_by_url]
for stale in stale_songs:
    mp3_path = get_file_path(stale.url, stale.playlist, settings.music_dir)
    if mp3_path:
        Path(mp3_path).unlink(missing_ok=True)
```

This runs before `data.songs` is rebuilt (stale songs are already excluded from `new_sync_songs` by the existing logic). The only new behavior is deleting the file from disk.

### Files Changed

| File | Change |
|---|---|
| `api/config.py` | Add `auto_prepare: bool = True` field |
| `api/main.py` | Import `_auto_prepare_all` from `sync`; call it on startup if `auto_prepare=True` |
| `api/routers/sync.py` | Add `_auto_prepare_all` coroutine; add stale MP3 deletion; call `_auto_prepare_all` at end of sync if `auto_prepare=True` |

No frontend changes. No new dependencies.

---

## Testing

### Feature 1

1. Click Download on one song → verify all other Download buttons become visually disabled and unclickable until it finishes
2. Start a batch download (SelectionBar) → verify per-song Download buttons are all disabled during the batch
3. Download completes → verify all Download buttons re-enable

### Feature 2

1. Set `AUTO_PREPARE=true`, restart container with undownloaded songs → verify MP3 files appear in `/music` directory without user interaction
2. Trigger sync with new songs → verify new song MP3s are fetched automatically in the background
3. Trigger sync where a song was removed from source → verify its MP3 file is deleted from disk after sync
4. Set `AUTO_PREPARE=false` → verify no auto-fetching happens on startup or after sync (stale cleanup still happens)
