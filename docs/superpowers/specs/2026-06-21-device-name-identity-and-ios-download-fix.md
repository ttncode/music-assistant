# Device Name Identity & iOS Download Fix — Design Spec

**Date:** 2026-06-21

---

## Feature 1: Device Name as Identity

**Goal:** Typing the same device name in any browser on any device returns the same device UUID, so download history is shared across Chrome, Firefox, Safari, and mobile browsers.

**Scope:** Backend only. No frontend changes.

### Problem

`POST /api/devices/register` always creates a new `Device` with a fresh UUID. Visiting the app on Firefox after Chrome produces two separate device records (each with their own download history), even if the user typed the same name.

### Solution

Change `register_device` to "find or create" by name (case-insensitive, whitespace-normalized). Also deduplicate any existing same-name devices in the store on each register call.

### `dedup_devices(data: SongsFile) -> None` (api/routers/devices.py)

A utility function that runs inside `register_device` before the find-or-create lookup:

- Groups `data.devices` by `device.name.strip().lower()`
- For each group with more than one entry: keeps the first in list order, removes the rest
- Does **not** merge `device_downloads` history — disposable in development
- Mutates `data.devices` in place; returns `None`

### `POST /api/devices/register` — updated logic (api/routers/devices.py)

1. Call `dedup_devices(data)` to clean up existing duplicates
2. Normalize incoming name: `body.name.strip()`; compare via `.lower()`
3. Search `data.devices` for a device whose `name.strip().lower()` matches
4. **Found:** update `device.last_seen = datetime.utcnow()`, `write_songs(data, ...)`, return `{"id": device.id, "name": device.name}` with status 200
5. **Not found:** `Device(name=body.name.strip())`, append, `write_songs`, return `{"id": ..., "name": ...}` with status 201

Note: status code changes from always-201 to 200 (found) / 201 (created). Frontend only checks for the returned `{id, name}` body, so this is safe.

### Tests (api/tests/test_devices.py)

New tests to add:

| Test | Scenario |
|------|----------|
| `test_register_returns_existing_device_for_same_name` | Register "My Phone" twice → same `id` returned both times |
| `test_register_case_insensitive` | Register "My Phone", then "my phone" → same `id` |
| `test_register_trims_whitespace` | Register " My Phone " → name stored trimmed, second call with "My Phone" returns same `id` |
| `test_register_creates_new_for_different_name` | Register "My Phone" and "Other Device" → different `id`s |
| `test_dedup_devices_removes_duplicates` | Pre-populate store with two devices sharing a name, call register → only one device remains in store |

---

## Feature 2: Direct URL Downloads

**Goal:** Fix broken downloads on iOS Safari. Switch from the blob-URL approach to a synchronous direct-URL anchor click, which works reliably across all browsers and devices (laptop, tablet, smartphone).

### Problem

Current `api.ts` `download.file()` flow:
1. `fetch` the download URL → get response blob
2. `URL.createObjectURL(blob)` → blob URL
3. Create `<a>` with `href=blobURL`, `download=filename`, click it
4. `URL.revokeObjectURL(blobURL)` — **immediately** after click

On iOS Safari, the blob URL is revoked before the OS can read the file. Result: file downloads but shows "Unknown" filename and "unsupported URL" — unplayable.

Secondary issue: the filename regex `filename="(.+?)"` doesn't match RFC 5987 headers (`filename*=UTF-8''...`) that the backend sends, so the filename fell back to the raw UUID anyway.

### Solution

Replace the async fetch→blob chain with a synchronous anchor click pointing directly to the API URL. The server's `Content-Disposition: attachment; filename*=UTF-8''<encoded>` header handles the filename natively in all browsers.

### `download.file()` — new implementation (web/src/lib/api.ts)

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

- Return type changes from `Promise<void>` to `void`
- No blob, no object URL, no revoke

### `handleDownload()` — updated caller (web/src/components/SongRow.tsx)

Remove `await` from the `file()` call — it is now synchronous:

```ts
async function handleDownload() {
  setDownloading(true)
  try {
    await api.download.prepare(song.id)
    api.download.file(song.id)   // synchronous — no await
    setLocalDownloaded(true)
    onDownloaded()
  } catch (e) {
    onError(e instanceof Error ? e.message : 'Download failed')
  } finally {
    setDownloading(false)
  }
}
```

Error handling from `prepare` is preserved. Download failures after the trigger surface as a native browser error (rare once prepare succeeds).

### Testing

No automated tests. User will verify manually on iPhone and laptop browsers after deployment.

---

## Files Changed

| File | Change |
|------|--------|
| `api/routers/devices.py` | Add `dedup_devices()`, modify `register_device` to find-or-create |
| `api/tests/test_devices.py` | Add 5 new tests |
| `web/src/lib/api.ts` | Replace `download.file()` with synchronous direct-URL approach |
| `web/src/components/SongRow.tsx` | Remove `await` from `api.download.file()` call |
