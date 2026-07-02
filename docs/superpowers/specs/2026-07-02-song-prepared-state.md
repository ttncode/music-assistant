# Song Prepared State Design Spec

**Date:** 2026-07-02

---

## Problem

Auto-prepare downloads MP3 files to the server silently. There is no way to know which songs are ready on disk, and server-side activity is invisible in logs. Users have no subtle UI cue to distinguish "waiting to be fetched" from "file is ready — tap to save".

---

## Solution

Add a `prepared: bool` field to the `Song` model. Set it `True` whenever an MP3 lands on disk (via auto-prepare, prepare_download, or startup scan). Expose it in the song list API response and show a tiny dot badge in the bottom-left of the song thumbnail in the UI. Add `print`-based logging throughout so server actions are visible in `docker compose logs`.

---

## Backend

### Model (`api/models.py`)

Add one field to `Song`:

```python
prepared: bool = False
```

Defaults `False` for all existing songs — no migration needed. Pydantic reads old `songs.json` entries without this field and sets `False`.

### Logging convention

Use `print()` with a consistent prefix throughout (no new logging library):

```
[prepare] <song title> — downloading…
[prepare] <song title> — ready
[prepare] <song title> — failed: <error>
[auto-prepare] <song title> — already on disk, marking prepared
[auto-prepare] <song title> — downloading…
[auto-prepare] <song title> — ready
[auto-prepare] <song title> — failed: <error>
[sync] stale file removed: <song title>
```

### `prepare_download` endpoint (`api/routers/download.py`)

After the download or existence check, if `song.prepared` is `False`:

```python
print(f"[prepare] {song.title} — downloading…")
# ... existing download logic ...
print(f"[prepare] {song.title} — ready")
song.prepared = True
write_songs(data, settings.data_dir)
```

On failure:
```python
print(f"[prepare] {song.title} — failed: {e}")
raise HTTPException(...)
```

If the file already exists and `song.prepared` is `False`:
```python
print(f"[prepare] {song.title} — already on disk, marking prepared")
song.prepared = True
write_songs(data, settings.data_dir)
```

If `song.prepared` is already `True`, skip the write (no-op).

### `_auto_prepare_all` (`api/routers/sync.py`)

Extend the existing loop to:
1. Check `get_file_path` first — if file already exists and `song.prepared` is `False`, mark it and log `[auto-prepare] … — already on disk, marking prepared`
2. If file doesn't exist, log `[auto-prepare] … — downloading…`, download, then log `ready` or `failed`
3. Call `write_songs` once at the end if any `prepared` flags changed

```python
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
```

### Stale cleanup log (`api/routers/sync.py`)

In `_run_sync`, when removing stale files:
```python
print(f"[sync] stale file removed: {stale.title}")
remove_song_files(stale.url, stale.playlist, settings.music_dir)
```

### `get_songs` response (`api/routers/songs.py`)

Add `prepared` to the per-song dict:

```python
songs_out.append({
    **s.model_dump(),
    "downloaded": dd.downloaded if dd else False,
    "prepared": s.prepared,
})
```

---

## Frontend

### `SongResponse` (`web/src/lib/api.ts`)

Add one field:
```ts
prepared: boolean
```

### Dot badge (`web/src/components/SongRow.tsx`)

Inside the thumbnail container (which already shows the downloaded checkmark at `-bottom-1 -right-1`), add the prepared dot at `-bottom-1 -left-1`:

```tsx
{song.prepared && !isDownloaded && (
  <span className="absolute -bottom-1 -left-1 w-2 h-2 rounded-full bg-[var(--color-text-muted)] ring-1 ring-[var(--color-bg)]" />
)}
```

8px muted dot with a 1px background-colored ring so it separates from the thumbnail edge. Hidden once the song is downloaded to the device (green ✓ takes over).

No new props needed — `song.prepared` is already on the `SongResponse` object passed as `song`.

---

## Files Changed

| File | Change |
|---|---|
| `api/models.py` | Add `prepared: bool = False` to `Song` |
| `api/routers/songs.py` | Add `"prepared": s.prepared` to response dict |
| `api/routers/download.py` | Mark `prepared = True` + log after prepare; write songs |
| `api/routers/sync.py` | Update `_auto_prepare_all` to mark prepared + log; add stale cleanup log |
| `web/src/lib/api.ts` | Add `prepared: boolean` to `SongResponse` |
| `web/src/components/SongRow.tsx` | Add dot badge when `song.prepared && !isDownloaded` |

No new dependencies. No new endpoints.

---

## Testing

1. Start with undownloaded songs → auto-prepare runs → dot badge appears on each song thumbnail as files are fetched
2. Click Download on a single song → `[prepare]` logs appear → song gets dot badge immediately after prepare
3. Check `docker compose logs app` → all prepare/auto-prepare/stale actions visible with clear prefixes
4. Download a prepared song to phone → dot badge disappears, green ✓ appears
5. Restart container with songs already prepared on disk → dot badges appear immediately (scan marks them on startup without re-downloading)
