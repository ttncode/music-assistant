# Per-Device Song Hide + Device Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change "Remove song" from a global delete into a per-device hide, add real server-side device deletion for "Unregister", and add a "Log out" action that switches devices without deleting anything.

**Architecture:** Three independent backend/frontend slices. (1) `api/models.py` + `api/routers/songs.py`: reuse the existing per-device `DeviceDownload` record (add an `ignored` flag) so hiding a song never touches `songs.json`'s song list or disk — it only marks the calling device's own record. (2) `api/routers/devices.py`: a new `DELETE /api/devices/{id}` that actually removes the device and scrubs its entries out of every song. (3) `web/src/lib/api.ts` + `web/src/components/SettingsSheet.tsx`: wire Unregister to the new endpoint and add a no-confirm Log out button.

**Tech Stack:** Python/FastAPI/pytest (backend, real test suite), React/TypeScript (frontend, no test framework — manual verification per prior specs in this repo).

## Global Constraints

- Hiding a song (any number of devices) never deletes it from `songs.json` or disk. Deletion happens only through sync's existing stale-cleanup (`api/routers/sync.py`, unmodified in this plan).
- No special-casing for manually-added songs — they follow the exact same hide rule as synced songs.
- `DELETE /api/devices/{id}` requires `caller_id == device_id` (403 otherwise), matching the existing pattern in `rename_device` and `clear_history`.
- Log out makes no API call — it only clears local device storage client-side.
- No changes to `api/routers/sync.py` or `api/services/downloader.py` in this plan.

---

## How to run backend tests

A venv already exists at `api/.venv` (created for a prior plan). If missing, recreate with:

```bash
cd api && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

Run tests with `PYTHONPATH` set to `api/` (matches this repo's CI config in `.github/workflows/ci.yml`):

```bash
cd api && PYTHONPATH=. .venv/bin/pytest tests/ -v
```

---

### Task 1: Per-device hide (`ignored` flag + `GET`/`DELETE /api/songs`)

**Files:**
- Modify: `api/models.py:12-15` (`DeviceDownload`)
- Modify: `api/routers/songs.py:31-49` (`get_songs`), `api/routers/songs.py:75-84` (`delete_song` → `hide_song`)
- Test: `api/tests/test_songs.py`

**Interfaces:**
- Consumes: `DeviceDownload(name: str, downloaded: bool = False, downloaded_at:
  datetime | None = None)` (existing, from `api/models.py`).
- Produces: `DeviceDownload` gains `ignored: bool = False`. `GET /api/songs`
  omits any song where the requesting device's `DeviceDownload.ignored` is
  `True`. `DELETE /api/songs/{id}` no longer deletes the song — it sets
  `ignored = True` on the calling device's record and returns `404` if the
  song id doesn't exist (changed from today's silent `200`).

- [ ] **Step 1: Write the failing tests**

In `api/tests/test_songs.py`, insert these two tests right after
`test_get_songs_false_for_unknown_device` (which ends at line 44) and
before `test_post_song_adds_to_list`:

```python
def test_get_songs_excludes_hidden_song_for_that_device(client, data_dir):
    song = Song(title="T", url="https://youtube.com/watch?v=hide", platform="youtube",
                device_downloads={DEV: DeviceDownload(name="Dev", ignored=True)})
    seed(data_dir, [song])
    res = client.get("/api/songs", headers=HEADERS)
    assert res.json()["songs"] == []


def test_get_songs_still_shows_hidden_song_to_other_device(client, data_dir):
    song = Song(title="T", url="https://youtube.com/watch?v=hide2", platform="youtube",
                device_downloads={DEV: DeviceDownload(name="Dev", ignored=True)})
    seed(data_dir, [song])
    res = client.get("/api/songs", headers={"X-Device-ID": "other-device"})
    body = res.json()["songs"]
    assert len(body) == 1
    assert body[0]["downloaded"] is False
```

Then replace the existing `test_delete_song` and
`test_delete_song_not_found_returns_ok` (currently at the end of the file,
right before `test_get_songs_always_includes_tiktok_playlist`):

```python
def test_delete_song(client, data_dir):
    song = Song(title="T", url="https://youtube.com/watch?v=del", platform="youtube")
    seed(data_dir, [song])
    res = client.delete(f"/api/songs/{song.id}", headers=HEADERS)
    assert res.status_code == 200
    from store import read_songs
    assert len(read_songs(data_dir).songs) == 0


def test_delete_song_not_found_returns_ok(client):
    res = client.delete("/api/songs/nonexistent-id", headers=HEADERS)
    assert res.status_code == 200
    assert res.json() == {"ok": True}
```

with:

```python
def test_delete_song_hides_for_calling_device_only(client, data_dir):
    song = Song(title="T", url="https://youtube.com/watch?v=del", platform="youtube")
    seed(data_dir, [song])
    res = client.delete(f"/api/songs/{song.id}", headers=HEADERS)
    assert res.status_code == 200
    from store import read_songs
    data = read_songs(data_dir)
    assert len(data.songs) == 1
    assert data.songs[0].device_downloads[DEV].ignored is True


def test_delete_song_not_found_returns_404(client):
    res = client.delete("/api/songs/nonexistent-id", headers=HEADERS)
    assert res.status_code == 404
```

(This is a deliberate behavior change: hiding requires finding the song
record to mark, so a missing id now 404s — matching the existing
`mark_downloaded` endpoint's pattern instead of the old silent-success
behavior.)

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd api && PYTHONPATH=. .venv/bin/pytest tests/test_songs.py -v
```

Expected: the two new `excludes`/`still_shows` tests FAIL (`ignored` field
doesn't exist yet on `DeviceDownload` — Pydantic validation error).
`test_delete_song_hides_for_calling_device_only` FAILS (song is still fully
removed today, `len(data.songs) == 0` not `1`).
`test_delete_song_not_found_returns_404` FAILS (`assert 200 == 404`).

- [ ] **Step 3: Add the `ignored` field**

In `api/models.py`, replace:

```python
class DeviceDownload(BaseModel):
    name: str
    downloaded: bool = False
    downloaded_at: datetime | None = None
```

with:

```python
class DeviceDownload(BaseModel):
    name: str
    downloaded: bool = False
    downloaded_at: datetime | None = None
    ignored: bool = False
```

- [ ] **Step 4: Filter hidden songs out of `GET /api/songs`**

In `api/routers/songs.py`, replace:

```python
    data = read_songs(settings.data_dir)
    songs_out = []
    for s in data.songs:
        dd = s.device_downloads.get(device_id)
        songs_out.append({
            **s.model_dump(),
            "downloaded": dd.downloaded if dd else False,
        })
```

with:

```python
    data = read_songs(settings.data_dir)
    songs_out = []
    for s in data.songs:
        dd = s.device_downloads.get(device_id)
        if dd and dd.ignored:
            continue
        songs_out.append({
            **s.model_dump(),
            "downloaded": dd.downloaded if dd else False,
        })
```

- [ ] **Step 5: Change `delete_song` into `hide_song`**

In `api/routers/songs.py`, replace:

```python
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

with:

```python
@router.delete("/{song_id}")
async def hide_song(
    song_id: str,
    device_id: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    data = read_songs(settings.data_dir)
    song = next((s for s in data.songs if s.id == song_id), None)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    if device_id not in song.device_downloads:
        device = next((d for d in data.devices if d.id == device_id), None)
        song.device_downloads[device_id] = DeviceDownload(name=device.name if device else "Unknown")
    song.device_downloads[device_id].ignored = True
    write_songs(data, settings.data_dir)
    return {"ok": True}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd api && PYTHONPATH=. .venv/bin/pytest tests/test_songs.py -v
```

Expected: all tests PASS.

- [ ] **Step 7: Run the full backend suite**

```bash
cd api && PYTHONPATH=. .venv/bin/pytest -v
```

Expected: all tests PASS (no other test file references `delete_song` by
name or relies on the old delete-removes-the-song behavior).

- [ ] **Step 8: Commit**

```bash
git add api/models.py api/routers/songs.py api/tests/test_songs.py
git commit -m "feat: change remove song into a per-device hide instead of a global delete"
```

---

### Task 2: Real device deletion (`DELETE /api/devices/{id}`)

**Files:**
- Modify: `api/routers/devices.py` (append new endpoint)
- Test: `api/tests/test_devices.py`

**Interfaces:**
- Consumes: `Song.device_downloads: dict[str, DeviceDownload]` (existing),
  `SongsFile.devices: list[Device]` (existing).
- Produces: `DELETE /api/devices/{device_id}` → `{"ok": True}` on success;
  `403` if `X-Device-ID` header doesn't match the path `device_id`; `404`
  if no device with that id exists in `data.devices`. Removes the device
  from `data.devices` and pops that `device_id` key from every song's
  `device_downloads`.

- [ ] **Step 1: Write the failing tests**

Add to the end of `api/tests/test_devices.py`:

```python
def test_unregister_device(client, data_dir):
    reg = client.post("/api/devices/register", json={"name": "To Remove"})
    dev_id = reg.json()["id"]
    res = client.delete(f"/api/devices/{dev_id}", headers={"X-Device-ID": dev_id})
    assert res.status_code == 200
    from store import read_songs
    data = read_songs(data_dir)
    assert all(d.id != dev_id for d in data.devices)


def test_unregister_device_forbidden(client):
    reg = client.post("/api/devices/register", json={"name": "Device A"})
    dev_id = reg.json()["id"]
    res = client.delete(f"/api/devices/{dev_id}", headers={"X-Device-ID": "some-other-device"})
    assert res.status_code == 403


def test_unregister_device_not_found(client):
    res = client.delete("/api/devices/nonexistent-id", headers={"X-Device-ID": "nonexistent-id"})
    assert res.status_code == 404


def test_unregister_device_removes_its_device_downloads_entries(client, data_dir):
    from store import read_songs, write_songs
    from models import SongsFile, Song, DeviceDownload
    dev_id = "dev-to-remove"
    song = Song(title="T", url="https://youtube.com/watch?v=x", platform="youtube",
                device_downloads={dev_id: DeviceDownload(name="Old Phone", downloaded=True, ignored=True)})
    write_songs(SongsFile(songs=[song], playlists=[], devices=[]), data_dir)

    res = client.delete(f"/api/devices/{dev_id}", headers={"X-Device-ID": dev_id})
    assert res.status_code == 200
    data = read_songs(data_dir)
    assert dev_id not in data.songs[0].device_downloads
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd api && PYTHONPATH=. .venv/bin/pytest tests/test_devices.py -v
```

Expected: no route is registered yet for `DELETE /api/devices/{device_id}`
(only `DELETE /api/devices/{device_id}/history` exists), so FastAPI returns
its own 404 for every request regardless of headers or body.
`test_unregister_device` and `test_unregister_device_removes_its_device_downloads_entries`
FAIL (`assert 404 == 200`). `test_unregister_device_forbidden` FAILS
(`assert 404 == 403`). `test_unregister_device_not_found` happens to PASS
already, since a route-miss is also a 404 — that's expected and fine; it
will keep passing for the right reason once the real endpoint exists.

- [ ] **Step 3: Add the endpoint**

In `api/routers/devices.py`, append this function at the end of the file
(after `clear_history`):

```python
@router.delete("/{device_id}")
async def unregister_device(
    device_id: str,
    caller_id: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    if caller_id != device_id:
        raise HTTPException(status_code=403, detail="Cannot unregister another device")
    data = read_songs(settings.data_dir)
    device = next((d for d in data.devices if d.id == device_id), None)
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    data.devices = [d for d in data.devices if d.id != device_id]
    for song in data.songs:
        song.device_downloads.pop(device_id, None)
    write_songs(data, settings.data_dir)
    return {"ok": True}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd api && PYTHONPATH=. .venv/bin/pytest tests/test_devices.py -v
```

Expected: all tests PASS.

- [ ] **Step 5: Run the full backend suite**

```bash
cd api && PYTHONPATH=. .venv/bin/pytest -v
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add api/routers/devices.py api/tests/test_devices.py
git commit -m "feat: add DELETE /api/devices/{id} to actually remove a device"
```

---

### Task 3: Wire up Log out + real Unregister in the frontend

**Files:**
- Modify: `web/src/lib/api.ts:56-59` (`devices` object)
- Modify: `web/src/components/SettingsSheet.tsx`

**Interfaces:**
- Consumes: `DELETE /api/devices/{device_id}` from Task 2 (returns
  `{"ok": true}` on success, throws on non-2xx via the existing `req()`
  helper in `api.ts`).
- Produces: `api.devices.unregister(deviceId: string): Promise<{ ok:
  boolean }>` in `web/src/lib/api.ts`, used only by `SettingsSheet.tsx`.

- [ ] **Step 1: Add the API client method**

In `web/src/lib/api.ts`, replace:

```typescript
  devices: {
    register: (name: string) => req<{ id: string; name: string }>('POST', '/api/devices/register', { name }),
    rename: (deviceId: string, name: string) => req<{ id: string; name: string }>('PATCH', `/api/devices/${deviceId}`, { name }),
    clearHistory: (deviceId: string) => req<{ ok: boolean }>('DELETE', `/api/devices/${deviceId}/history`),
  },
```

with:

```typescript
  devices: {
    register: (name: string) => req<{ id: string; name: string }>('POST', '/api/devices/register', { name }),
    rename: (deviceId: string, name: string) => req<{ id: string; name: string }>('PATCH', `/api/devices/${deviceId}`, { name }),
    clearHistory: (deviceId: string) => req<{ ok: boolean }>('DELETE', `/api/devices/${deviceId}/history`),
    unregister: (deviceId: string) => req<{ ok: boolean }>('DELETE', `/api/devices/${deviceId}`),
  },
```

- [ ] **Step 2: Import the new icon**

In `web/src/components/SettingsSheet.tsx`, replace:

```typescript
import { X, Trash, SignOut, CircleNotch, PencilSimple } from '@phosphor-icons/react'
```

with:

```typescript
import { X, Trash, SignOut, UserSwitch, CircleNotch, PencilSimple } from '@phosphor-icons/react'
```

- [ ] **Step 3: Add state for unregister loading/error**

Replace:

```typescript
  const [confirmUnregister, setConfirmUnregister] = useState('')
```

with:

```typescript
  const [confirmUnregister, setConfirmUnregister] = useState('')
  const [unregistering, setUnregistering] = useState(false)
  const [unregisterError, setUnregisterError] = useState('')
```

- [ ] **Step 4: Reset the new state when the sheet closes**

Replace:

```typescript
  useEffect(() => {
    if (!open) {
      setConfirmText('')
      setConfirmUnregister('')
      setEditingName(false)
      setDraftName('')
    }
  }, [open])
```

with:

```typescript
  useEffect(() => {
    if (!open) {
      setConfirmText('')
      setConfirmUnregister('')
      setUnregisterError('')
      setEditingName(false)
      setDraftName('')
    }
  }, [open])
```

- [ ] **Step 5: Make `handleUnregister` call the real API, and add `handleLogout`**

Replace:

```typescript
  function handleUnregister() {
    if (confirmUnregister !== UNREGISTER_PHRASE) return
    clear()
    onUnregistered()
  }
```

with:

```typescript
  async function handleUnregister() {
    if (!deviceId || confirmUnregister !== UNREGISTER_PHRASE) return
    setUnregistering(true)
    setUnregisterError('')
    try {
      await api.devices.unregister(deviceId)
      clear()
      onUnregistered()
    } catch (e) {
      setUnregisterError(e instanceof Error ? e.message : 'Failed to unregister device')
    } finally {
      setUnregistering(false)
    }
  }

  function handleLogout() {
    clear()
    onUnregistered()
  }
```

- [ ] **Step 6: Add the Log out button to the "This device" section**

Replace:

```tsx
            <p className="text-xs text-[var(--color-text-secondary)] mt-1 font-mono">{deviceId}</p>
          </section>
```

with:

```tsx
            <p className="text-xs text-[var(--color-text-secondary)] mt-1 font-mono">{deviceId}</p>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 cursor-pointer rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors w-full mt-3"
            >
              <UserSwitch size={14} />
              Log out
            </button>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5">
              Switch to a different device. This device stays registered — log back in with the same name to pick up where you left off.
            </p>
          </section>
```

- [ ] **Step 7: Update the Unregister section's copy and button state**

Replace:

```tsx
          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-3">Account</h3>
            <p className="text-[11px] text-[var(--color-text-muted)] mb-2">
              This will remove this device. You'll need to re-enter your access code to use it again.
            </p>
            <input
              value={confirmUnregister}
              onChange={e => setConfirmUnregister(e.target.value)}
              placeholder={`Type "${UNREGISTER_PHRASE}" to confirm`}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-error)]/60 transition-colors placeholder:text-[var(--color-text-muted)] mb-2"
            />
            <button
              onClick={handleUnregister}
              disabled={confirmUnregister !== UNREGISTER_PHRASE}
              className="flex items-center gap-2 cursor-pointer rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors w-full disabled:opacity-40"
            >
              <SignOut size={14} />
              Unregister this device
            </button>
          </section>
```

with:

```tsx
          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-3">Account</h3>
            <p className="text-[11px] text-[var(--color-text-muted)] mb-2">
              This will permanently remove this device and delete its download history from the library. You'll need to re-enter your access code to use it again.
            </p>
            <input
              value={confirmUnregister}
              onChange={e => setConfirmUnregister(e.target.value)}
              disabled={unregistering}
              placeholder={`Type "${UNREGISTER_PHRASE}" to confirm`}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-error)]/60 transition-colors placeholder:text-[var(--color-text-muted)] mb-2 disabled:opacity-50"
            />
            <button
              onClick={handleUnregister}
              disabled={unregistering || confirmUnregister !== UNREGISTER_PHRASE}
              className="flex items-center gap-2 cursor-pointer rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors w-full disabled:opacity-40"
            >
              {unregistering ? <CircleNotch size={14} className="animate-spin" /> : <SignOut size={14} />}
              {unregistering ? 'Unregistering...' : 'Unregister this device'}
            </button>
            {unregisterError && (
              <p className="text-[11px] text-[var(--color-error)] mt-1.5">{unregisterError}</p>
            )}
          </section>
```

- [ ] **Step 8: Typecheck**

```bash
cd web && ~/.nvm/versions/node/v22.17.1/bin/node node_modules/typescript/bin/tsc -b --noEmit
```

Expected: no output (clean).

(If `~/.nvm/versions/node/v22.17.1` doesn't exist in your environment, use
whatever working `node` binary is available — the repo's shell may have a
broken `node`/`nvm` shell-function wrapper that causes infinite recursion;
invoking the versioned binary directly under `~/.nvm/versions/node/`
sidesteps it.)

- [ ] **Step 9: Manually verify**

Start both servers (see any prior plan in this repo for the two-terminal
`uvicorn`/`npm run dev` setup) and in a browser:

- Open Settings. Confirm a new "Log out" button appears in the "This
  device" section with the hint text below it.
- Click Log out. Confirm you're returned to the access-code screen
  immediately, no confirm phrase required.
- Log back in with the access code, then register with the *same* device
  name you had before. Confirm you land back with the same device id
  (check the Settings sheet's monospace device id matches what it was
  before logging out) and any previously-downloaded/hidden song state is
  unchanged.
- Open Settings again, go to the Account section, confirm the updated copy
  ("permanently remove this device and delete its download history...").
  Type "unregister" and submit. Confirm you're returned to the access-code
  screen. Re-register a *new* device with a different name, and confirm
  the old device's id no longer appears anywhere (there's no device list UI
  today, so this is really just confirming the flow completes without
  error — the actual server-side removal is covered by Task 2's automated
  tests).

- [ ] **Step 10: Commit**

```bash
git add web/src/lib/api.ts web/src/components/SettingsSheet.tsx
git commit -m "feat: add logout action and wire unregister to real device deletion"
```

---

## Self-Review Notes

- Spec section 1 (per-device hide) → Task 1, fully covered: `ignored`
  field, `GET` filter, `DELETE` behavior change, including the 404 edge
  case explicitly called out.
- Spec section 2 (real device deletion) → Task 2, fully covered: new
  endpoint, 403/404 handling, `device_downloads` cleanup across all songs.
- Spec section 3 (Log out) → Task 3 Steps 5-6: no API call, reuses
  `clear()` + `onUnregistered()`.
- Spec's UI copy updates (both the Log out hint text and the revised
  Unregister description) → Task 3 Steps 6-7, exact strings match what was
  approved in conversation.
- Spec's "no confirm phrase for Log out" → Task 3 Step 5/6: `handleLogout`
  has no phrase-matching gate, unlike `handleUnregister`.
- Spec's error handling ("if unregister fails, don't clear local storage or
  navigate away, show inline error") → Task 3 Step 5 catch block only
  clears/navigates inside the `try`, sets `unregisterError` in `catch`.
- Placeholder scan: all test bodies, implementation diffs, and exact copy
  strings are written out in full; no "add tests for X" or "handle
  appropriately" phrasing anywhere.
- Type/name consistency: `DeviceDownload.ignored: bool`,
  `hide_song`/`unregister_device` function names, and
  `api.devices.unregister(deviceId: string)` are used identically across
  every task and step that references them.
- No task touches `api/routers/sync.py` or `api/services/downloader.py`,
  matching the spec's explicit out-of-scope list.
