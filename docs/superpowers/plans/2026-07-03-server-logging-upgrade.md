# Server Logging Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all `print()` calls in the backend with Python `logging`, producing structured timestamped log lines in `docker compose logs`.

**Architecture:** Add `logging.basicConfig` once in `api/main.py` at module level — this configures the root logger for the whole process. Each router module gets its own `logger = logging.getLogger(__name__)`. All `print()` calls become `logger.info()` or `logger.error()` with emoji prefixes matching the spec.

**Tech Stack:** Python 3.12, FastAPI, stdlib `logging` (no new dependencies)

## Global Constraints

- No new Python dependencies — stdlib `logging` only
- Only these 3 files may be modified: `api/main.py`, `api/routers/download.py`, `api/routers/sync.py`
- Log format exactly: `%(asctime)s - %(name)s - %(levelname)s - %(message)s` with `datefmt="%Y-%m-%d %H:%M:%S"`
- Emoji mapping: `👉` starting action, `✅` success/ready, `❌` failed (`logger.error`), `🧹` stale removed, `🚀` startup
- Failed log lines use `logger.error(...)`, all others use `logger.info(...)`
- No frontend changes. Docker build must succeed.

---

### Task 1: Replace print() with logging across all backend modules

**Files:**
- Modify: `api/main.py`
- Modify: `api/routers/download.py`
- Modify: `api/routers/sync.py`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: nothing downstream depends on this — pure observability change

- [ ] **Step 1: Read all three files**

Read each file in full before touching anything:
- `api/main.py`
- `api/routers/download.py`
- `api/routers/sync.py`

Confirm the `print()` calls you'll replace:

`api/routers/download.py` (4 calls):
```python
print(f"[prepare] {song.title} — downloading…")
print(f"[prepare] {song.title} — ready")
print(f"[prepare] {song.title} — failed: {e}")
print(f"[prepare] {song.title} — already on disk, marking prepared")
```

`api/routers/sync.py` (5 calls):
```python
print(f"[auto-prepare] {song.title} — already on disk, marking prepared")
print(f"[auto-prepare] {song.title} — downloading…")
print(f"[auto-prepare] {song.title} — ready")
print(f"[auto-prepare] {song.title} — failed: {e}")
print(f"[sync] stale file removed: {stale.title}")
```

- [ ] **Step 2: Update `api/main.py`**

Add `import logging` and `logging.basicConfig(...)` at module level (after existing imports, before the `app` definition). Add `logger = logging.getLogger(__name__)`. Add startup log in lifespan.

The top of the file becomes:

```python
import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from config import get_settings, Settings
from routers import auth, devices, songs, sync, download, status
from routers.sync import _run_sync, _auto_prepare_all

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)


async def _maybe_auto_sync(settings: Settings) -> None:
    if (Path(settings.data_dir) / "songs.json").exists():
        return
    from routers.sync import _status
    _status["running"] = True
    asyncio.create_task(_run_sync(settings))


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Music Assistant starting")
    settings = get_settings()
    await _maybe_auto_sync(settings)
    if settings.auto_prepare:
        asyncio.create_task(_auto_prepare_all(settings))
    yield
```

The rest of `main.py` (router registrations, static files) stays unchanged.

- [ ] **Step 3: Update `api/routers/download.py`**

Add `import logging` and `logger = logging.getLogger(__name__)` after the existing imports. Replace all 4 `print()` calls:

Add after the last import line:
```python
logger = logging.getLogger(__name__)
```

Replace each `print()`:

```python
# Before:
print(f"[prepare] {song.title} — downloading…")
# After:
logger.info(f"👉 [prepare] {song.title} — downloading…")

# Before:
print(f"[prepare] {song.title} — ready")
# After:
logger.info(f"✅ [prepare] {song.title} — ready")

# Before:
print(f"[prepare] {song.title} — failed: {e}")
# After:
logger.error(f"❌ [prepare] {song.title} — failed: {e}")

# Before:
print(f"[prepare] {song.title} — already on disk, marking prepared")
# After:
logger.info(f"✅ [prepare] {song.title} — already on disk, marking prepared")
```

Note: `logging` is already in Python stdlib — no import needed beyond `import logging`.

- [ ] **Step 4: Update `api/routers/sync.py`**

Add `import logging` and `logger = logging.getLogger(__name__)` after the existing imports. Replace all 5 `print()` calls:

Add after the last import line:
```python
logger = logging.getLogger(__name__)
```

Replace each `print()`:

```python
# Before:
print(f"[auto-prepare] {song.title} — already on disk, marking prepared")
# After:
logger.info(f"✅ [auto-prepare] {song.title} — already on disk, marking prepared")

# Before:
print(f"[auto-prepare] {song.title} — downloading…")
# After:
logger.info(f"👉 [auto-prepare] {song.title} — downloading…")

# Before:
print(f"[auto-prepare] {song.title} — ready")
# After:
logger.info(f"✅ [auto-prepare] {song.title} — ready")

# Before:
print(f"[auto-prepare] {song.title} — failed: {e}")
# After:
logger.error(f"❌ [auto-prepare] {song.title} — failed: {e}")

# Before:
print(f"[sync] stale file removed: {stale.title}")
# After:
logger.info(f"🧹 [sync] stale file removed: {stale.title}")
```

- [ ] **Step 5: Verify no print() calls remain in the 3 modified files**

```bash
grep -n "print(" api/main.py api/routers/download.py api/routers/sync.py
```

Expected: no output (zero matches).

- [ ] **Step 6: Build Docker image to verify no syntax errors**

```bash
docker compose build
```

Expected: build completes successfully with exit code 0. Any Python syntax error will surface here.

- [ ] **Step 7: Commit**

```bash
git add api/main.py api/routers/download.py api/routers/sync.py
git commit -m "feat: replace print() with structured logging across backend"
```
