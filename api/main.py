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
