# Device Name Identity & iOS Download Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make device identity name-based (same name → same download history across browsers) and fix downloads on iOS Safari and all browsers.

**Architecture:** Two independent tasks. Task 1 is a backend-only TDD change to `devices.py`; Task 2 is a two-line frontend change to `api.ts` and `SongRow.tsx`. They do not depend on each other.

**Tech Stack:** FastAPI, Python 3.12, pytest, Docker Compose (backend); React 19, TypeScript strict, Vite (frontend)

## Global Constraints

- Backend tests run inside Docker: `docker compose build --quiet && docker compose run --rm app python -m pytest tests/ -v`
- TypeScript strict mode (`noUnusedLocals`, `noUnusedParameters`) — zero errors required
- No new dependencies
- Do not change any file not listed in the task's **Files** section

---

### Task 1: Device Name Identity (Backend)

**Files:**
- Modify: `api/routers/devices.py`
- Modify: `api/tests/test_devices.py`

**Interfaces:**
- Produces: `dedup_devices(data: SongsFile) -> None` — used internally by `register_device`
- Produces: `POST /api/devices/register` — returns `{"id": str, "name": str}` with status 201 (new) or 200 (found)

**Context — current `api/routers/devices.py`:**
```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from config import Settings, get_settings
from models import Device
from store import read_songs, write_songs
from routers.auth import get_device_id

router = APIRouter(prefix="/api/devices", tags=["devices"])

class RegisterBody(BaseModel):
    name: str

class RenameBody(BaseModel):
    name: str

@router.post("/register", status_code=201)
async def register_device(body: RegisterBody, settings: Settings = Depends(get_settings)):
    data = read_songs(settings.data_dir)
    device = Device(name=body.name)
    data.devices.append(device)
    write_songs(data, settings.data_dir)
    return {"id": device.id, "name": device.name}
```

**Context — current `api/tests/test_devices.py`:**
The file already has a `client` fixture and 6 passing tests. Add new tests at the bottom of the file. Do not remove or modify existing tests.

The `client` fixture in that file:
```python
@pytest.fixture
def client(monkeypatch, data_dir):
    monkeypatch.setenv("ACCESS_CODE", "x")
    monkeypatch.setenv("DATA_DIR", data_dir)
    from config import get_settings
    get_settings.cache_clear()
    from main import app
    return TestClient(app)
```

The `data_dir` fixture comes from `api/tests/conftest.py`:
```python
@pytest.fixture
def data_dir(tmp_path: Path) -> str:
    d = tmp_path / "data"
    d.mkdir()
    return str(d)
```

- [ ] **Step 1: Write failing tests**

Append these 5 tests to `api/tests/test_devices.py`:

```python
def test_register_returns_existing_device_for_same_name(client):
    res1 = client.post("/api/devices/register", json={"name": "My Phone"})
    res2 = client.post("/api/devices/register", json={"name": "My Phone"})
    assert res1.json()["id"] == res2.json()["id"]


def test_register_case_insensitive(client):
    res1 = client.post("/api/devices/register", json={"name": "My Phone"})
    res2 = client.post("/api/devices/register", json={"name": "my phone"})
    assert res1.json()["id"] == res2.json()["id"]


def test_register_trims_whitespace(client):
    res1 = client.post("/api/devices/register", json={"name": " My Phone "})
    res2 = client.post("/api/devices/register", json={"name": "My Phone"})
    assert res1.json()["id"] == res2.json()["id"]


def test_register_creates_new_for_different_name(client):
    res1 = client.post("/api/devices/register", json={"name": "My Phone"})
    res2 = client.post("/api/devices/register", json={"name": "Other Device"})
    assert res1.json()["id"] != res2.json()["id"]


def test_dedup_devices_removes_duplicates(client, data_dir):
    from store import read_songs, write_songs
    from models import SongsFile, Device
    d1 = Device(name="TTN iPhone")
    d2 = Device(name="TTN iPhone")
    write_songs(SongsFile(songs=[], playlists=[], devices=[d1, d2]), data_dir)
    # Trigger register with same name — dedup runs inside register
    client.post("/api/devices/register", json={"name": "TTN iPhone"})
    data = read_songs(data_dir)
    iphone_devices = [d for d in data.devices if d.name.strip().lower() == "ttn iphone"]
    assert len(iphone_devices) == 1
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
docker compose build --quiet && docker compose run --rm app python -m pytest tests/test_devices.py::test_register_returns_existing_device_for_same_name tests/test_devices.py::test_register_case_insensitive tests/test_devices.py::test_register_trims_whitespace tests/test_devices.py::test_register_creates_new_for_different_name tests/test_devices.py::test_dedup_devices_removes_duplicates -v
```

Expected: all 5 FAIL (currently `register` always creates a new device).

- [ ] **Step 3: Implement `dedup_devices` and update `register_device`**

Replace the full content of `api/routers/devices.py` with:

```python
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from config import Settings, get_settings
from models import Device, SongsFile
from store import read_songs, write_songs
from routers.auth import get_device_id

router = APIRouter(prefix="/api/devices", tags=["devices"])


class RegisterBody(BaseModel):
    name: str


class RenameBody(BaseModel):
    name: str


def dedup_devices(data: SongsFile) -> None:
    seen: dict[str, bool] = {}
    kept = []
    for device in data.devices:
        key = device.name.strip().lower()
        if key not in seen:
            seen[key] = True
            kept.append(device)
    data.devices = kept


@router.post("/register", status_code=201)
async def register_device(body: RegisterBody, settings: Settings = Depends(get_settings)):
    data = read_songs(settings.data_dir)
    dedup_devices(data)
    normalized = body.name.strip().lower()
    existing = next((d for d in data.devices if d.name.strip().lower() == normalized), None)
    if existing:
        existing.last_seen = datetime.utcnow()
        write_songs(data, settings.data_dir)
        return JSONResponse(status_code=200, content={"id": existing.id, "name": existing.name})
    device = Device(name=body.name.strip())
    data.devices.append(device)
    write_songs(data, settings.data_dir)
    return {"id": device.id, "name": device.name}


@router.patch("/{device_id}")
async def rename_device(
    device_id: str,
    body: RenameBody,
    caller_id: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    if caller_id != device_id:
        raise HTTPException(status_code=403, detail="Cannot rename another device")
    data = read_songs(settings.data_dir)
    device = next((d for d in data.devices if d.id == device_id), None)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    device.name = body.name.strip()
    write_songs(data, settings.data_dir)
    return {"id": device_id, "name": device.name}


@router.delete("/{device_id}/history")
async def clear_history(
    device_id: str,
    caller_id: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    if caller_id != device_id:
        raise HTTPException(status_code=403, detail="Cannot clear another device's history")
    data = read_songs(settings.data_dir)
    for song in data.songs:
        if device_id in song.device_downloads:
            song.device_downloads[device_id].downloaded = False
            song.device_downloads[device_id].downloaded_at = None
    write_songs(data, settings.data_dir)
    return {"ok": True}
```

- [ ] **Step 4: Run all device tests**

```bash
docker compose build --quiet && docker compose run --rm app python -m pytest tests/test_devices.py -v
```

Expected output — all 11 tests PASS:
```
tests/test_devices.py::test_register_device PASSED
tests/test_devices.py::test_register_persists_to_file PASSED
tests/test_devices.py::test_rename_device PASSED
tests/test_devices.py::test_rename_device_forbidden PASSED
tests/test_devices.py::test_rename_device_not_found PASSED
tests/test_devices.py::test_clear_history PASSED
tests/test_devices.py::test_register_returns_existing_device_for_same_name PASSED
tests/test_devices.py::test_register_case_insensitive PASSED
tests/test_devices.py::test_register_trims_whitespace PASSED
tests/test_devices.py::test_register_creates_new_for_different_name PASSED
tests/test_devices.py::test_dedup_devices_removes_duplicates PASSED
```

- [ ] **Step 5: Run full test suite**

```bash
docker compose run --rm app python -m pytest tests/ -v
```

Expected: all tests pass (no regressions in other routers).

- [ ] **Step 6: Commit**

```bash
git add api/routers/devices.py api/tests/test_devices.py
git commit -m "feat: device name identity — find-or-create by name, dedup on register"
```

---

### Task 2: Direct URL Downloads (Frontend)

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/components/SongRow.tsx`

**Interfaces:**
- `download.file()` return type changes from `Promise<void>` to `void`
- `handleDownload()` in SongRow removes `await` from `api.download.file()` call

**Context — current `download.file()` in `web/src/lib/api.ts` (lines 75-93):**
```ts
file: async (songId: string): Promise<void> => {
  const device = getDevice()
  const res = await fetch(`/api/download/${songId}?device_id=${device?.id ?? ''}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? `Download failed (${res.status})`)
  }
  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') ?? ''
  const filename = disposition.match(/filename="(.+?)"/)?.[1] ?? `${songId}.mp3`
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(objectUrl)
},
```

**Context — current `handleDownload()` in `web/src/components/SongRow.tsx` (lines 52-64):**
```ts
async function handleDownload() {
  setDownloading(true)
  try {
    await api.download.prepare(song.id)
    await api.download.file(song.id)
    setLocalDownloaded(true)
    onDownloaded()
  } catch (e) {
    onError(e instanceof Error ? e.message : 'Download failed')
  } finally {
    setDownloading(false)
  }
}
```

- [ ] **Step 1: Replace `download.file()` in `web/src/lib/api.ts`**

Find and replace the entire `file:` property (lines 75-93). The new implementation:

```ts
file: (songId: string): void => {
  const device = getDevice()
  const url = `/api/download/${songId}?device_id=${device?.id ?? ''}`
  const a = document.createElement('a')
  a.href = url
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
},
```

- [ ] **Step 2: Update `handleDownload()` in `web/src/components/SongRow.tsx`**

Remove `await` from the `api.download.file(song.id)` call:

```ts
async function handleDownload() {
  setDownloading(true)
  try {
    await api.download.prepare(song.id)
    api.download.file(song.id)
    setLocalDownloaded(true)
    onDownloaded()
  } catch (e) {
    onError(e instanceof Error ? e.message : 'Download failed')
  } finally {
    setDownloading(false)
  }
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd /home/ttndev/workspace/personal/music-assistant/web && npx tsc --noEmit
```

Expected: zero errors. If there are errors mentioning `await` on a non-Promise value or unused variables, fix them before continuing.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/api.ts web/src/components/SongRow.tsx
git commit -m "fix: direct URL downloads — fixes iOS Safari broken file, works across all browsers"
```

- [ ] **Step 5: Build and deploy**

```bash
docker compose build --quiet && docker compose up -d
```

- [ ] **Step 6: Ask user to verify**

No automated tests for this task. Ask the user to:
1. Open the app in **Chrome on a laptop** → click Download on any song → confirm file downloads with correct filename
2. Open the app in **Firefox on a laptop** → same check
3. Open the app on **iPhone Safari** → click Download → confirm file downloads with correct filename and can be played
4. (Optional) iPad or Android if available

If any browser fails, report the symptom so the fix can be refined.
