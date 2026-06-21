# Auto-Sync on First Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically trigger a playlist sync when the app starts and `songs.json` does not yet exist, so the library populates on first deployment without a manual button click.

**Architecture:** A `_maybe_auto_sync(settings)` async helper is added to `main.py`. A FastAPI `lifespan` context manager calls it on startup. If `songs.json` is absent, the helper pre-marks `_status["running"] = True` (so the sync button spins on first load) and schedules `_run_sync(settings)` as an asyncio background task. The existing 10-second frontend poll delivers the songs once sync completes. No new API endpoints, no frontend changes.

**Tech Stack:** FastAPI lifespan, asyncio, Python 3.12, pytest-asyncio.

## Global Constraints

- Trigger condition: `(Path(settings.data_dir) / "songs.json").exists()` is `False`
- Helper function name: `_maybe_auto_sync(settings: Settings) -> None`
- Must pre-set `_status["running"] = True` before scheduling the task
- Background task scheduled with `asyncio.create_task(_run_sync(settings))`
- `GITHUB_TOKEN` is used for GHCR auth — no external secrets required
- Tests live in `api/tests/test_sync.py`; run with `pytest tests/ -q` from `api/` with `PYTHONPATH=.`

---

### Task 1: Add startup auto-sync

**Files:**
- Modify: `api/main.py` — add `_maybe_auto_sync`, `lifespan`, wire into `FastAPI()`
- Modify: `api/tests/test_sync.py` — add two new tests

**Interfaces:**
- Consumes: `_run_sync` and `_status` from `routers.sync`; `get_settings` from `config`
- Produces: `_maybe_auto_sync(settings: Settings) -> None` (awaitable, exported from `main`)

- [ ] **Step 1: Write the two failing tests**

Append to `api/tests/test_sync.py`:

```python
import asyncio
from pathlib import Path
from unittest.mock import patch


@pytest.mark.asyncio
async def test_startup_sync_triggers_when_no_songs_file(data_dir):
    from config import Settings
    settings = Settings(access_code="secret", data_dir=data_dir)
    # data_dir exists but songs.json does not — first deploy scenario

    with patch("main.asyncio.create_task") as mock_create_task:
        mock_create_task.return_value = None
        import main
        await main._maybe_auto_sync(settings)
        mock_create_task.assert_called_once()


@pytest.mark.asyncio
async def test_startup_sync_skips_when_songs_file_exists(data_dir):
    from config import Settings
    settings = Settings(access_code="secret", data_dir=data_dir)
    (Path(data_dir) / "songs.json").write_text(
        '{"songs": [], "playlists": [], "playlist_sources": {}}'
    )

    with patch("main.asyncio.create_task") as mock_create_task:
        import main
        await main._maybe_auto_sync(settings)
        mock_create_task.assert_not_called()
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd api && PYTHONPATH=. pytest tests/test_sync.py::test_startup_sync_triggers_when_no_songs_file tests/test_sync.py::test_startup_sync_skips_when_songs_file_exists -v
```

Expected: both tests FAIL with `ImportError` or `AttributeError: module 'main' has no attribute '_maybe_auto_sync'`.

- [ ] **Step 3: Implement the feature in `api/main.py`**

Replace the entire file with:

```python
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from config import get_settings, Settings
from routers import auth, devices, songs, sync, download, status
from routers.sync import _run_sync


async def _maybe_auto_sync(settings: Settings) -> None:
    if (Path(settings.data_dir) / "songs.json").exists():
        return
    from routers.sync import _status
    _status["running"] = True
    asyncio.create_task(_run_sync(settings))


@asynccontextmanager
async def lifespan(app: FastAPI):
    await _maybe_auto_sync(get_settings())
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

- [ ] **Step 4: Run the two new tests to confirm they pass**

```bash
cd api && PYTHONPATH=. pytest tests/test_sync.py::test_startup_sync_triggers_when_no_songs_file tests/test_sync.py::test_startup_sync_skips_when_songs_file_exists -v
```

Expected: both PASS.

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
cd api && PYTHONPATH=. pytest tests/ -q
```

Expected: all tests pass, no failures.

- [ ] **Step 6: Commit**

```bash
git add api/main.py api/tests/test_sync.py
git commit -m "feat: auto-sync on first deploy when songs.json is absent"
```
