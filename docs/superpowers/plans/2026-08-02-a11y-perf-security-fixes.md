# A11y/Perf/Security Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 9 findings from the 2026-08-02 web-quality audit: 4 frontend accessibility/performance issues in `web/` and 5 backend security issues in `api/`, per `docs/superpowers/specs/2026-08-02-a11y-perf-security-fixes-design.md`.

**Architecture:** Ten independent, mostly-sequential tasks. Tasks 1-4 touch separate frontend files with no shared code path. Tasks 5, 6, 8 all edit `api/routers/auth.py` and must land in that order (each task's diff assumes the previous task's changes are already in place). Task 7 (frontend ticket wiring) depends on Task 6's backend contract existing. Tasks 9-10 are fully independent of everything else.

**Tech Stack:** React 19 + TypeScript + Vite 6 + Tailwind CSS 4 (`web/`); Python 3.12 + FastAPI + pytest (`api/`).

## Global Constraints

- `web/` has no automated test tooling configured (no vitest/jest/playwright in `package.json`) — frontend tasks (1-4, 7) are verified by manual dev-server QA, not automated tests.
- Run backend tests from the `api/` directory using the existing venv: `cd api && .venv/bin/python -m pytest tests/<file>.py::<test> -v`.
- No new dependencies for any task — native `<dialog>`, stdlib `hmac`/`secrets`, plain CSS. No Redis or other external store for rate-limit/ticket state (single uvicorn process per `Dockerfile`'s `CMD`, no `--workers` flag).
- `RegisterBody.ticket` becomes a required field in Task 6. Every existing call to `POST /api/devices/register` in `api/tests/test_devices.py` (16 call sites) must be updated in that same task to pass a valid ticket obtained via `POST /api/auth/verify`.
- Module-level in-memory dicts added to `api/routers/auth.py` (`_pending_tickets` in Task 6, `_attempts` in Task 8) persist for the lifetime of the test process and must be cleared between tests via an autouse fixture in `api/tests/conftest.py`, added in Task 6 and extended in Task 8. Without this, tests become order-dependent and flaky (Starlette's `TestClient` always reports the same synthetic client IP, `"testclient"`, so rate-limit/ticket state leaks across tests sharing that key).
- No changes to `Song`, `SongsFile`, `Device`, or any response shape not explicitly listed in a task below.

---

## Task 1: SettingsSheet native `<dialog>` semantics

**Files:**
- Modify: `web/src/components/SettingsSheet.tsx`
- Modify: `web/src/styles/globals.css`

**Interfaces:**
- No exported signatures change. `SettingsSheet`'s props (`open`, `onClose`, `onHistoryCleared`, `onUnregistered`) are unchanged.

- [ ] **Step 1: Add the backdrop CSS rule**

In `web/src/styles/globals.css`, add after the existing `body { ... }` block:

```css
dialog.settings-dialog::backdrop {
  background-color: rgb(0 0 0 / 0.6);
}
```

- [ ] **Step 2: Replace the outer wrapper with `<dialog>`**

In `web/src/components/SettingsSheet.tsx`, change the import line to add `useRef`:

```tsx
import { useState, useEffect, useRef } from 'react'
```

Add a ref and an effect right after the existing state declarations (after the `renaming` state line, before the existing `useEffect` that resets fields on close):

```tsx
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
```

Delete this line entirely (it's incompatible with the imperative `showModal()`/`close()` pattern — the dialog must stay mounted so the ref persists across toggles):

```tsx
  if (!open) return null
```

Replace the return statement's outer markup:

```tsx
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-[var(--color-surface)] h-full overflow-y-auto shadow-2xl">
```

with:

```tsx
  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={e => { if (e.target === dialogRef.current) onClose() }}
      className="settings-dialog fixed inset-0 z-50 m-0 flex h-full max-h-none w-full max-w-none justify-end border-0 bg-transparent p-0"
    >
      <div className="relative w-full max-w-sm bg-[var(--color-surface)] h-full overflow-y-auto shadow-2xl">
```

And close the two new wrapping tags by changing the final lines from:

```tsx
        </div>
      </div>
    </div>
  )
}
```

to:

```tsx
        </div>
      </div>
    </dialog>
  )
}
```

- [ ] **Step 3: Manual verification**

Run the dev server:

```bash
cd web && npm run dev
```

Open the app in a browser, log in, click the gear icon to open Settings. Verify all of the following:
1. Tab through the panel's controls — focus never leaves the dialog (it should cycle back to the first control after the last, e.g. the X close button).
2. Press `Escape` — the panel closes and focus returns to the gear icon button.
3. Click in the dark area to the left of the panel (the backdrop) — the panel closes.
4. Click the X button — the panel closes (unchanged from before).
5. Visually confirm the backdrop still dims the background and the panel still slides in from the right, same as before this change.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/SettingsSheet.tsx web/src/styles/globals.css
git commit -m "fix: give SettingsSheet native dialog semantics (focus trap, Escape, aria-modal)"
```

---

## Task 2: FilterBar tooltip focus/touch support

**Files:**
- Modify: `web/src/components/FilterBar.tsx`

**Interfaces:**
- No exported signatures change. `FilterBar`'s props are unchanged.

- [ ] **Step 1: Replace the tooltip state and add show/hide helpers**

In `web/src/components/FilterBar.tsx`, change:

```tsx
  const [tooltipInfo, setTooltipInfo] = useState<{ label: string; x: number; y: number } | null>(null)
```

to:

```tsx
  const [tooltipInfo, setTooltipInfo] = useState<{ label: string; x: number; y: number; forPlaylist: string } | null>(null)

  function showTooltip(pl: string, label: string, target: HTMLElement) {
    const rect = target.getBoundingClientRect()
    setTooltipInfo({ label, x: rect.left + rect.width / 2, y: rect.top, forPlaylist: pl })
  }

  function hideTooltip() {
    setTooltipInfo(null)
  }
```

- [ ] **Step 2: Wire focus/blur handlers and `aria-describedby` on the playlist buttons**

Change:

```tsx
              <button
                key={pl}
                onClick={() => onPlaylistChange(pl)}
                onMouseEnter={platformLabel ? (e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setTooltipInfo({ label: platformLabel, x: rect.left + rect.width / 2, y: rect.top })
                } : undefined}
                onMouseLeave={platformLabel ? () => setTooltipInfo(null) : undefined}
                className={clsx(
```

to:

```tsx
              <button
                key={pl}
                onClick={() => onPlaylistChange(pl)}
                onMouseEnter={platformLabel ? (e) => showTooltip(pl, platformLabel, e.currentTarget) : undefined}
                onMouseLeave={platformLabel ? hideTooltip : undefined}
                onFocus={platformLabel ? (e) => showTooltip(pl, platformLabel, e.currentTarget) : undefined}
                onBlur={platformLabel ? hideTooltip : undefined}
                aria-describedby={tooltipInfo?.forPlaylist === pl ? 'playlist-source-tooltip' : undefined}
                className={clsx(
```

- [ ] **Step 3: Add `id`/`role` to the tooltip element**

Change:

```tsx
      {tooltipInfo && (
        <div
          className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full px-2 py-1 rounded text-[10px] bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] whitespace-nowrap"
          style={{ left: tooltipInfo.x, top: tooltipInfo.y - 6 }}
        >
```

to:

```tsx
      {tooltipInfo && (
        <div
          id="playlist-source-tooltip"
          role="tooltip"
          className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full px-2 py-1 rounded text-[10px] bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] whitespace-nowrap"
          style={{ left: tooltipInfo.x, top: tooltipInfo.y - 6 }}
        >
```

- [ ] **Step 4: Manual verification**

```bash
cd web && npm run dev
```

Tab through the playlist pills row until reaching one that has a platform source (any non-"All"/non-TikTok playlist synced from YouTube or SoundCloud). Verify the tooltip appears on focus and disappears on blur. Verify mouse hover still works as before. If you have a screen reader available, confirm the tooltip text is announced when the pill receives focus.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/FilterBar.tsx
git commit -m "fix: make FilterBar playlist tooltip reachable by keyboard and touch"
```

---

## Task 3: useSongs pause-on-hidden polling

**Files:**
- Modify: `web/src/hooks/useSongs.ts`

**Interfaces:**
- No exported signatures change. `useSongs(enabled)`'s return shape is unchanged.

- [ ] **Step 1: Add `useRef` to the import**

Change:

```ts
import { useState, useEffect, useCallback } from 'react'
```

to:

```ts
import { useState, useEffect, useCallback, useRef } from 'react'
```

- [ ] **Step 2: Replace the polling effect**

Change:

```ts
  useEffect(() => {
    if (!enabled) return
    fetch()
    const id = setInterval(fetch, 10_000)
    return () => clearInterval(id)
  }, [fetch, enabled])
```

to:

```ts
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!enabled) return

    function startPolling() {
      if (intervalRef.current) return
      intervalRef.current = setInterval(fetch, 10_000)
    }

    function stopPolling() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        stopPolling()
      } else {
        fetch()
        startPolling()
      }
    }

    fetch()
    startPolling()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [fetch, enabled])
```

Note: `intervalRef` must be declared with `useRef` at the top level of the hook (not inside the effect) so its identity persists across effect re-runs; place the `const intervalRef = ...` line immediately before this `useEffect`.

- [ ] **Step 3: Manual verification**

```bash
cd web && npm run dev
```

Open the app, open browser devtools → Network tab, filter for `songs`. Confirm a request fires every ~10s while the tab is visible (unchanged baseline). Switch to a different browser tab (or minimize the window) for 15+ seconds, confirm no `songs` requests fire while hidden. Switch back — confirm one immediate request fires right away, then polling resumes at the normal 10s cadence.

- [ ] **Step 4: Commit**

```bash
git add web/src/hooks/useSongs.ts
git commit -m "perf: pause useSongs polling while the tab is hidden"
```

---

## Task 4: index.html meta description

**Files:**
- Modify: `web/index.html`

- [ ] **Step 1: Add the meta tag**

In `web/index.html`, change:

```html
    <link rel="apple-touch-icon" href="/icons/icon-192.png" />
    <title>Music Assistant</title>
```

to:

```html
    <link rel="apple-touch-icon" href="/icons/icon-192.png" />
    <meta name="description" content="Personal music downloader for YouTube, SoundCloud, and TikTok playlists." />
    <title>Music Assistant</title>
```

- [ ] **Step 2: Verify**

```bash
cd web && npm run build
```

Confirm the build succeeds (this is a static HTML change, no runtime behavior to test).

- [ ] **Step 3: Commit**

```bash
git add web/index.html
git commit -m "chore: add meta description to index.html"
```

---

## Task 5: Timing-safe access-code comparison

**Files:**
- Modify: `api/routers/auth.py`
- Test: `api/tests/test_auth.py` (no new tests — existing tests guard this)

**Interfaces:**
- No signature changes. `POST /api/auth/verify` request/response shape unchanged (ticket comes in Task 6).

- [ ] **Step 1: Confirm the baseline passes**

```bash
cd api && .venv/bin/python -m pytest tests/test_auth.py -v
```

Expected: `test_verify_correct_code` and `test_verify_wrong_code` both PASS.

- [ ] **Step 2: Replace the comparison**

In `api/routers/auth.py`, change:

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
```

to:

```python
import hmac
from fastapi import APIRouter, Depends, HTTPException, Header
from config import Settings, get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/verify")
async def verify(
    body: dict,
    settings: Settings = Depends(get_settings),
):
    code = body.get("code", "")
    if not hmac.compare_digest(code, settings.access_code):
        raise HTTPException(status_code=401, detail="Invalid access code")
    return {"ok": True}
```

(The `get_device_id` function below stays untouched.)

- [ ] **Step 3: Run tests to verify no regression**

```bash
cd api && .venv/bin/python -m pytest tests/test_auth.py -v
```

Expected: same two tests still PASS — behavior on both the correct and incorrect code path is identical, only the timing characteristic changed.

- [ ] **Step 4: Commit**

```bash
git add api/routers/auth.py
git commit -m "security: use constant-time comparison for access code"
```

---

## Task 6: Registration ticket (close the unenforced-access-code gap)

**Files:**
- Modify: `api/routers/auth.py`
- Modify: `api/routers/devices.py`
- Modify: `api/tests/conftest.py`
- Modify: `api/tests/test_auth.py`
- Modify: `api/tests/test_devices.py`

**Interfaces:**
- Produces (consumed by Task 7's frontend work and by Task 8):
  - `routers.auth.issue_ticket() -> str`
  - `routers.auth.consume_ticket(ticket: str) -> bool`
  - `routers.auth._pending_tickets: dict[str, datetime]` (module-level store)
  - `POST /api/auth/verify` response gains `"ticket": str`, e.g. `{"ok": true, "ticket": "..."}`
  - `POST /api/devices/register` request body gains required `"ticket": str` field; returns `401` if missing/invalid/expired/reused.

- [ ] **Step 1: Write the failing tests**

In `api/tests/test_auth.py`, replace the whole file with:

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
    body = res.json()
    assert body["ok"] is True
    assert isinstance(body["ticket"], str)
    assert len(body["ticket"]) > 20


def test_verify_wrong_code(client):
    res = client.post("/api/auth/verify", json={"code": "wrong"})
    assert res.status_code == 401


def test_protected_route_requires_device_id(client):
    from fastapi import Depends
    from routers.auth import get_device_id
    from main import app

    @app.get("/api/test-device-gate")
    async def _gate(_: str = Depends(get_device_id)):
        return {"ok": True}

    res = client.get("/api/test-device-gate")
    assert res.status_code == 422


def test_ticket_is_single_use():
    from routers.auth import consume_ticket, issue_ticket
    ticket = issue_ticket()
    assert consume_ticket(ticket) is True
    assert consume_ticket(ticket) is False


def test_consume_unknown_ticket_returns_false():
    from routers.auth import consume_ticket
    assert consume_ticket("not-a-real-ticket") is False
```

In `api/tests/conftest.py`, add an autouse fixture that resets the new module-level ticket store between tests (replace the whole file):

```python
import pytest
from pathlib import Path


@pytest.fixture
def data_dir(tmp_path: Path) -> str:
    d = tmp_path / "data"
    d.mkdir()
    return str(d)


@pytest.fixture(autouse=True)
def _reset_auth_module_state():
    from routers.auth import _pending_tickets
    _pending_tickets.clear()
    yield
    _pending_tickets.clear()
```

In `api/tests/test_devices.py`, replace the whole file with:

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


@pytest.fixture
def get_ticket(client):
    def _get_ticket():
        res = client.post("/api/auth/verify", json={"code": "x"})
        return res.json()["ticket"]
    return _get_ticket


def test_register_device(client, get_ticket):
    res = client.post("/api/devices/register", json={"name": "iPhone Main", "ticket": get_ticket()})
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "iPhone Main"
    assert "id" in body


def test_register_persists_to_file(client, data_dir, get_ticket):
    client.post("/api/devices/register", json={"name": "Laptop", "ticket": get_ticket()})
    from store import read_songs
    data = read_songs(data_dir)
    assert any(d.name == "Laptop" for d in data.devices)


def test_rename_device(client, data_dir, get_ticket):
    reg = client.post("/api/devices/register", json={"name": "Old Name", "ticket": get_ticket()})
    dev_id = reg.json()["id"]
    res = client.patch(f"/api/devices/{dev_id}", json={"name": "New Name"},
                       headers={"X-Device-ID": dev_id})
    assert res.status_code == 200
    assert res.json()["name"] == "New Name"
    from store import read_songs
    data = read_songs(data_dir)
    assert any(d.name == "New Name" for d in data.devices)


def test_rename_device_forbidden(client, get_ticket):
    reg = client.post("/api/devices/register", json={"name": "Device A", "ticket": get_ticket()})
    dev_id = reg.json()["id"]
    res = client.patch(f"/api/devices/{dev_id}", json={"name": "Hacked"},
                       headers={"X-Device-ID": "some-other-device"})
    assert res.status_code == 403


def test_rename_device_not_found(client, get_ticket):
    client.post("/api/devices/register", json={"name": "Device", "ticket": get_ticket()})
    res = client.patch("/api/devices/nonexistent-id", json={"name": "X"},
                       headers={"X-Device-ID": "nonexistent-id"})
    assert res.status_code == 404


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


def test_register_returns_existing_device_for_same_name(client, get_ticket):
    res1 = client.post("/api/devices/register", json={"name": "My Phone", "ticket": get_ticket()})
    res2 = client.post("/api/devices/register", json={"name": "My Phone", "ticket": get_ticket()})
    assert res1.status_code == 201
    assert res2.status_code == 200
    assert res1.json()["id"] == res2.json()["id"]


def test_register_case_insensitive(client, get_ticket):
    res1 = client.post("/api/devices/register", json={"name": "My Phone", "ticket": get_ticket()})
    res2 = client.post("/api/devices/register", json={"name": "my phone", "ticket": get_ticket()})
    assert res1.status_code == 201
    assert res2.status_code == 200
    assert res1.json()["id"] == res2.json()["id"]


def test_register_trims_whitespace(client, get_ticket):
    res1 = client.post("/api/devices/register", json={"name": " My Phone ", "ticket": get_ticket()})
    res2 = client.post("/api/devices/register", json={"name": "My Phone", "ticket": get_ticket()})
    assert res1.status_code == 201
    assert res2.status_code == 200
    assert res1.json()["id"] == res2.json()["id"]


def test_register_creates_new_for_different_name(client, get_ticket):
    res1 = client.post("/api/devices/register", json={"name": "My Phone", "ticket": get_ticket()})
    res2 = client.post("/api/devices/register", json={"name": "Other Device", "ticket": get_ticket()})
    assert res1.status_code == 201
    assert res2.status_code == 201
    assert res1.json()["id"] != res2.json()["id"]


def test_dedup_devices_removes_duplicates(client, data_dir, get_ticket):
    from store import read_songs, write_songs
    from models import SongsFile, Device
    d1 = Device(name="TTN iPhone")
    d2 = Device(name="TTN iPhone")
    write_songs(SongsFile(songs=[], playlists=[], devices=[d1, d2]), data_dir)
    # Trigger register with same name — dedup runs inside register
    client.post("/api/devices/register", json={"name": "TTN iPhone", "ticket": get_ticket()})
    data = read_songs(data_dir)
    iphone_devices = [d for d in data.devices if d.name.strip().lower() == "ttn iphone"]
    assert len(iphone_devices) == 1


def test_unregister_device(client, data_dir, get_ticket):
    reg = client.post("/api/devices/register", json={"name": "To Remove", "ticket": get_ticket()})
    dev_id = reg.json()["id"]
    res = client.delete(f"/api/devices/{dev_id}", headers={"X-Device-ID": dev_id})
    assert res.status_code == 200
    from store import read_songs
    data = read_songs(data_dir)
    assert all(d.id != dev_id for d in data.devices)


def test_unregister_device_forbidden(client, get_ticket):
    reg = client.post("/api/devices/register", json={"name": "Device A", "ticket": get_ticket()})
    dev_id = reg.json()["id"]
    res = client.delete(f"/api/devices/{dev_id}", headers={"X-Device-ID": "some-other-device"})
    assert res.status_code == 403


def test_unregister_device_not_found(client):
    res = client.delete("/api/devices/nonexistent-id", headers={"X-Device-ID": "nonexistent-id"})
    assert res.status_code == 404


def test_unregister_device_removes_its_device_downloads_entries(client, data_dir):
    from store import read_songs, write_songs
    from models import SongsFile, Song, DeviceDownload, Device
    dev_id = "dev-to-remove"
    song = Song(title="T", url="https://youtube.com/watch?v=x", platform="youtube",
                device_downloads={dev_id: DeviceDownload(name="Old Phone", downloaded=True, ignored=True)})
    device = Device(id=dev_id, name="Old Phone")
    write_songs(SongsFile(songs=[song], playlists=[], devices=[device]), data_dir)

    res = client.delete(f"/api/devices/{dev_id}", headers={"X-Device-ID": dev_id})
    assert res.status_code == 200
    data = read_songs(data_dir)
    assert dev_id not in data.songs[0].device_downloads


def test_register_requires_ticket(client):
    res = client.post("/api/devices/register", json={"name": "No Ticket"})
    assert res.status_code == 422


def test_register_rejects_invalid_ticket(client):
    res = client.post("/api/devices/register", json={"name": "Bad Ticket", "ticket": "not-a-real-ticket"})
    assert res.status_code == 401


def test_register_rejects_reused_ticket(client, get_ticket):
    ticket = get_ticket()
    res1 = client.post("/api/devices/register", json={"name": "First", "ticket": ticket})
    assert res1.status_code == 201
    res2 = client.post("/api/devices/register", json={"name": "Second", "ticket": ticket})
    assert res2.status_code == 401
```

- [ ] **Step 2: Run the new/updated tests to verify they fail**

```bash
cd api && .venv/bin/python -m pytest tests/test_auth.py tests/test_devices.py -v
```

Expected: FAIL — `test_verify_correct_code` fails on the `ticket` key (KeyError), `test_ticket_is_single_use`/`test_consume_unknown_ticket_returns_false` fail with `ImportError: cannot import name 'issue_ticket'`, and every `test_devices.py` test using `get_ticket` fails since the fixture calls `/api/auth/verify` expecting a `ticket` key that doesn't exist yet.

- [ ] **Step 3: Implement the ticket issuance in auth.py**

Replace `api/routers/auth.py` with:

```python
import hmac
import secrets
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Header
from config import Settings, get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

_TICKET_TTL = timedelta(minutes=5)
_pending_tickets: dict[str, datetime] = {}


def issue_ticket() -> str:
    ticket = secrets.token_urlsafe(24)
    _pending_tickets[ticket] = datetime.utcnow() + _TICKET_TTL
    return ticket


def consume_ticket(ticket: str) -> bool:
    expires_at = _pending_tickets.pop(ticket, None)
    if expires_at is None:
        return False
    return datetime.utcnow() < expires_at


@router.post("/verify")
async def verify(
    body: dict,
    settings: Settings = Depends(get_settings),
):
    code = body.get("code", "")
    if not hmac.compare_digest(code, settings.access_code):
        raise HTTPException(status_code=401, detail="Invalid access code")
    return {"ok": True, "ticket": issue_ticket()}


# Reusable dependency for all protected routes
async def get_device_id(x_device_id: str = Header(..., alias="X-Device-ID")) -> str:
    return x_device_id
```

- [ ] **Step 4: Implement ticket consumption in devices.py**

In `api/routers/devices.py`, change:

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
```

to:

```python
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from config import Settings, get_settings
from models import Device, SongsFile
from store import read_songs, write_songs
from routers.auth import get_device_id, consume_ticket

router = APIRouter(prefix="/api/devices", tags=["devices"])


class RegisterBody(BaseModel):
    name: str
    ticket: str
```

Then change:

```python
@router.post("/register", status_code=201)
async def register_device(body: RegisterBody, settings: Settings = Depends(get_settings)):
    data = read_songs(settings.data_dir)
```

to:

```python
@router.post("/register", status_code=201)
async def register_device(body: RegisterBody, settings: Settings = Depends(get_settings)):
    if not consume_ticket(body.ticket):
        raise HTTPException(status_code=401, detail="Invalid or expired ticket")
    data = read_songs(settings.data_dir)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd api && .venv/bin/python -m pytest tests/test_auth.py tests/test_devices.py -v
```

Expected: all tests PASS.

- [ ] **Step 6: Run the full backend suite to check for collateral breakage**

```bash
cd api && .venv/bin/python -m pytest -v
```

Expected: all tests PASS (no other test file calls `/api/devices/register`, confirmed by `grep -rn "devices/register" api/tests/` returning only `test_devices.py` hits).

- [ ] **Step 7: Commit**

```bash
git add api/routers/auth.py api/routers/devices.py api/tests/conftest.py api/tests/test_auth.py api/tests/test_devices.py
git commit -m "security: require a verify-issued ticket to register a device"
```

---

## Task 7: Frontend — thread the registration ticket through

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/hooks/useDevice.ts`
- Modify: `web/src/components/AuthScreen.tsx`
- Modify: `web/src/components/DeviceNameScreen.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: Task 6's `POST /api/auth/verify` → `{ ok: boolean; ticket: string }` and `POST /api/devices/register` now requiring `ticket`.
- Produces: `api.auth.verify` returns `{ ok: boolean; ticket: string }`; `api.devices.register(name, ticket)`; `useDevice().register(name, ticket)`; `AuthScreen`'s `onVerified: (ticket: string) => void`; `DeviceNameScreen`'s new `ticket: string` prop.

- [ ] **Step 1: Update api.ts**

In `web/src/lib/api.ts`, change:

```ts
  auth: {
    verify: (code: string) => req<{ ok: boolean }>('POST', '/api/auth/verify', { code }),
  },
  devices: {
    register: (name: string) => req<{ id: string; name: string }>('POST', '/api/devices/register', { name }),
```

to:

```ts
  auth: {
    verify: (code: string) => req<{ ok: boolean; ticket: string }>('POST', '/api/auth/verify', { code }),
  },
  devices: {
    register: (name: string, ticket: string) => req<{ id: string; name: string }>('POST', '/api/devices/register', { name, ticket }),
```

- [ ] **Step 2: Update useDevice.ts**

In `web/src/hooks/useDevice.ts`, change:

```ts
  const register = useCallback(async (name: string) => {
    const result = await api.devices.register(name)
    storeDevice(result.id, result.name)
    setDeviceState({ id: result.id, name: result.name })
    return result
  }, [])
```

to:

```ts
  const register = useCallback(async (name: string, ticket: string) => {
    const result = await api.devices.register(name, ticket)
    storeDevice(result.id, result.name)
    setDeviceState({ id: result.id, name: result.name })
    return result
  }, [])
```

- [ ] **Step 3: Update AuthScreen.tsx**

In `web/src/components/AuthScreen.tsx`, change:

```tsx
interface Props {
  onVerified: () => void
}
```

to:

```tsx
interface Props {
  onVerified: (ticket: string) => void
}
```

And change:

```tsx
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
```

to:

```tsx
  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await api.auth.verify(code)
      onVerified(result.ticket)
    } catch {
      setError('Wrong code. Try again.')
    } finally {
      setLoading(false)
    }
  }
```

- [ ] **Step 4: Update DeviceNameScreen.tsx**

In `web/src/components/DeviceNameScreen.tsx`, change:

```tsx
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
```

to:

```tsx
interface Props {
  ticket: string
  onRegistered: () => void
}

export function DeviceNameScreen({ ticket, onRegistered }: Props) {
  const { register } = useDevice()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await register(name.trim(), ticket)
      onRegistered()
    } catch {
      setError('Failed to register device. Check your connection.')
    } finally {
      setLoading(false)
    }
  }
```

- [ ] **Step 5: Update App.tsx**

In `web/src/App.tsx`, change:

```tsx
  const { isRegistered } = useDevice()
  const [authState, setAuthState] = useState<AuthState>(isRegistered ? 'ready' : 'needs_code')
```

to:

```tsx
  const { isRegistered } = useDevice()
  const [authState, setAuthState] = useState<AuthState>(isRegistered ? 'ready' : 'needs_code')
  const [registrationTicket, setRegistrationTicket] = useState('')
```

Change:

```tsx
  const handleVerified = useCallback(() => setAuthState('needs_name'), [])
  const handleRegistered = useCallback(() => setAuthState('ready'), [])

  if (authState === 'needs_code') return <AuthScreen onVerified={handleVerified} />
  if (authState === 'needs_name') return <DeviceNameScreen onRegistered={handleRegistered} />
```

to:

```tsx
  const handleVerified = useCallback((ticket: string) => {
    setRegistrationTicket(ticket)
    setAuthState('needs_name')
  }, [])
  const handleRegistered = useCallback(() => setAuthState('ready'), [])

  if (authState === 'needs_code') return <AuthScreen onVerified={handleVerified} />
  if (authState === 'needs_name') return <DeviceNameScreen ticket={registrationTicket} onRegistered={handleRegistered} />
```

- [ ] **Step 6: Type-check and manual verification**

```bash
cd web && ./node_modules/.bin/tsc -b --noEmit
```

Expected: no type errors.

```bash
cd web && npm run dev
```

Clear the device from browser storage (Settings → Log out, or clear `localStorage`), reload, enter the access code, name the device, confirm registration succeeds and the app reaches the main screen. This exercises the full verify → ticket → register flow end to end.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/api.ts web/src/hooks/useDevice.ts web/src/components/AuthScreen.tsx web/src/components/DeviceNameScreen.tsx web/src/App.tsx
git commit -m "security: thread verify ticket through to device registration"
```

---

## Task 8: Rate limit /api/auth/verify

**Files:**
- Modify: `api/routers/auth.py`
- Modify: `api/tests/conftest.py`
- Modify: `api/tests/test_auth.py`

**Interfaces:**
- Produces: `routers.auth._attempts: dict[str, list[datetime]]` (module-level store, reset by the same autouse fixture extended below).
- `POST /api/auth/verify` returns `429` with a `Retry-After` header after 10 attempts (success or failure) from the same client within a 15-minute window; a successful verification resets that client's counter.

- [ ] **Step 1: Extend the autouse fixture to reset the new store**

In `api/tests/conftest.py`, change:

```python
@pytest.fixture(autouse=True)
def _reset_auth_module_state():
    from routers.auth import _pending_tickets
    _pending_tickets.clear()
    yield
    _pending_tickets.clear()
```

to:

```python
@pytest.fixture(autouse=True)
def _reset_auth_module_state():
    from routers.auth import _pending_tickets, _attempts
    _pending_tickets.clear()
    _attempts.clear()
    yield
    _pending_tickets.clear()
    _attempts.clear()
```

- [ ] **Step 2: Write the failing tests**

In `api/tests/test_auth.py`, add these two tests at the end of the file:

```python
def test_verify_rate_limited_after_too_many_attempts(client):
    for _ in range(10):
        client.post("/api/auth/verify", json={"code": "wrong"})
    res = client.post("/api/auth/verify", json={"code": "wrong"})
    assert res.status_code == 429
    assert "Retry-After" in res.headers


def test_verify_rate_limit_resets_after_success(client):
    for _ in range(5):
        client.post("/api/auth/verify", json={"code": "wrong"})
    res = client.post("/api/auth/verify", json={"code": "secret123"})
    assert res.status_code == 200
    # counter was reset by the success above, so a fresh run of attempts starts from zero
    for _ in range(9):
        res = client.post("/api/auth/verify", json={"code": "wrong"})
        assert res.status_code == 401
```

- [ ] **Step 3: Run to verify they fail**

```bash
cd api && .venv/bin/python -m pytest tests/test_auth.py -v
```

Expected: `test_verify_rate_limited_after_too_many_attempts` FAILs (gets `401` instead of `429` on the 11th call — no rate limiting exists yet); `test_verify_rate_limit_resets_after_success` passes coincidentally (no limiter yet means nothing to reset) but will still be exercised correctly once the limiter exists.

- [ ] **Step 4: Implement the rate limiter**

Replace `api/routers/auth.py` with:

```python
import hmac
import secrets
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from config import Settings, get_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

_TICKET_TTL = timedelta(minutes=5)
_pending_tickets: dict[str, datetime] = {}

_RATE_LIMIT_WINDOW = timedelta(minutes=15)
_RATE_LIMIT_MAX_ATTEMPTS = 10
# NOTE: keyed by request.client.host — if this app is ever placed behind a
# reverse proxy that doesn't forward the real client IP, all proxied clients
# share one rate-limit bucket. Fix proxy config if that ever applies; not
# handled here.
_attempts: dict[str, list[datetime]] = {}


def issue_ticket() -> str:
    ticket = secrets.token_urlsafe(24)
    _pending_tickets[ticket] = datetime.utcnow() + _TICKET_TTL
    return ticket


def consume_ticket(ticket: str) -> bool:
    expires_at = _pending_tickets.pop(ticket, None)
    if expires_at is None:
        return False
    return datetime.utcnow() < expires_at


def _check_rate_limit(client_key: str) -> None:
    now = datetime.utcnow()
    attempts = [t for t in _attempts.get(client_key, []) if now - t < _RATE_LIMIT_WINDOW]
    if len(attempts) >= _RATE_LIMIT_MAX_ATTEMPTS:
        _attempts[client_key] = attempts
        raise HTTPException(
            status_code=429,
            detail="Too many attempts, try again later",
            headers={"Retry-After": str(int(_RATE_LIMIT_WINDOW.total_seconds()))},
        )
    attempts.append(now)
    _attempts[client_key] = attempts


def _reset_rate_limit(client_key: str) -> None:
    _attempts.pop(client_key, None)


@router.post("/verify")
async def verify(
    request: Request,
    body: dict,
    settings: Settings = Depends(get_settings),
):
    client_key = request.client.host if request.client else "unknown"
    _check_rate_limit(client_key)
    code = body.get("code", "")
    if not hmac.compare_digest(code, settings.access_code):
        raise HTTPException(status_code=401, detail="Invalid access code")
    _reset_rate_limit(client_key)
    return {"ok": True, "ticket": issue_ticket()}


# Reusable dependency for all protected routes
async def get_device_id(x_device_id: str = Header(..., alias="X-Device-ID")) -> str:
    return x_device_id
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd api && .venv/bin/python -m pytest tests/test_auth.py -v
```

Expected: all tests PASS, including the two new ones.

- [ ] **Step 6: Run the full backend suite**

```bash
cd api && .venv/bin/python -m pytest -v
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add api/routers/auth.py api/tests/conftest.py api/tests/test_auth.py
git commit -m "security: rate limit /api/auth/verify"
```

---

## Task 9: Path traversal via playlist name

**Files:**
- Modify: `api/services/downloader.py`
- Test: `api/tests/test_download.py`

**Interfaces:**
- `services.downloader._sanitize(name: str) -> str` behavior changes: `""`, `"."`, `".."` now all map to `"_"` (previously passed through unchanged for `"."`/`".."`, and `""` after `.strip()` also passed through unchanged).

- [ ] **Step 1: Write the failing tests**

In `api/tests/test_download.py`, add these tests (anywhere among the other `_sanitize`-adjacent unit tests, e.g. right after `test_build_sidecar_index_empty_when_music_dir_missing`):

```python
def test_sanitize_rejects_dot_dot():
    from services.downloader import _sanitize
    assert _sanitize("..") == "_"


def test_sanitize_rejects_single_dot():
    from services.downloader import _sanitize
    assert _sanitize(".") == "_"


def test_sanitize_rejects_empty_string():
    from services.downloader import _sanitize
    assert _sanitize("") == "_"


def test_get_file_path_does_not_escape_music_dir_with_dot_dot_playlist(tmp_path):
    from services.downloader import get_file_path, download_song
    from unittest.mock import patch
    music_dir = tmp_path / "music"
    music_dir.mkdir()
    with patch("yt_dlp.YoutubeDL") as MockYDL:
        instance = MockYDL.return_value.__enter__.return_value
        instance.extract_info.return_value = {"title": "Escape Attempt"}
        (music_dir / "_").mkdir(parents=True, exist_ok=True)
        (music_dir / "_" / "Escape Attempt.mp3").write_text("fake")
        result = download_song("https://youtube.com/watch?v=escape", "..", str(music_dir))
    # must land inside music_dir/_, never in music_dir's parent
    assert str(music_dir / "_") in result
    assert ".." not in Path(result).parts
```

Add `from pathlib import Path` to the top of `api/tests/test_download.py` if it isn't already imported (it already is, per the existing `from pathlib import Path` on line 3 — no change needed there).

- [ ] **Step 2: Run to verify they fail**

```bash
cd api && .venv/bin/python -m pytest tests/test_download.py -v -k "sanitize or escape"
```

Expected: FAIL — `_sanitize("..")` currently returns `".."` unchanged, not `"_"`.

- [ ] **Step 3: Fix `_sanitize`**

In `api/services/downloader.py`, change:

```python
def _sanitize(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip()
```

to:

```python
def _sanitize(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]', "_", name).strip()
    if cleaned in ("", ".", ".."):
        return "_"
    return cleaned
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd api && .venv/bin/python -m pytest tests/test_download.py -v
```

Expected: all tests in the file PASS, including the 4 new ones.

- [ ] **Step 5: Run the full backend suite**

```bash
cd api && .venv/bin/python -m pytest -v
```

Expected: all tests PASS (no other code path depends on `_sanitize` passing `".."`/`"."`/`""` through unchanged).

- [ ] **Step 6: Commit**

```bash
git add api/services/downloader.py api/tests/test_download.py
git commit -m "security: reject dot-only playlist names to prevent path traversal"
```

---

## Task 10: Pin yt-dlp version

**Files:**
- Modify: `api/requirements.txt`

- [ ] **Step 1: Pin the version**

In `api/requirements.txt`, change:

```
yt-dlp
```

to:

```
yt-dlp==2026.7.4
```

(This is the version already installed in `api/.venv`, confirmed via `pip show yt-dlp`.)

- [ ] **Step 2: Reinstall and verify**

```bash
cd api && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m pytest -v
```

Expected: install succeeds with no version change (already at 2026.7.4), all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add api/requirements.txt
git commit -m "chore: pin yt-dlp to a known-working version"
```
