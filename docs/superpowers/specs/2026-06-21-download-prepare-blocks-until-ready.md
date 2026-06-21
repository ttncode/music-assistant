# Download Prepare Blocks Until Ready

**Date:** 2026-06-21

## Problem

`POST /api/download/{id}/prepare` returns immediately after starting a background yt-dlp task. The frontend `await api.download.prepare()` resolves in ~100ms (HTTP round-trip only), not when the song file is actually ready.

This causes two UI bugs:
1. **Single download:** "Preparing..." indicator flashes briefly then disappears while the browser is still downloading the file.
2. **Batch download:** "Download successful" toast fires immediately after all anchor clicks, before yt-dlp has finished downloading any song.

## Root Cause

```python
# Current — fire and forget
asyncio.create_task(_do_prepare(song_id, ...))
return {"status": "downloading"}  # returns in ~100ms
```

The frontend treats the response as a signal to proceed, but the file isn't ready yet. The `serve_download` endpoint has a fallback that downloads if the file isn't there, but by then the UI has already declared success.

## Fix

Replace the background-task pattern with a blocking call using the same check → lock → recheck → download pattern already in `serve_download`:

```python
# New — blocks until ready
if not get_file_path(song.url, song.playlist, settings.music_dir):
    async with _get_lock(song_id):
        if not get_file_path(song.url, song.playlist, settings.music_dir):
            await asyncio.to_thread(download_song, song.url, song.playlist, settings.music_dir)
return {"status": "ready"}
```

The `_preparing` set and `_do_prepare` helper become unused and are removed.

## Files Changed

| File | Change |
|---|---|
| `api/routers/download.py` | `prepare_download` awaits download; remove `_preparing` and `_do_prepare` |
| `api/tests/test_download.py` | Add test: `prepare` returns `ready` and calls `download_song` when file absent |

## No Frontend Changes

`SongRow.handleDownload` and `useBatchDownload` already `await` the prepare call. Once prepare blocks for the correct duration, both bugs resolve automatically.

## Concurrent Requests

If two clients call `prepare` for the same song simultaneously:
- First acquires `_get_lock(song_id)`, downloads, releases lock
- Second acquires lock, rechecks via `get_file_path` → file exists → skips download
- Both return `{status: "ready"}`

This is identical to how `serve_download` already handles concurrency.
