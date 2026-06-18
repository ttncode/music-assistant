from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from routers import auth, devices, songs, sync, download

app = FastAPI(title="Music Assistant")

# API routes must be registered before the SPA catch-all
app.include_router(auth.router)
app.include_router(devices.router)
app.include_router(songs.router)
app.include_router(sync.router)
app.include_router(download.router)

# Serve React build — only in production (web/dist must exist)
_DIST = Path(__file__).parent / "web" / "dist"
if _DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(_DIST / "assets")), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    async def serve_spa(path: str):
        return FileResponse(str(_DIST / "index.html"))
