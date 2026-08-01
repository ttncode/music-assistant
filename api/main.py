import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from config import get_settings, Settings
from routers import auth, devices, songs, sync, download, status
from routers.sync import _run_sync, _auto_prepare_all

_LOG_FMT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
_LOG_DATEFMT = "%Y-%m-%d %H:%M:%S"

logging.basicConfig(level=logging.INFO, format=_LOG_FMT, datefmt=_LOG_DATEFMT)

logger = logging.getLogger("__main__")


def _apply_log_format_to_uvicorn() -> None:
    formatter = logging.Formatter(fmt=_LOG_FMT, datefmt=_LOG_DATEFMT)
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        for handler in logging.getLogger(name).handlers:
            handler.setFormatter(formatter)


async def _maybe_auto_sync(settings: Settings) -> bool:
    if (Path(settings.data_dir) / "songs.json").exists():
        return False
    from routers.sync import _status
    _status["running"] = True
    asyncio.create_task(_run_sync(settings))
    return True


@asynccontextmanager
async def lifespan(app: FastAPI):
    _apply_log_format_to_uvicorn()
    settings = get_settings()
    tz_name = datetime.now().astimezone().tzname()

    logger.info(f"🚀 Booting the system - {settings.app_name} v{settings.app_version}")
    logger.info(f"🌏 Timezone: {tz_name}")
    logger.info("👉 Loading configuration")
    logger.info(f"⚙️  _Environment: {settings.app_env}")
    logger.info(f"⚙️  _Auto Prepare: {'enabled' if settings.auto_prepare else 'disabled'}")
    logger.info(f"⚙️  _YouTube: {'configured' if settings.youtube_api_key and settings.youtube_channel_id else 'not configured'}")
    logger.info(f"⚙️  _SoundCloud: {'configured' if settings.soundcloud_profile_url else 'not configured'}")
    logger.info("✅ Configuration loaded")

    did_sync = await _maybe_auto_sync(settings)
    if settings.auto_prepare and not did_sync:
        asyncio.create_task(_auto_prepare_all(settings))

    logger.info(f"🚀 Booted successfully - {settings.app_name} v{settings.app_version}")
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
