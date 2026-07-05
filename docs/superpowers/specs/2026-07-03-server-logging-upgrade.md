# Server Logging Upgrade

**Date:** 2026-07-03

---

## Problem

All server-side actions use `print()` with `[bracket]` prefixes. No timestamps, no log levels, no module context. Hard to read in `docker compose logs` compared to structured logging.

---

## Solution

Replace `print()` with Python stdlib `logging` module. No new dependencies. Format matches the established pattern from other internal services:

```
YYYY-MM-DD HH:MM:SS - module_name - LEVEL - emoji message
```

---

## Logging Setup

Add to `api/main.py` at module level (before the `app` definition):

```python
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
```

Each module gets its own logger:

```python
logger = logging.getLogger(__name__)
```

---

## Emoji Convention

| Emoji | Meaning |
|---|---|
| `🚀` | Startup / boot event |
| `👉` | Starting an action |
| `✅` | Success / ready |
| `❌` | Failed (use `logger.error`) |
| `🧹` | Stale file removed |

---

## Files and Changes

### `api/main.py`

Add `import logging` and `logging.basicConfig(...)` at module level. Add `logger = logging.getLogger(__name__)`. Add startup log in lifespan:

```python
import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 Music Assistant starting")
    settings = get_settings()
    await _maybe_auto_sync(settings)
    if settings.auto_prepare:
        asyncio.create_task(_auto_prepare_all(settings))
    yield
```

### `api/routers/download.py`

Add `import logging` and `logger = logging.getLogger(__name__)`. Replace all `print()` calls:

| Before | After |
|---|---|
| `print(f"[prepare] {song.title} — downloading…")` | `logger.info(f"👉 [prepare] {song.title} — downloading…")` |
| `print(f"[prepare] {song.title} — ready")` | `logger.info(f"✅ [prepare] {song.title} — ready")` |
| `print(f"[prepare] {song.title} — failed: {e}")` | `logger.error(f"❌ [prepare] {song.title} — failed: {e}")` |
| `print(f"[prepare] {song.title} — already on disk, marking prepared")` | `logger.info(f"✅ [prepare] {song.title} — already on disk, marking prepared")` |

### `api/routers/sync.py`

Add `import logging` and `logger = logging.getLogger(__name__)`. Replace all `print()` calls:

| Before | After |
|---|---|
| `print(f"[auto-prepare] {song.title} — already on disk, marking prepared")` | `logger.info(f"✅ [auto-prepare] {song.title} — already on disk, marking prepared")` |
| `print(f"[auto-prepare] {song.title} — downloading…")` | `logger.info(f"👉 [auto-prepare] {song.title} — downloading…")` |
| `print(f"[auto-prepare] {song.title} — ready")` | `logger.info(f"✅ [auto-prepare] {song.title} — ready")` |
| `print(f"[auto-prepare] {song.title} — failed: {e}")` | `logger.error(f"❌ [auto-prepare] {song.title} — failed: {e}")` |
| `print(f"[sync] stale file removed: {stale.title}")` | `logger.info(f"🧹 [sync] stale file removed: {stale.title}")` |

---

## Files Changed

| File | Change |
|---|---|
| `api/main.py` | Add `logging.basicConfig`, `logger`, startup log in lifespan |
| `api/routers/download.py` | Add `logger`, replace 4 `print()` calls |
| `api/routers/sync.py` | Add `logger`, replace 5 `print()` calls |

No new dependencies. No frontend changes. Docker build must succeed.
