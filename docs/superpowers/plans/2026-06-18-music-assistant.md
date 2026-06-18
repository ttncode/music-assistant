# Music Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local music manager that syncs YouTube/SoundCloud playlists, downloads MP3s to any device via browser, and tracks per-device download status independently.

**Architecture:** Single Docker container — FastAPI serves both REST API (`/api/*`) and built React static files on port 8000. yt-dlp handles downloads, re-encoding to MP3 320kbps via ffmpeg. `songs.json` is the sole persistent store. Devices identify via UUID in `localStorage`, sent as `X-Device-ID` header.

**Tech Stack:** Python 3.12, FastAPI 0.115, pydantic-settings 2, yt-dlp, filelock, pytest, httpx | React 19, Vite 6, Tailwind v4, shadcn/ui, Motion (motion/react), Phosphor Icons, Geist font

## Global Constraints

- Python 3.12+; FastAPI 0.115+; pydantic v2; pydantic-settings 2.x
- React 19; Vite 6; Tailwind v4 — use `@tailwindcss/vite` plugin, NOT `tailwindcss` in `postcss.config`
- No Spotify integration anywhere
- Audio always MP3 320kbps — `FFmpegExtractAudio` with `preferredquality: "320"` — never skip
- `songs.json` is the only persistent store — no SQLite, no Redis, no other DB
- TikTok songs are NOT saved to `songs.json` — ephemeral on-demand only
- `platform` is always inferred from URL regex — never user-selected
- Device UUID generated server-side on register, stored client-side in `localStorage`
- All API routes except `POST /api/auth/verify` and `POST /api/devices/register` require `X-Device-ID` header
- Dark mode only — no light/dark toggle; background `#0a0a0a`, accent emerald `#10b981`
- Icons: `@phosphor-icons/react` only — no Lucide, no hand-rolled SVGs
- Font: Geist Sans + Geist Mono — self-hosted via `@fontsource/geist` packages, no Google Fonts CDN
- `nooverwrites: True` in yt-dlp — never re-download an existing file on disk
- No em-dashes in any UI copy — use hyphens or restructure sentences

---

## File Map

```
music-assistant/
├── Dockerfile                        # Multi-stage: build React → Python image with ffmpeg
├── docker-compose.yml
├── .env.example
├── api/
│   ├── requirements.txt
│   ├── main.py                       # FastAPI app; mounts routers; serves web/dist at "/"
│   ├── config.py                     # pydantic-settings: ACCESS_CODE, YOUTUBE_*, SOUNDCLOUD_*, dirs
│   ├── models.py                     # Pydantic: Song, Device, DeviceDownload, SongsFile
│   ├── store.py                      # read_songs() / write_songs() with filelock
│   ├── routers/
│   │   ├── auth.py                   # POST /api/auth/verify
│   │   ├── devices.py                # POST /api/devices/register, DELETE /api/devices/{id}/history
│   │   ├── songs.py                  # GET /api/songs, POST /api/songs, DELETE /api/songs/{id}
│   │   ├── sync.py                   # POST /api/sync, GET /api/sync/status
│   │   └── download.py               # POST /api/download/{id}/prepare, GET /api/download/{id}, POST /api/download/tiktok
│   ├── services/
│   │   ├── youtube.py                # YouTube Data API v3: fetch all playlists + videos
│   │   ├── soundcloud.py             # yt-dlp flat extraction for SoundCloud profile
│   │   └── downloader.py             # yt-dlp download + ffmpeg MP3 320kbps
│   └── tests/
│       ├── conftest.py               # tmp_path fixtures, TestClient, mock env
│       ├── test_store.py
│       ├── test_auth.py
│       ├── test_devices.py
│       ├── test_songs.py
│       ├── test_sync.py
│       └── test_download.py
└── web/
    ├── package.json
    ├── vite.config.ts                # proxy /api → localhost:8000 in dev; @tailwindcss/vite plugin
    ├── tsconfig.json
    ├── index.html                    # Geist font preload; PWA meta tags
    ├── public/
    │   ├── manifest.json
    │   └── icons/
    │       ├── icon-192.png
    │       └── icon-512.png
    └── src/
        ├── main.tsx
        ├── App.tsx                   # Auth gate → DeviceNameScreen → MainApp
        ├── lib/
        │   ├── api.ts                # Typed fetch wrapper; auto-injects X-Device-ID
        │   └── device.ts             # getDevice() / setDevice() / clearDevice() in localStorage
        ├── hooks/
        │   ├── useDevice.ts          # Returns { deviceId, deviceName, isRegistered }
        │   ├── useSongs.ts           # Fetches songs; exposes refetch; auto-polls every 10s
        │   └── useSync.ts            # triggerSync(); syncStatus state
        ├── components/
        │   ├── AuthScreen.tsx        # Access code input
        │   ├── DeviceNameScreen.tsx  # Device name input after auth
        │   ├── Header.tsx            # App title + Sync button + Settings trigger
        │   ├── AddSongForm.tsx       # URL input + playlist selector + submit
        │   ├── FilterBar.tsx         # Playlist pills + search input
        │   ├── SongList.tsx          # Maps songs through FilterBar logic → SongRow
        │   ├── SongRow.tsx           # Per-song: thumbnail, title, status, download button, delete
        │   ├── TikTokDownload.tsx    # URL input → immediate download
        │   └── SettingsSheet.tsx     # Device list, clear history, config fields
        └── styles/
            └── globals.css           # Tailwind v4 @import; CSS custom properties for dark theme
```

---

## Task 1: Project Scaffold

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `api/requirements.txt`
- Create: `web/package.json`
- Create: `web/vite.config.ts`
- Create: `web/tsconfig.json`
- Create: `web/index.html`

- [ ] **Step 1: Create `api/requirements.txt`**

```
fastapi==0.115.5
uvicorn[standard]==0.32.1
pydantic-settings==2.6.1
filelock==3.16.1
httpx==0.28.1
yt-dlp==2024.12.13
pytest==8.3.4
pytest-asyncio==0.24.0
```

- [ ] **Step 2: Create `web/package.json`**

```json
{
  "name": "music-assistant-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "motion": "^11.15.0",
    "@phosphor-icons/react": "^2.1.7",
    "@fontsource/geist": "^5.1.0",
    "@fontsource/geist-mono": "^5.1.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.5"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "typescript": "~5.6.2",
    "vite": "^6.0.5",
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0"
  }
}
```

- [ ] **Step 3: Create `web/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 4: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create `web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="theme-color" content="#0a0a0a" />
    <link rel="manifest" href="/manifest.json" />
    <link rel="apple-touch-icon" href="/icons/icon-192.png" />
    <title>Music Assistant</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `Dockerfile`**

```dockerfile
# Stage 1: Build React
FROM node:20-alpine AS web-builder
WORKDIR /web
COPY web/package*.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# Stage 2: Python app with ffmpeg
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY api/ .
COPY --from=web-builder /web/dist ./web/dist
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 7: Create `docker-compose.yml`**

```yaml
services:
  app:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - ./data:/data
      - ${HOME}/Music/MusicManager:/music
    env_file: .env
    restart: unless-stopped
```

- [ ] **Step 8: Create `.env.example`**

```env
ACCESS_CODE=changeme
YOUTUBE_API_KEY=AIzaXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
YOUTUBE_CHANNEL_ID=UCxxxxxxxxxxxxxxxxxxxxxxxxx
SOUNDCLOUD_PROFILE_URL=https://soundcloud.com/yourusername
MUSIC_DIR=/music
DATA_DIR=/data
```

- [ ] **Step 9: Create `data/` and stub `songs.json`**

```bash
mkdir -p data
echo '{"songs":[],"playlists":[],"devices":[]}' > data/songs.json
```

- [ ] **Step 10: Commit**

```bash
git add Dockerfile docker-compose.yml .env.example api/requirements.txt \
        web/package.json web/vite.config.ts web/tsconfig.json web/index.html \
        data/songs.json
git commit -m "feat: project scaffold — Dockerfile, docker-compose, web setup"
```

---

## Task 2: Data Models + Store

**Files:**
- Create: `api/models.py`
- Create: `api/store.py`
- Create: `api/tests/conftest.py`
- Create: `api/tests/test_store.py`

**Interfaces:**
- Produces: `SongsFile`, `Song`, `Device`, `DeviceDownload` (used by all later tasks)
- Produces: `read_songs(data_dir: str) -> SongsFile`
- Produces: `write_songs(data: SongsFile, data_dir: str) -> None`

- [ ] **Step 1: Create `api/models.py`**

```python
from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field
import uuid


def new_id() -> str:
    return str(uuid.uuid4())


class DeviceDownload(BaseModel):
    name: str
    downloaded: bool = False
    downloaded_at: datetime | None = None


class Song(BaseModel):
    id: str = Field(default_factory=new_id)
    title: str
    url: str
    platform: Literal["youtube", "soundcloud", "tiktok", "other"]
    playlist: str = "Default"
    thumbnail: str = ""
    added_at: datetime = Field(default_factory=datetime.utcnow)
    device_downloads: dict[str, DeviceDownload] = Field(default_factory=dict)


class Device(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str
    last_seen: datetime = Field(default_factory=datetime.utcnow)


class SongsFile(BaseModel):
    songs: list[Song] = Field(default_factory=list)
    playlists: list[str] = Field(default_factory=list)
    devices: list[Device] = Field(default_factory=list)
```

- [ ] **Step 2: Create `api/store.py`**

```python
from pathlib import Path
from filelock import FileLock
from models import SongsFile

_EMPTY = SongsFile()


def _path(data_dir: str) -> Path:
    return Path(data_dir) / "songs.json"


def read_songs(data_dir: str) -> SongsFile:
    p = _path(data_dir)
    lock = FileLock(str(p) + ".lock")
    with lock:
        if not p.exists():
            return SongsFile()
        return SongsFile.model_validate_json(p.read_text())


def write_songs(data: SongsFile, data_dir: str) -> None:
    p = _path(data_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    lock = FileLock(str(p) + ".lock")
    with lock:
        p.write_text(data.model_dump_json(indent=2))
```

- [ ] **Step 3: Create `api/tests/conftest.py`**

```python
import pytest
from pathlib import Path


@pytest.fixture
def data_dir(tmp_path: Path) -> str:
    d = tmp_path / "data"
    d.mkdir()
    return str(d)
```

- [ ] **Step 4: Write failing tests in `api/tests/test_store.py`**

```python
from models import SongsFile, Song, Device
from store import read_songs, write_songs


def test_read_returns_empty_when_file_missing(data_dir):
    result = read_songs(data_dir)
    assert result == SongsFile()


def test_write_then_read_roundtrip(data_dir):
    original = SongsFile(
        songs=[Song(title="Test", url="https://youtube.com/watch?v=abc", platform="youtube")],
        playlists=["Default"],
        devices=[],
    )
    write_songs(original, data_dir)
    result = read_songs(data_dir)
    assert len(result.songs) == 1
    assert result.songs[0].title == "Test"
    assert result.playlists == ["Default"]


def test_write_creates_parent_dirs(tmp_path):
    nested = str(tmp_path / "a" / "b" / "c")
    data = SongsFile()
    write_songs(data, nested)
    result = read_songs(nested)
    assert result == SongsFile()
```

- [ ] **Step 5: Run tests — expect FAIL**

```bash
cd api && python -m pytest tests/test_store.py -v
```

Expected: `ModuleNotFoundError: No module named 'models'` or similar.

- [ ] **Step 6: Install dependencies and run again**

```bash
cd api && pip install -r requirements.txt
python -m pytest tests/test_store.py -v
```

Expected: all 3 PASS.

- [ ] **Step 7: Commit**

```bash
git add api/models.py api/store.py api/tests/conftest.py api/tests/test_store.py
git commit -m "feat: data models and songs.json store with filelock"
```

---

## Task 3: Config + Auth Router + FastAPI Skeleton

**Files:**
- Create: `api/config.py`
- Create: `api/routers/__init__.py`
- Create: `api/routers/auth.py`
- Create: `api/main.py` (skeleton — static files added in Task 11)
- Create: `api/tests/test_auth.py`

**Interfaces:**
- Produces: `get_settings() -> Settings` (cached, used by all routers)
- Produces: `POST /api/auth/verify` → `{"ok": true}` or 401
- Produces: `get_device_id` FastAPI dependency (used by all protected routers)

- [ ] **Step 1: Create `api/config.py`**

```python
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    access_code: str
    youtube_api_key: str = ""
    youtube_channel_id: str = ""
    soundcloud_profile_url: str = ""
    music_dir: str = "/music"
    data_dir: str = "/data"

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 2: Create `api/routers/__init__.py`** (empty file)

```bash
touch api/routers/__init__.py api/services/__init__.py
```

- [ ] **Step 3: Create `api/routers/auth.py`**

```python
from fastapi import APIRouter, Depends, HTTPException, Header
from config import Settings, get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/verify")
async def verify(
    body: dict,
    settings: Settings = Depends(get_settings),
):
    code = body.get("code", "")
    if code != settings.access_code:
        raise HTTPException(status_code=401, detail="Invalid access code")
    return {"ok": True}


# Reusable dependency for all protected routes
async def get_device_id(x_device_id: str = Header(..., alias="X-Device-ID")) -> str:
    return x_device_id
```

- [ ] **Step 4: Create `api/main.py` skeleton**

```python
from fastapi import FastAPI
from routers import auth, devices, songs, sync, download

app = FastAPI(title="Music Assistant")

app.include_router(auth.router)
app.include_router(devices.router)
app.include_router(songs.router)
app.include_router(sync.router)
app.include_router(download.router)

# Static files added in Task 11 after web build exists
```

- [ ] **Step 5: Write failing tests in `api/tests/test_auth.py`**

```python
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ACCESS_CODE", "secret123")
    monkeypatch.setenv("DATA_DIR", "/tmp/test_data")
    # Clear lru_cache so monkeypatched env is picked up
    from config import get_settings
    get_settings.cache_clear()
    from main import app
    return TestClient(app)


def test_verify_correct_code(client):
    res = client.post("/api/auth/verify", json={"code": "secret123"})
    assert res.status_code == 200
    assert res.json() == {"ok": True}


def test_verify_wrong_code(client):
    res = client.post("/api/auth/verify", json={"code": "wrong"})
    assert res.status_code == 401


def test_protected_route_requires_device_id(client):
    res = client.get("/api/songs")
    assert res.status_code == 422  # missing header
```

- [ ] **Step 6: Run tests — stubs for missing routers needed first**

Create stub files so imports don't fail:

```bash
for f in devices songs sync download; do
  echo "from fastapi import APIRouter; router = APIRouter()" > api/routers/$f.py
done
mkdir -p api/services
touch api/services/__init__.py
```

- [ ] **Step 7: Run tests**

```bash
cd api && python -m pytest tests/test_auth.py -v
```

Expected: all 3 PASS.

- [ ] **Step 8: Commit**

```bash
git add api/config.py api/routers/ api/services/ api/main.py api/tests/test_auth.py
git commit -m "feat: config, auth router, FastAPI skeleton"
```

---

## Task 4: Devices Router

**Files:**
- Create: `api/routers/devices.py`
- Create: `api/tests/test_devices.py`

**Interfaces:**
- Produces: `POST /api/devices/register` body `{name}` → `{id, name}`
- Produces: `DELETE /api/devices/{device_id}/history` → `{ok: true}`

- [ ] **Step 1: Write failing tests in `api/tests/test_devices.py`**

```python
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch, data_dir):
    monkeypatch.setenv("ACCESS_CODE", "x")
    monkeypatch.setenv("DATA_DIR", data_dir)
    from config import get_settings
    get_settings.cache_clear()
    from main import app
    return TestClient(app)


def test_register_device(client):
    res = client.post("/api/devices/register", json={"name": "iPhone Main"})
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "iPhone Main"
    assert "id" in body


def test_register_persists_to_file(client, data_dir):
    client.post("/api/devices/register", json={"name": "Laptop"})
    from store import read_songs
    data = read_songs(data_dir)
    assert any(d.name == "Laptop" for d in data.devices)


def test_clear_history(client, data_dir):
    from store import read_songs, write_songs
    from models import SongsFile, Song, DeviceDownload
    dev_id = "dev-abc"
    song = Song(title="T", url="https://youtube.com/watch?v=x", platform="youtube",
                device_downloads={dev_id: DeviceDownload(name="Laptop", downloaded=True)})
    write_songs(SongsFile(songs=[song], playlists=[], devices=[]), data_dir)

    res = client.delete(f"/api/devices/{dev_id}/history",
                        headers={"X-Device-ID": dev_id})
    assert res.status_code == 200
    data = read_songs(data_dir)
    assert data.songs[0].device_downloads[dev_id].downloaded is False
```

- [ ] **Step 2: Implement `api/routers/devices.py`**

```python
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from config import Settings, get_settings
from models import Device
from store import read_songs, write_songs
from routers.auth import get_device_id

router = APIRouter(prefix="/api/devices", tags=["devices"])


class RegisterBody(BaseModel):
    name: str


@router.post("/register", status_code=201)
async def register_device(body: RegisterBody, settings: Settings = Depends(get_settings)):
    data = read_songs(settings.data_dir)
    device = Device(name=body.name)
    data.devices.append(device)
    write_songs(data, settings.data_dir)
    return {"id": device.id, "name": device.name}


@router.delete("/{device_id}/history")
async def clear_history(
    device_id: str,
    _: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    data = read_songs(settings.data_dir)
    for song in data.songs:
        if device_id in song.device_downloads:
            song.device_downloads[device_id].downloaded = False
            song.device_downloads[device_id].downloaded_at = None
    write_songs(data, settings.data_dir)
    return {"ok": True}
```

- [ ] **Step 3: Run tests**

```bash
cd api && python -m pytest tests/test_devices.py -v
```

Expected: all 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add api/routers/devices.py api/tests/test_devices.py
git commit -m "feat: devices router — register and clear history"
```

---

## Task 5: Songs Router

**Files:**
- Create: `api/routers/songs.py`
- Create: `api/tests/test_songs.py`

**Interfaces:**
- Produces: `GET /api/songs` (with `X-Device-ID`) → `{songs: SongResponse[], playlists: str[]}`
- Produces: `POST /api/songs` body `{url, playlist?}` → `SongResponse` (201) or 409
- Produces: `DELETE /api/songs/{id}` → `{ok: true}`
- Produces: `detect_platform(url: str) -> str` (used by sync service)

- [ ] **Step 1: Write failing tests in `api/tests/test_songs.py`**

```python
import pytest
from fastapi.testclient import TestClient
from models import SongsFile, Song, DeviceDownload
from store import write_songs


@pytest.fixture
def client(monkeypatch, data_dir):
    monkeypatch.setenv("ACCESS_CODE", "x")
    monkeypatch.setenv("DATA_DIR", data_dir)
    from config import get_settings
    get_settings.cache_clear()
    from main import app
    return TestClient(app)


DEV = "device-123"
HEADERS = {"X-Device-ID": DEV}


def seed(data_dir, songs):
    write_songs(SongsFile(songs=songs, playlists=["Chill"], devices=[]), data_dir)


def test_get_songs_empty(client):
    res = client.get("/api/songs", headers=HEADERS)
    assert res.status_code == 200
    assert res.json()["songs"] == []


def test_get_songs_includes_downloaded_flag(client, data_dir):
    song = Song(title="T", url="https://youtube.com/watch?v=abc", platform="youtube",
                device_downloads={DEV: DeviceDownload(name="Dev", downloaded=True)})
    seed(data_dir, [song])
    res = client.get("/api/songs", headers=HEADERS)
    s = res.json()["songs"][0]
    assert s["downloaded"] is True


def test_get_songs_false_for_unknown_device(client, data_dir):
    song = Song(title="T", url="https://youtube.com/watch?v=xyz", platform="youtube")
    seed(data_dir, [song])
    res = client.get("/api/songs", headers=HEADERS)
    assert res.json()["songs"][0]["downloaded"] is False


def test_post_song_adds_to_list(client):
    res = client.post("/api/songs",
                      json={"url": "https://soundcloud.com/artist/track"},
                      headers=HEADERS)
    assert res.status_code == 201
    assert res.json()["platform"] == "soundcloud"


def test_post_song_duplicate_returns_409(client, data_dir):
    url = "https://youtube.com/watch?v=dup"
    song = Song(title="T", url=url, platform="youtube")
    seed(data_dir, [song])
    res = client.post("/api/songs", json={"url": url}, headers=HEADERS)
    assert res.status_code == 409


def test_delete_song(client, data_dir):
    song = Song(title="T", url="https://youtube.com/watch?v=del", platform="youtube")
    seed(data_dir, [song])
    res = client.delete(f"/api/songs/{song.id}", headers=HEADERS)
    assert res.status_code == 200
    from store import read_songs
    assert len(read_songs(data_dir).songs) == 0
```

- [ ] **Step 2: Implement `api/routers/songs.py`**

```python
import re
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from config import Settings, get_settings
from models import Song
from store import read_songs, write_songs
from routers.auth import get_device_id

router = APIRouter(prefix="/api/songs", tags=["songs"])

_PLATFORM_PATTERNS = [
    (r"youtube\.com|youtu\.be", "youtube"),
    (r"soundcloud\.com", "soundcloud"),
    (r"tiktok\.com", "tiktok"),
]


def detect_platform(url: str) -> str:
    for pattern, platform in _PLATFORM_PATTERNS:
        if re.search(pattern, url):
            return platform
    return "other"


class AddSongBody(BaseModel):
    url: str
    playlist: str = "Default"


@router.get("")
async def get_songs(
    device_id: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    data = read_songs(settings.data_dir)
    songs_out = []
    for s in data.songs:
        dd = s.device_downloads.get(device_id)
        songs_out.append({
            **s.model_dump(),
            "downloaded": dd.downloaded if dd else False,
        })
    return {"songs": songs_out, "playlists": data.playlists}


@router.post("", status_code=201)
async def add_song(
    body: AddSongBody,
    device_id: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    data = read_songs(settings.data_dir)
    if any(s.url == body.url for s in data.songs):
        raise HTTPException(status_code=409, detail="Already exists")
    song = Song(
        title=body.url,  # title resolved later by metadata fetch if needed
        url=body.url,
        platform=detect_platform(body.url),
        playlist=body.playlist,
    )
    data.songs.insert(0, song)
    if body.playlist not in data.playlists:
        data.playlists.append(body.playlist)
    write_songs(data, settings.data_dir)
    return song


@router.delete("/{song_id}")
async def delete_song(
    song_id: str,
    _: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    data = read_songs(settings.data_dir)
    data.songs = [s for s in data.songs if s.id != song_id]
    write_songs(data, settings.data_dir)
    return {"ok": True}
```

- [ ] **Step 3: Run tests**

```bash
cd api && python -m pytest tests/test_songs.py -v
```

Expected: all 7 PASS.

- [ ] **Step 4: Commit**

```bash
git add api/routers/songs.py api/tests/test_songs.py
git commit -m "feat: songs router — list, add, delete with device-aware status"
```

---

## Task 6: YouTube Service

**Files:**
- Create: `api/services/youtube.py`
- Create: `api/tests/test_sync.py` (YouTube portion)

**Interfaces:**
- Produces: `fetch_youtube_playlists(api_key: str, channel_id: str) -> list[dict]`
  - Returns: `[{"title": str, "playlist_id": str, "songs": [{"title": str, "url": str, "thumbnail": str}]}]`

- [ ] **Step 1: Write failing tests in `api/tests/test_sync.py`**

```python
import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_fetch_youtube_playlists_returns_structured_data():
    playlists_response = {
        "items": [{"id": "PLabc", "snippet": {"title": "Chill"}}]
    }
    videos_response = {
        "items": [{
            "snippet": {
                "title": "Song One",
                "resourceId": {"videoId": "vid123"},
                "thumbnails": {"high": {"url": "https://img.com/thumb.jpg"}},
            }
        }]
    }

    async def mock_get(url, **kwargs):
        class R:
            def raise_for_status(self): pass
            def json(self):
                if "playlistItems" in url:
                    return videos_response
                return playlists_response
        return R()

    with patch("httpx.AsyncClient.get", new=mock_get):
        from services.youtube import fetch_youtube_playlists
        result = await fetch_youtube_playlists("key123", "UCchannel")

    assert len(result) == 1
    assert result[0]["title"] == "Chill"
    assert result[0]["songs"][0]["title"] == "Song One"
    assert "youtube.com" in result[0]["songs"][0]["url"]
```

- [ ] **Step 2: Implement `api/services/youtube.py`**

```python
import httpx

_BASE = "https://www.googleapis.com/youtube/v3"


async def fetch_youtube_playlists(api_key: str, channel_id: str) -> list[dict]:
    async with httpx.AsyncClient() as client:
        playlists = await _get_playlists(client, api_key, channel_id)
        result = []
        for pl in playlists:
            songs = await _get_playlist_items(client, api_key, pl["id"])
            result.append({"title": pl["snippet"]["title"], "playlist_id": pl["id"], "songs": songs})
        return result


async def _get_playlists(client: httpx.AsyncClient, api_key: str, channel_id: str) -> list:
    items, page_token = [], None
    while True:
        params = {"part": "snippet", "channelId": channel_id, "maxResults": 50, "key": api_key}
        if page_token:
            params["pageToken"] = page_token
        r = client.get(f"{_BASE}/playlists", params=params)
        r.raise_for_status()
        data = r.json()
        items.extend(data.get("items", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return items


async def _get_playlist_items(client: httpx.AsyncClient, api_key: str, playlist_id: str) -> list[dict]:
    songs, page_token = [], None
    while True:
        params = {"part": "snippet", "playlistId": playlist_id, "maxResults": 50, "key": api_key}
        if page_token:
            params["pageToken"] = page_token
        r = await client.get(f"{_BASE}/playlistItems", params=params)
        r.raise_for_status()
        data = r.json()
        for item in data.get("items", []):
            s = item["snippet"]
            vid_id = s.get("resourceId", {}).get("videoId", "")
            if not vid_id:
                continue
            thumb = s.get("thumbnails", {}).get("high", {}).get("url", "")
            songs.append({
                "title": s["title"],
                "url": f"https://www.youtube.com/watch?v={vid_id}",
                "thumbnail": thumb,
            })
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return songs
```

- [ ] **Step 3: Fix the async client call (bug in `_get_playlists` — missing `await`)**

In `_get_playlists`, line `r = client.get(...)` must be `r = await client.get(...)`. Correct it:

```python
async def _get_playlists(client: httpx.AsyncClient, api_key: str, channel_id: str) -> list:
    items, page_token = [], None
    while True:
        params = {"part": "snippet", "channelId": channel_id, "maxResults": 50, "key": api_key}
        if page_token:
            params["pageToken"] = page_token
        r = await client.get(f"{_BASE}/playlists", params=params)
        r.raise_for_status()
        data = r.json()
        items.extend(data.get("items", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return items
```

- [ ] **Step 4: Run tests**

```bash
cd api && pip install pytest-asyncio && python -m pytest tests/test_sync.py -v
```

Expected: 1 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/youtube.py api/tests/test_sync.py
git commit -m "feat: YouTube Data API v3 playlist fetcher"
```

---

## Task 7: SoundCloud Service + Downloader Service

**Files:**
- Create: `api/services/soundcloud.py`
- Create: `api/services/downloader.py`
- Create: `api/tests/test_download.py`

**Interfaces:**
- Produces: `fetch_soundcloud_playlists(profile_url: str) -> list[dict]`
  - Same shape as YouTube: `[{"title": str, "songs": [{"title": str, "url": str, "thumbnail": str}]}]`
- Produces: `download_song(url: str, playlist: str, music_dir: str) -> str`
  - Returns: absolute path to the downloaded MP3 file
- Produces: `get_file_path(url: str, playlist: str, music_dir: str) -> str | None`
  - Returns path if file exists on disk, else None

- [ ] **Step 1: Create `api/services/soundcloud.py`**

```python
import yt_dlp
from pathlib import Path


def fetch_soundcloud_playlists(profile_url: str) -> list[dict]:
    """Extract all playlists and tracks from a SoundCloud profile using yt-dlp flat extraction."""
    ydl_opts = {
        "quiet": True,
        "extract_flat": "in_playlist",
        "ignoreerrors": True,
    }
    playlists = []
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(profile_url, download=False)
        if not info:
            return []
        entries = info.get("entries", [])
        for entry in entries:
            if not entry or entry.get("_type") != "playlist":
                continue
            songs = []
            for track in entry.get("entries", []) or []:
                if not track:
                    continue
                songs.append({
                    "title": track.get("title", track.get("url", "")),
                    "url": track.get("url", ""),
                    "thumbnail": track.get("thumbnail", ""),
                })
            playlists.append({"title": entry.get("title", ""), "songs": songs})
    return playlists
```

- [ ] **Step 2: Create `api/services/downloader.py`**

```python
import re
from pathlib import Path
import yt_dlp


def _sanitize(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip()


def get_file_path(url: str, playlist: str, music_dir: str) -> str | None:
    """Return path to existing MP3 for this URL if already downloaded, else None."""
    safe_playlist = _sanitize(playlist)
    folder = Path(music_dir) / safe_playlist
    if not folder.exists():
        return None
    # yt-dlp names files as %(title)s.mp3 — we can't know the exact name without extracting info
    # So we embed the song ID in a sidecar file instead (see download_song)
    sidecar = folder / f".{_url_hash(url)}.done"
    if sidecar.exists():
        return sidecar.read_text().strip()
    return None


def _url_hash(url: str) -> str:
    import hashlib
    return hashlib.md5(url.encode()).hexdigest()[:12]


def download_song(url: str, playlist: str, music_dir: str) -> str:
    """Download url as MP3 320kbps to music_dir/playlist/. Returns path to MP3."""
    safe_playlist = _sanitize(playlist)
    folder = Path(music_dir) / safe_playlist
    folder.mkdir(parents=True, exist_ok=True)
    out_tmpl = str(folder / "%(title)s.%(ext)s")

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": out_tmpl,
        "writethumbnail": True,
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "320"},
            {"key": "FFmpegMetadata", "add_metadata": True},
            {"key": "EmbedThumbnail"},
        ],
        "nooverwrites": True,
        "quiet": True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        title = info.get("title", "unknown")
        mp3_path = str(folder / f"{yt_dlp.utils.sanitize_filename(title)}.mp3")

    # Write sidecar so get_file_path can find this file later
    sidecar = folder / f".{_url_hash(url)}.done"
    sidecar.write_text(mp3_path)

    return mp3_path
```

- [ ] **Step 3: Write tests in `api/tests/test_download.py`**

```python
import pytest
from unittest.mock import patch, MagicMock
from pathlib import Path


def test_get_file_path_returns_none_when_not_downloaded(tmp_path):
    from services.downloader import get_file_path
    result = get_file_path("https://youtube.com/watch?v=abc", "Chill", str(tmp_path))
    assert result is None


def test_get_file_path_returns_path_when_sidecar_exists(tmp_path):
    from services.downloader import get_file_path, _url_hash, _sanitize
    url = "https://youtube.com/watch?v=abc"
    playlist = "Chill"
    folder = tmp_path / _sanitize(playlist)
    folder.mkdir()
    mp3 = str(folder / "Song Title.mp3")
    sidecar = folder / f".{_url_hash(url)}.done"
    sidecar.write_text(mp3)
    assert get_file_path(url, playlist, str(tmp_path)) == mp3


def test_download_song_calls_yt_dlp(tmp_path):
    from services.downloader import download_song
    mock_info = {"title": "Test Song"}
    with patch("yt_dlp.YoutubeDL") as MockYDL:
        instance = MockYDL.return_value.__enter__.return_value
        instance.extract_info.return_value = mock_info
        # Create the expected MP3 so the function can write the sidecar
        folder = tmp_path / "Chill"
        folder.mkdir()
        mp3 = folder / "Test Song.mp3"
        mp3.write_text("fake")
        result = download_song("https://youtube.com/watch?v=x", "Chill", str(tmp_path))
    assert "Test Song.mp3" in result
```

- [ ] **Step 4: Run tests**

```bash
cd api && python -m pytest tests/test_download.py -v
```

Expected: all 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/soundcloud.py api/services/downloader.py api/tests/test_download.py
git commit -m "feat: SoundCloud extractor and yt-dlp downloader service"
```

---

## Task 8: Sync Router + Download Router

**Files:**
- Create: `api/routers/sync.py`
- Create: `api/routers/download.py`

**Interfaces:**
- Produces: `POST /api/sync` → `{added: int, total: int}` (runs as BackgroundTask)
- Produces: `GET /api/sync/status` → `{running: bool, added: int, total: int, error: str|null}`
- Produces: `POST /api/download/{song_id}/prepare` → `{status: "downloading"|"ready"}`
- Produces: `GET /api/download/{song_id}` → FileResponse (streams MP3)
- Produces: `POST /api/download/tiktok` body `{url}` → FileResponse

- [ ] **Step 1: Create `api/routers/sync.py`**

```python
from fastapi import APIRouter, BackgroundTasks, Depends
from config import Settings, get_settings
from models import Song, SongsFile
from store import read_songs, write_songs
from routers.auth import get_device_id
from routers.songs import detect_platform
from services.youtube import fetch_youtube_playlists
from services.soundcloud import fetch_soundcloud_playlists

router = APIRouter(prefix="/api/sync", tags=["sync"])

_status: dict = {"running": False, "added": 0, "total": 0, "error": None}


@router.post("")
async def trigger_sync(
    background_tasks: BackgroundTasks,
    _: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    if _status["running"]:
        return {"message": "Sync already running"}
    background_tasks.add_task(_run_sync, settings)
    return {"message": "Sync started"}


@router.get("/status")
async def sync_status(_: str = Depends(get_device_id)):
    return _status


async def _run_sync(settings: Settings):
    global _status
    _status = {"running": True, "added": 0, "total": 0, "error": None}
    try:
        all_playlists: list[dict] = []

        if settings.youtube_api_key and settings.youtube_channel_id:
            yt = await fetch_youtube_playlists(settings.youtube_api_key, settings.youtube_channel_id)
            all_playlists.extend(yt)

        if settings.soundcloud_profile_url:
            sc = fetch_soundcloud_playlists(settings.soundcloud_profile_url)
            all_playlists.extend(sc)

        data = read_songs(settings.data_dir)
        existing_urls = {s.url for s in data.songs}
        added = 0

        for pl in all_playlists:
            pl_name = pl["title"]
            if pl_name not in data.playlists:
                data.playlists.append(pl_name)
            for track in pl["songs"]:
                if track["url"] in existing_urls:
                    continue
                song = Song(
                    title=track["title"],
                    url=track["url"],
                    platform=detect_platform(track["url"]),
                    playlist=pl_name,
                    thumbnail=track.get("thumbnail", ""),
                )
                data.songs.append(song)
                existing_urls.add(track["url"])
                added += 1

        write_songs(data, settings.data_dir)
        _status = {"running": False, "added": added, "total": len(data.songs), "error": None}
    except Exception as e:
        _status = {"running": False, "added": 0, "total": 0, "error": str(e)}
```

- [ ] **Step 2: Create `api/routers/download.py`**

```python
import asyncio
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from config import Settings, get_settings
from models import DeviceDownload
from store import read_songs, write_songs
from routers.auth import get_device_id
from services.downloader import download_song, get_file_path

router = APIRouter(prefix="/api/download", tags=["download"])

_preparing: set[str] = set()  # song IDs currently being prepared


class TikTokBody(BaseModel):
    url: str


@router.post("/{song_id}/prepare")
async def prepare_download(
    song_id: str,
    device_id: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    data = read_songs(settings.data_dir)
    song = next((s for s in data.songs if s.id == song_id), None)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    existing = get_file_path(song.url, song.playlist, settings.music_dir)
    if existing:
        return {"status": "ready"}

    if song_id not in _preparing:
        _preparing.add(song_id)
        asyncio.create_task(_do_prepare(song_id, song.url, song.playlist, settings.music_dir))

    return {"status": "downloading"}


async def _do_prepare(song_id: str, url: str, playlist: str, music_dir: str):
    try:
        await asyncio.to_thread(download_song, url, playlist, music_dir)
    finally:
        _preparing.discard(song_id)


@router.get("/{song_id}")
async def serve_download(
    song_id: str,
    device_id: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    data = read_songs(settings.data_dir)
    song = next((s for s in data.songs if s.id == song_id), None)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")

    mp3_path = get_file_path(song.url, song.playlist, settings.music_dir)
    if not mp3_path or not Path(mp3_path).exists():
        # Block until downloaded (synchronous fallback for direct access)
        mp3_path = await asyncio.to_thread(download_song, song.url, song.playlist, settings.music_dir)

    # Mark as downloaded for this device
    if device_id not in song.device_downloads:
        song.device_downloads[device_id] = DeviceDownload(name="Unknown")
    song.device_downloads[device_id].downloaded = True
    from datetime import datetime
    song.device_downloads[device_id].downloaded_at = datetime.utcnow()
    write_songs(data, settings.data_dir)

    filename = Path(mp3_path).name
    return FileResponse(mp3_path, media_type="audio/mpeg",
                        headers={"Content-Disposition": f'attachment; filename="{filename}"'})


@router.post("/tiktok")
async def download_tiktok(
    body: TikTokBody,
    _: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    import tempfile, os
    with tempfile.TemporaryDirectory() as tmpdir:
        mp3_path = await asyncio.to_thread(download_song, body.url, "_tiktok_tmp", tmpdir)
        filename = Path(mp3_path).name
        # Read into memory so we can delete tmpdir
        content = Path(mp3_path).read_bytes()

    from fastapi.responses import Response
    return Response(
        content=content,
        media_type="audio/mpeg",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
```

- [ ] **Step 3: Run all backend tests**

```bash
cd api && python -m pytest tests/ -v
```

Expected: all tests PASS (sync/download routers have no dedicated unit tests — covered in integration).

- [ ] **Step 4: Commit**

```bash
git add api/routers/sync.py api/routers/download.py
git commit -m "feat: sync router (YouTube+SoundCloud) and download router (prepare/serve/tiktok)"
```

---

## Task 9: FastAPI Main — Wire Static Files

**Files:**
- Modify: `api/main.py` (complete version with static file serving)

- [ ] **Step 1: Replace `api/main.py` with final version**

```python
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
```

- [ ] **Step 2: Verify API still works**

```bash
cd api && python -m pytest tests/ -v
```

Expected: all tests PASS.

- [ ] **Step 3: Smoke test the server locally**

```bash
cd api && uvicorn main:app --reload --port 8000
# In another terminal:
curl -s http://localhost:8000/api/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"code": "wrong"}' | python -m json.tool
```

Expected: `{"detail": "Invalid access code"}`

- [ ] **Step 4: Commit**

```bash
git add api/main.py
git commit -m "feat: FastAPI main — wire all routers, SPA static file serving"
```

---

## Task 10: React Scaffold + Design System

**Files:**
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx` (skeleton)
- Create: `web/src/styles/globals.css`
- Create: `web/public/manifest.json`

- [ ] **Step 1: Install web dependencies**

```bash
cd web && npm install
```

- [ ] **Step 2: Create `web/src/styles/globals.css`**

```css
@import "tailwindcss";
@import "@fontsource/geist/400.css";
@import "@fontsource/geist/500.css";
@import "@fontsource/geist/600.css";
@import "@fontsource/geist-mono/400.css";

@theme {
  --font-sans: "Geist", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, monospace;

  --color-bg: #0a0a0a;
  --color-surface: #141414;
  --color-surface-elevated: #1c1c1c;
  --color-border: #262626;
  --color-text: #fafafa;
  --color-text-secondary: #71717a;
  --color-text-muted: #3f3f46;
  --color-accent: #10b981;
  --color-accent-muted: #064e3b;
  --color-error: #ef4444;

  --color-platform-youtube: #ef4444;
  --color-platform-soundcloud: #f97316;
  --color-platform-tiktok: #06b6d4;
}

*, *::before, *::after {
  box-sizing: border-box;
}

body {
  background-color: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  min-height: 100dvh;
}
```

- [ ] **Step 3: Create `web/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 4: Create `web/src/App.tsx` skeleton**

```tsx
export default function App() {
  return (
    <div className="min-h-[100dvh] bg-[var(--color-bg)] text-[var(--color-text)]">
      <p className="p-8 font-mono text-[var(--color-accent)]">Music Assistant — loading...</p>
    </div>
  )
}
```

- [ ] **Step 5: Create `web/public/manifest.json`**

```json
{
  "name": "Music Assistant",
  "short_name": "Music",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0a",
  "theme_color": "#0a0a0a",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 6: Create placeholder icons**

```bash
mkdir -p web/public/icons
# Create minimal valid 192x192 PNG (1x1 pixel scaled) as placeholder
python3 -c "
import struct, zlib, base64
def make_png(w, h, color=(16, 185, 129)):
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t+d)&0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    raw = b''.join(b'\x00' + bytes(color)*w for _ in range(h))
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
open('web/public/icons/icon-192.png','wb').write(make_png(192,192))
open('web/public/icons/icon-512.png','wb').write(make_png(512,512))
print('Icons created')
"
```

- [ ] **Step 7: Verify React dev server starts**

```bash
cd web && npm run dev
```

Open `http://localhost:5173` — should show "Music Assistant — loading..." on black background.

- [ ] **Step 8: Commit**

```bash
git add web/src/ web/public/ web/package.json web/vite.config.ts web/tsconfig.json web/index.html
git commit -m "feat: React scaffold, Tailwind v4 dark theme, PWA manifest, placeholder icons"
```

---

## Task 11: API Client + Device Library

**Files:**
- Create: `web/src/lib/device.ts`
- Create: `web/src/lib/api.ts`
- Create: `web/src/hooks/useDevice.ts`

**Interfaces:**
- Produces: `getDevice() -> {id: string, name: string} | null`
- Produces: `setDevice(id: string, name: string) -> void`
- Produces: `clearDevice() -> void`
- Produces: `api` object with typed methods (used by all components/hooks)
- Produces: `useDevice()` hook → `{deviceId, deviceName, isRegistered, setDevice}`

- [ ] **Step 1: Create `web/src/lib/device.ts`**

```typescript
const KEY = 'ma_device'

export interface DeviceInfo {
  id: string
  name: string
}

export function getDevice(): DeviceInfo | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setDevice(id: string, name: string): void {
  localStorage.setItem(KEY, JSON.stringify({ id, name }))
}

export function clearDevice(): void {
  localStorage.removeItem(KEY)
}
```

- [ ] **Step 2: Create `web/src/lib/api.ts`**

```typescript
import { getDevice } from './device'

function headers(): HeadersInit {
  const device = getDevice()
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (device) h['X-Device-ID'] = device.id
  return h
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: headers(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Request failed')
  }
  return res.json()
}

export interface SongResponse {
  id: string
  title: string
  url: string
  platform: 'youtube' | 'soundcloud' | 'tiktok' | 'other'
  playlist: string
  thumbnail: string
  added_at: string
  downloaded: boolean
}

export interface SongsListResponse {
  songs: SongResponse[]
  playlists: string[]
}

export const api = {
  auth: {
    verify: (code: string) => req<{ ok: boolean }>('POST', '/api/auth/verify', { code }),
  },
  devices: {
    register: (name: string) => req<{ id: string; name: string }>('POST', '/api/devices/register', { name }),
    clearHistory: (deviceId: string) => req<{ ok: boolean }>('DELETE', `/api/devices/${deviceId}/history`),
  },
  songs: {
    list: () => req<SongsListResponse>('GET', '/api/songs'),
    add: (url: string, playlist?: string) => req<SongResponse>('POST', '/api/songs', { url, playlist }),
    delete: (id: string) => req<{ ok: boolean }>('DELETE', `/api/songs/${id}`),
  },
  sync: {
    trigger: () => req<{ message: string }>('POST', '/api/sync'),
    status: () => req<{ running: boolean; added: number; total: number; error: string | null }>('GET', '/api/sync/status'),
  },
  download: {
    prepare: (songId: string) => req<{ status: 'downloading' | 'ready' }>('POST', `/api/download/${songId}/prepare`),
    url: (songId: string) => {
      const device = getDevice()
      return `/api/download/${songId}?device_id=${device?.id ?? ''}`
    },
  },
}
```

- [ ] **Step 3: Create `web/src/hooks/useDevice.ts`**

```typescript
import { useState, useCallback } from 'react'
import { getDevice, setDevice as storeDevice, clearDevice } from '../lib/device'
import { api } from '../lib/api'

export function useDevice() {
  const [device, setDeviceState] = useState(getDevice)

  const register = useCallback(async (name: string) => {
    const result = await api.devices.register(name)
    storeDevice(result.id, result.name)
    setDeviceState({ id: result.id, name: result.name })
    return result
  }, [])

  const clear = useCallback(() => {
    clearDevice()
    setDeviceState(null)
  }, [])

  return {
    deviceId: device?.id ?? null,
    deviceName: device?.name ?? null,
    isRegistered: device !== null,
    register,
    clear,
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/ web/src/hooks/useDevice.ts
git commit -m "feat: API client with typed methods, device localStorage helpers, useDevice hook"
```

---

## Task 12: Auth + Device Name Screens

**Files:**
- Create: `web/src/components/AuthScreen.tsx`
- Create: `web/src/components/DeviceNameScreen.tsx`

- [ ] **Step 1: Create `web/src/components/AuthScreen.tsx`**

```tsx
import { useState, FormEvent } from 'react'
import { api } from '../lib/api'

interface Props {
  onVerified: () => void
}

export function AuthScreen({ onVerified }: Props) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.auth.verify(code)
      onVerified()
    } catch {
      setError('Wrong code. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Music Assistant</h1>
        <p className="text-[var(--color-text-secondary)] text-sm">Enter your access code to continue.</p>

        <div className="space-y-2">
          <input
            type="password"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Access code"
            autoFocus
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)] transition-colors"
          />
          {error && <p className="text-[var(--color-error)] text-sm">{error}</p>}
        </div>

        <button
          type="submit"
          disabled={loading || !code}
          className="w-full rounded-lg bg-[var(--color-accent)] px-4 py-3 text-sm font-medium text-white disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          {loading ? 'Checking...' : 'Continue'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Create `web/src/components/DeviceNameScreen.tsx`**

```tsx
import { useState, FormEvent } from 'react'
import { useDevice } from '../hooks/useDevice'

interface Props {
  onRegistered: () => void
}

export function DeviceNameScreen({ onRegistered }: Props) {
  const { register } = useDevice()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await register(name.trim())
      onRegistered()
    } catch {
      setError('Failed to register device. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Name this device</h1>
        <p className="text-[var(--color-text-secondary)] text-sm">
          Give this device a name so you can track downloads separately. You can change it later.
        </p>

        <div className="space-y-2">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. iPhone Main, Work Laptop"
            autoFocus
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)] transition-colors"
          />
          {error && <p className="text-[var(--color-error)] text-sm">{error}</p>}
        </div>

        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="w-full rounded-lg bg-[var(--color-accent)] px-4 py-3 text-sm font-medium text-white disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          {loading ? 'Saving...' : 'Save and continue'}
        </button>
      </form>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/AuthScreen.tsx web/src/components/DeviceNameScreen.tsx
git commit -m "feat: auth screen and device name registration screen"
```

---

## Task 13: Songs Hook + Sync Hook + Header

**Files:**
- Create: `web/src/hooks/useSongs.ts`
- Create: `web/src/hooks/useSync.ts`
- Create: `web/src/components/Header.tsx`

- [ ] **Step 1: Create `web/src/hooks/useSongs.ts`**

```typescript
import { useState, useEffect, useCallback } from 'react'
import { api, SongResponse } from '../lib/api'

export function useSongs() {
  const [songs, setSongs] = useState<SongResponse[]>([])
  const [playlists, setPlaylists] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    try {
      const data = await api.songs.list()
      setSongs(data.songs)
      setPlaylists(data.playlists)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load songs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch()
    const id = setInterval(fetch, 10_000)
    return () => clearInterval(id)
  }, [fetch])

  const removeSong = useCallback(async (id: string) => {
    setSongs(prev => prev.filter(s => s.id !== id))
    await api.songs.delete(id)
  }, [])

  const addSong = useCallback(async (url: string, playlist?: string) => {
    const song = await api.songs.add(url, playlist)
    setSongs(prev => [{ ...song, downloaded: false }, ...prev])
    return song
  }, [])

  const pendingCount = songs.filter(s => !s.downloaded).length

  return { songs, playlists, loading, error, pendingCount, refetch: fetch, removeSong, addSong }
}
```

- [ ] **Step 2: Create `web/src/hooks/useSync.ts`**

```typescript
import { useState, useCallback } from 'react'
import { api } from '../lib/api'

export function useSync(onComplete: () => void) {
  const [running, setRunning] = useState(false)
  const [lastResult, setLastResult] = useState<{ added: number } | null>(null)

  const trigger = useCallback(async () => {
    if (running) return
    setRunning(true)
    try {
      await api.sync.trigger()
      const poll = setInterval(async () => {
        const status = await api.sync.status()
        if (!status.running) {
          clearInterval(poll)
          setRunning(false)
          setLastResult({ added: status.added })
          onComplete()
        }
      }, 2000)
    } catch {
      setRunning(false)
    }
  }, [running, onComplete])

  return { trigger, running, lastResult }
}
```

- [ ] **Step 3: Create `web/src/components/Header.tsx`**

```tsx
import { ArrowsClockwise, GearSix, MusicNote } from '@phosphor-icons/react'
import { motion, AnimatePresence } from 'motion/react'

interface Props {
  pendingCount: number
  syncRunning: boolean
  onSync: () => void
  onSettings: () => void
}

export function Header({ pendingCount, syncRunning, onSync, onSettings }: Props) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <MusicNote size={20} weight="fill" className="text-[var(--color-accent)]" />
        <span className="font-semibold text-sm">Music Assistant</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onSettings}
          className="p-2 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors"
          aria-label="Settings"
        >
          <GearSix size={18} />
        </button>

        <button
          onClick={onSync}
          disabled={syncRunning}
          className="relative flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium transition-colors hover:border-[var(--color-accent)] disabled:opacity-50"
        >
          <motion.span animate={syncRunning ? { rotate: 360 } : { rotate: 0 }}
            transition={{ repeat: syncRunning ? Infinity : 0, duration: 1, ease: 'linear' }}>
            <ArrowsClockwise size={14} />
          </motion.span>
          Sync
          <AnimatePresence>
            {pendingCount > 0 && (
              <motion.span
                initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}
                className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full bg-[var(--color-accent)] text-white text-[10px] font-bold flex items-center justify-center px-1"
              >
                {pendingCount}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/ web/src/components/Header.tsx
git commit -m "feat: useSongs, useSync hooks and Header component with sync badge"
```

---

## Task 14: Song List Components

**Files:**
- Create: `web/src/components/FilterBar.tsx`
- Create: `web/src/components/SongRow.tsx`
- Create: `web/src/components/SongList.tsx`

- [ ] **Step 1: Create `web/src/components/FilterBar.tsx`**

```tsx
import { MagnifyingGlass } from '@phosphor-icons/react'
import { clsx } from 'clsx'

interface Props {
  playlists: string[]
  activePlaylist: string
  search: string
  onPlaylistChange: (p: string) => void
  onSearchChange: (s: string) => void
}

export function FilterBar({ playlists, activePlaylist, search, onPlaylistChange, onSearchChange }: Props) {
  return (
    <div className="space-y-3 px-4 py-3 border-b border-[var(--color-border)]">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {['All', ...playlists].map(pl => (
          <button
            key={pl}
            onClick={() => onPlaylistChange(pl)}
            className={clsx(
              'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
              activePlaylist === pl
                ? 'bg-[var(--color-accent)] text-white'
                : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
            )}
          >
            {pl}
          </button>
        ))}
      </div>

      <div className="relative">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search songs..."
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-4 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition-colors placeholder:text-[var(--color-text-muted)]"
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `web/src/components/SongRow.tsx`**

```tsx
import { useState } from 'react'
import { ArrowCircleDown, CheckCircle, X, SoundcloudLogo, YoutubeLogo, TiktokLogo, MusicNote } from '@phosphor-icons/react'
import { clsx } from 'clsx'
import { SongResponse } from '../lib/api'
import { api } from '../lib/api'

interface Props {
  song: SongResponse
  onDelete: (id: string) => void
  onDownloaded: () => void
}

const PLATFORM_ICONS = {
  youtube: YoutubeLogo,
  soundcloud: SoundcloudLogo,
  tiktok: TiktokLogo,
  other: MusicNote,
}

const PLATFORM_COLORS = {
  youtube: 'var(--color-platform-youtube)',
  soundcloud: 'var(--color-platform-soundcloud)',
  tiktok: 'var(--color-platform-tiktok)',
  other: 'var(--color-text-secondary)',
}

export function SongRow({ song, onDelete, onDownloaded }: Props) {
  const [downloading, setDownloading] = useState(false)
  const PlatformIcon = PLATFORM_ICONS[song.platform]

  async function handleDownload() {
    setDownloading(true)
    try {
      await api.download.prepare(song.id)
      // Trigger browser download
      const link = document.createElement('a')
      link.href = api.download.url(song.id)
      link.download = ''
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(onDownloaded, 3000) // refetch after a delay
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-surface)] transition-colors group">
      {/* Thumbnail */}
      <div className="shrink-0 w-10 h-10 rounded-md bg-[var(--color-surface-elevated)] overflow-hidden flex items-center justify-center">
        {song.thumbnail
          ? <img src={song.thumbnail} alt="" className="w-full h-full object-cover" />
          : <PlatformIcon size={18} color={PLATFORM_COLORS[song.platform]} />
        }
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <a
          href={song.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-sm font-medium hover:text-[var(--color-accent)] transition-colors"
        >
          {song.title}
        </a>
        <div className="flex items-center gap-1.5 mt-0.5">
          <PlatformIcon size={11} color={PLATFORM_COLORS[song.platform]} />
          <span className="text-[11px] text-[var(--color-text-muted)]">{song.playlist}</span>
        </div>
      </div>

      {/* Status + actions */}
      <div className="flex items-center gap-2 shrink-0">
        {song.downloaded ? (
          <span className="flex items-center gap-1 text-[11px] text-[var(--color-accent)] font-medium">
            <CheckCircle size={14} weight="fill" />
            Done
          </span>
        ) : (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className={clsx(
              'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              downloading
                ? 'text-[var(--color-text-muted)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)]'
            )}
          >
            <ArrowCircleDown size={14} className={downloading ? 'animate-spin' : ''} />
            {downloading ? 'Preparing...' : 'Download'}
          </button>
        )}

        <button
          onClick={() => onDelete(song.id)}
          className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-all"
          aria-label="Remove song"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `web/src/components/SongList.tsx`**

```tsx
import { MusicNote } from '@phosphor-icons/react'
import { SongResponse } from '../lib/api'
import { SongRow } from './SongRow'

interface Props {
  songs: SongResponse[]
  activePlaylist: string
  search: string
  onDelete: (id: string) => void
  onDownloaded: () => void
}

export function SongList({ songs, activePlaylist, search, onDelete, onDownloaded }: Props) {
  const filtered = songs.filter(s => {
    const matchPlaylist = activePlaylist === 'All' || s.playlist === activePlaylist
    const matchSearch = !search || s.title.toLowerCase().includes(search.toLowerCase())
    return matchPlaylist && matchSearch
  })

  if (songs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
        <MusicNote size={40} className="text-[var(--color-text-muted)] mb-4" />
        <p className="text-sm text-[var(--color-text-secondary)]">No songs yet.</p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">Paste a YouTube or SoundCloud link above to get started.</p>
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-[var(--color-text-secondary)]">No songs match your filter.</p>
      </div>
    )
  }

  return (
    <div>
      {filtered.map(song => (
        <SongRow key={song.id} song={song} onDelete={onDelete} onDownloaded={onDownloaded} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/FilterBar.tsx web/src/components/SongRow.tsx web/src/components/SongList.tsx
git commit -m "feat: FilterBar, SongRow, SongList components"
```

---

## Task 15: Add Song Form + TikTok Download + Settings Sheet

**Files:**
- Create: `web/src/components/AddSongForm.tsx`
- Create: `web/src/components/TikTokDownload.tsx`
- Create: `web/src/components/SettingsSheet.tsx`

- [ ] **Step 1: Create `web/src/components/AddSongForm.tsx`**

```tsx
import { useState, FormEvent } from 'react'
import { Plus } from '@phosphor-icons/react'

interface Props {
  playlists: string[]
  onAdd: (url: string, playlist: string) => Promise<void>
}

export function AddSongForm({ playlists, onAdd }: Props) {
  const [url, setUrl] = useState('')
  const [playlist, setPlaylist] = useState('')
  const [newPlaylist, setNewPlaylist] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const effectivePlaylist = newPlaylist.trim() || playlist || 'Default'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setError('')
    setLoading(true)
    try {
      await onAdd(url.trim(), effectivePlaylist)
      setUrl('')
      setNewPlaylist('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add song')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 py-3 border-b border-[var(--color-border)] space-y-2">
      <input
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="Paste YouTube or SoundCloud URL..."
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-accent)] transition-colors placeholder:text-[var(--color-text-muted)]"
      />

      <div className="flex gap-2">
        <select
          value={playlist}
          onChange={e => setPlaylist(e.target.value)}
          className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition-colors text-[var(--color-text-secondary)]"
        >
          <option value="">Select playlist...</option>
          {playlists.map(p => <option key={p} value={p}>{p}</option>)}
          <option value="__new__">+ New playlist</option>
        </select>

        {playlist === '__new__' && (
          <input
            value={newPlaylist}
            onChange={e => setNewPlaylist(e.target.value)}
            placeholder="Playlist name"
            autoFocus
            className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition-colors"
          />
        )}

        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-40 active:scale-[0.98] transition-transform shrink-0"
        >
          <Plus size={14} weight="bold" />
          {loading ? 'Adding...' : 'Add'}
        </button>
      </div>

      {error && <p className="text-[var(--color-error)] text-xs">{error}</p>}
    </form>
  )
}
```

- [ ] **Step 2: Create `web/src/components/TikTokDownload.tsx`**

```tsx
import { useState, FormEvent } from 'react'
import { TiktokLogo, ArrowCircleDown } from '@phosphor-icons/react'
import { getDevice } from '../lib/device'

export function TikTokDownload() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setError('')
    setLoading(true)
    try {
      const device = getDevice()
      const res = await fetch('/api/download/tiktok', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': device?.id ?? '',
        },
        body: JSON.stringify({ url: url.trim() }),
      })
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const disposition = res.headers.get('content-disposition') ?? ''
      const filename = disposition.match(/filename="(.+)"/)?.[1] ?? 'tiktok.mp3'
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = filename
      link.click()
      URL.revokeObjectURL(link.href)
      setUrl('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="px-4 py-3 border-t border-[var(--color-border)]">
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 flex items-center gap-1">
        <TiktokLogo size={11} color="var(--color-platform-tiktok)" />
        TikTok quick download
      </p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="Paste TikTok link..."
          className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-platform-tiktok)] transition-colors placeholder:text-[var(--color-text-muted)]"
        />
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--color-platform-tiktok)] px-3 py-2 text-xs font-medium text-[var(--color-platform-tiktok)] disabled:opacity-40 active:scale-[0.98] transition-transform shrink-0"
        >
          <ArrowCircleDown size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Downloading...' : 'Download'}
        </button>
      </form>
      {error && <p className="text-[var(--color-error)] text-xs mt-1">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Create `web/src/components/SettingsSheet.tsx`**

```tsx
import { useState } from 'react'
import { X, Trash, SignOut } from '@phosphor-icons/react'
import { useDevice } from '../hooks/useDevice'
import { api } from '../lib/api'

interface Props {
  open: boolean
  onClose: () => void
  onHistoryCleared: () => void
}

export function SettingsSheet({ open, onClose, onHistoryCleared }: Props) {
  const { deviceId, deviceName, clear } = useDevice()
  const [clearing, setClearing] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  async function handleClearHistory() {
    if (!confirmed) { setConfirmed(true); return }
    if (!deviceId) return
    setClearing(true)
    try {
      await api.devices.clearHistory(deviceId)
      setConfirmed(false)
      onHistoryCleared()
    } finally {
      setClearing(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-[var(--color-surface)] h-full overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--color-border)]">
          <h2 className="font-semibold text-sm">Settings</h2>
          <button onClick={onClose} className="p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-6">
          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-3">This device</h3>
            <p className="text-sm font-medium">{deviceName}</p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 font-mono">{deviceId}</p>
          </section>

          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-3">Download history</h3>
            <button
              onClick={handleClearHistory}
              disabled={clearing}
              className="flex items-center gap-2 rounded-lg border border-[var(--color-error)]/30 px-3 py-2 text-xs text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors w-full"
            >
              <Trash size={14} />
              {confirmed ? 'Tap again to confirm' : 'Clear my download history'}
            </button>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5">
              Marks all songs as undownloaded for this device. MP3 files are not deleted.
            </p>
          </section>

          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-3">Account</h3>
            <button
              onClick={clear}
              className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors w-full"
            >
              <SignOut size={14} />
              Unregister this device
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/AddSongForm.tsx web/src/components/TikTokDownload.tsx web/src/components/SettingsSheet.tsx
git commit -m "feat: AddSongForm, TikTokDownload, SettingsSheet components"
```

---

## Task 16: App Orchestration

**Files:**
- Modify: `web/src/App.tsx` (full implementation)

- [ ] **Step 1: Replace `web/src/App.tsx` with full implementation**

```tsx
import { useState, useCallback } from 'react'
import { useDevice } from './hooks/useDevice'
import { useSongs } from './hooks/useSongs'
import { useSync } from './hooks/useSync'
import { AuthScreen } from './components/AuthScreen'
import { DeviceNameScreen } from './components/DeviceNameScreen'
import { Header } from './components/Header'
import { AddSongForm } from './components/AddSongForm'
import { FilterBar } from './components/FilterBar'
import { SongList } from './components/SongList'
import { TikTokDownload } from './components/TikTokDownload'
import { SettingsSheet } from './components/SettingsSheet'

type AuthState = 'checking' | 'needs_code' | 'needs_name' | 'ready'

export default function App() {
  const { isRegistered, register } = useDevice()
  const [authState, setAuthState] = useState<AuthState>(isRegistered ? 'ready' : 'needs_code')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activePlaylist, setActivePlaylist] = useState('All')
  const [search, setSearch] = useState('')

  const { songs, playlists, pendingCount, refetch, removeSong, addSong } = useSongs()
  const { trigger: triggerSync, running: syncRunning } = useSync(refetch)

  const handleVerified = useCallback(() => setAuthState('needs_name'), [])
  const handleRegistered = useCallback(() => setAuthState('ready'), [])

  if (authState === 'needs_code') return <AuthScreen onVerified={handleVerified} />
  if (authState === 'needs_name') return <DeviceNameScreen onRegistered={handleRegistered} />

  return (
    <div className="min-h-[100dvh] flex flex-col max-w-2xl mx-auto">
      <Header
        pendingCount={pendingCount}
        syncRunning={syncRunning}
        onSync={triggerSync}
        onSettings={() => setSettingsOpen(true)}
      />

      <AddSongForm playlists={playlists} onAdd={addSong} />
      <FilterBar
        playlists={playlists}
        activePlaylist={activePlaylist}
        search={search}
        onPlaylistChange={setActivePlaylist}
        onSearchChange={setSearch}
      />

      <main className="flex-1">
        <SongList
          songs={songs}
          activePlaylist={activePlaylist}
          search={search}
          onDelete={removeSong}
          onDownloaded={refetch}
        />
      </main>

      <TikTokDownload />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onHistoryCleared={refetch}
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify dev server compiles without errors**

```bash
cd web && npm run dev
```

Open `http://localhost:5173` — should show the auth screen (access code input).

- [ ] **Step 3: Smoke test the full flow**

With `uvicorn` running on port 8000:
1. Create `.env` from `.env.example` with a real `ACCESS_CODE`
2. Open `http://localhost:5173`
3. Enter the access code — should advance to device name screen
4. Enter "Test Device" — should show the main app
5. Add a YouTube URL — should appear in the list

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat: App orchestration — auth gate, device registration, main layout wired"
```

---

## Task 17: Docker Production Build + Verification

**Files:**
- Verify: `Dockerfile`
- Verify: `docker-compose.yml`

- [ ] **Step 1: Build the Docker image**

```bash
docker compose build
```

Expected: build completes without errors. React is built in Stage 1, copied to Python image in Stage 2.

- [ ] **Step 2: Start the container**

```bash
cp .env.example .env
# Edit .env with your real ACCESS_CODE
docker compose up
```

- [ ] **Step 3: Verify the app loads**

```bash
curl -s http://localhost:8000/ | head -5
```

Expected: `<!doctype html>` — React `index.html` is being served.

- [ ] **Step 4: Verify API works through same port**

```bash
curl -s -X POST http://localhost:8000/api/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"code": "changeme"}' | python3 -m json.tool
```

Expected: `{"ok": true}` (if ACCESS_CODE=changeme in .env)

- [ ] **Step 5: Test Ngrok access**

```bash
ngrok http 8000
```

Copy the Ngrok URL. Open it on your iPhone in the Documents app browser. Should see the auth screen.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "chore: verify Docker production build and Ngrok setup"
```

---

## Self-Review Against Spec

**Spec coverage check:**

| Spec Section | Task(s) | Status |
|---|---|---|
| FastAPI backend + React frontend | Tasks 1-9, 10-16 | Covered |
| Docker single container | Task 1, 17 | Covered |
| songs.json store | Task 2 | Covered |
| Per-device UUID tracking | Tasks 4, 11 | Covered |
| Device naming on first visit | Tasks 4, 12 | Covered |
| Access code auth | Task 3 | Covered |
| YouTube API v3 playlist sync | Task 6, 8 | Covered |
| SoundCloud yt-dlp extraction | Task 7, 8 | Covered |
| TikTok on-demand (not saved) | Tasks 8, 15 | Covered |
| MP3 320kbps re-encode | Task 7 | Covered |
| nooverwrites | Task 7 | Covered |
| File cached on disk, served to all | Task 8 | Covered |
| Download history clear | Tasks 4, 15 | Covered |
| Dark theme, Geist font, Tailwind v4 | Task 10 | Covered |
| Phosphor icons | Tasks 13-15 | Covered |
| PWA manifest + icons | Tasks 10 | Covered |
| Header with sync badge | Task 13 | Covered |
| Filter bar + search | Task 14 | Covered |
| Settings sheet | Task 15 | Covered |
| Ngrok + static file serving | Tasks 9, 17 | Covered |

**No gaps found.**
