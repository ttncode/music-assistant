# Auto-Sync on First Deploy Design

**Date:** 2026-06-21

## Goal

Automatically trigger a playlist sync when the application starts for the first time (i.e. `songs.json` does not yet exist), so new deployments populate the library without requiring a manual button click.

## Trigger Condition

Sync fires at startup **only if `songs.json` is absent** from `data_dir`. Once the file exists (written at the end of the first sync), subsequent restarts do not trigger auto-sync.

This precisely captures "first deployment" without affecting normal operation or interfering with a user who intentionally empties their library.

## Architecture

A FastAPI `lifespan` context manager is added to `main.py`. On startup it:

1. Reads `settings.data_dir` to check whether `songs.json` exists.
2. If absent: sets `_status["running"] = True` (so the sync button spinner is active on the very first frontend page load) then schedules `_run_sync(settings)` as an `asyncio` background task.
3. If present: does nothing.

No new API endpoints. No frontend changes. The existing 10-second poll in `useSongs.ts` delivers the songs to the UI once sync completes.

## Files Changed

| File | Change |
|---|---|
| `api/main.py` | Add `lifespan` context manager; import `_run_sync` and `_status` from `routers.sync` |
| `api/routers/sync.py` | No logic change — `_run_sync` and `_status` are already module-level and importable |
| `api/tests/test_sync.py` | Add two tests: startup triggers when file absent; startup skips when file present |

## Flow

```
Container starts
  └─ lifespan startup
       └─ songs.json exists? ──yes──▶ nothing (normal boot)
                │
               no (first deploy)
                │
                ▼
       _status["running"] = True
       asyncio.create_task(_run_sync(settings))
                │
                ▼  (runs in background)
       Playlists fetched from YouTube / SoundCloud
       songs.json written
       _status["running"] = False
                │
                ▼
       Frontend 10s poll delivers songs to UI automatically
```

## Error Handling

If the startup sync fails (misconfigured API key, network error), `_run_sync` sets `_status["error"]` as it does for manual syncs. The user sees the same error indicator and can retry manually. No special case required.

## UI Behaviour

The sync button in the header reads `/api/sync/status` on load. Because `_status["running"]` is set to `True` before the background task starts, the button spinner is active from the moment the user opens the app on first deploy. Songs appear automatically as the 10-second poll fires after sync completes.

## Testing

Two new unit tests in `api/tests/test_sync.py`:

1. **`test_startup_sync_triggers_when_no_songs_file`** — mock `songs.json` absent, call the lifespan startup, assert `_run_sync` was invoked.
2. **`test_startup_sync_skips_when_songs_file_exists`** — mock `songs.json` present, call the lifespan startup, assert `_run_sync` was NOT invoked.
