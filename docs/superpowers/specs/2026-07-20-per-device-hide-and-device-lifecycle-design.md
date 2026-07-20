# Per-device song hide + real device lifecycle

## Context

Today "Remove song" (`DELETE /api/songs/{id}` in `api/routers/songs.py`)
deletes the song from the shared library for every device instantly, and
never touches the downloaded MP3 on disk — an unrelated, pre-existing gap.
Separately, "Unregister this device" in `SettingsSheet.tsx` only clears
local browser storage; it never tells the server, so `data.devices` only
ever grows and a device's `device_downloads` entries never disappear.

This spec changes "Remove song" into a per-device hide, makes "Unregister"
actually delete the device server-side, and adds a "Log out" action that
switches devices without deleting anything. Disk/library cleanup for songs
remains exactly as it works today — governed only by sync noticing a URL
has disappeared from the source YouTube/SoundCloud playlist
(`api/routers/sync.py`'s existing stale-song cleanup). Hiding a song, by
any number of devices, never deletes it from `songs.json` or disk. This
was confirmed explicitly: manually-added songs (TikTok, pasted URLs) that
get hidden by every device that's ever touched them will persist invisibly
in the shared library/disk forever — accepted as-is, no special-casing.

Scope: `api/models.py`, `api/routers/songs.py`, `api/routers/devices.py`,
`web/src/lib/api.ts`, `web/src/components/SettingsSheet.tsx`. No changes to
`api/routers/sync.py` or `api/services/downloader.py` — sync-driven
disk/library cleanup is untouched.

## 1. Per-device hide

Add `ignored: bool = False` to `DeviceDownload` in `api/models.py:12-15`,
reusing the dict already keyed by device id on `Song.device_downloads` —
no new top-level field on `Song`.

`DELETE /api/songs/{id}` (`api/routers/songs.py`) changes from removing the
song out of `data.songs` to: find or create the calling device's
`DeviceDownload` entry, set `.ignored = True`, write, return `{"ok":
True}`. It never deletes the song record or its file.

`GET /api/songs` filters its response per requesting device: a song is
omitted if `device_downloads.get(device_id)` exists and `.ignored` is
`True`. Every other device continues to see the song, with its own
`downloaded` value computed exactly as today.

No frontend change is required for this part. `api.songs.delete(id)`
(`web/src/lib/api.ts:64`) keeps its existing route and method — the
backend behavior change is transparent to the client. The existing
optimistic filter in `removeSong` (`web/src/hooks/useSongs.ts:32-35`) and
the 10-second poll already produce the correct UX: the song disappears
from the acting device's list and stays for everyone else.

## 2. Real device deletion

New endpoint `DELETE /api/devices/{id}` in `api/routers/devices.py`,
following the existing self-service pattern used by `rename_device` and
`clear_history` (`caller_id` from `X-Device-ID` must equal the path
`device_id`, else `403`). On success:
- Remove the device from `data.devices`.
- For every song in `data.songs`, remove that `device_id` key from
  `device_downloads` if present (drops both its `downloaded` and
  `ignored` state — the device no longer exists, so it shouldn't count
  toward anything).
- Write and return `{"ok": True}`.
- `404` if the device id isn't found in `data.devices`.

New client method `api.devices.unregister(deviceId)` →
`DELETE /api/devices/${deviceId}` in `web/src/lib/api.ts`, alongside the
existing `devices.rename`/`devices.clearHistory` entries.

`SettingsSheet.tsx`'s existing "Unregister this device" flow
(`handleUnregister`, gated by typing the confirm phrase `"unregister"`)
calls `api.devices.unregister(deviceId)` before `clear()` +
`onUnregistered()`. If the API call fails, do not clear local storage or
navigate away — surface the error the same way other failed actions in
this component would (existing component has no toast/error prop; add a
simple inline error message state, matching the local, self-contained
style already used for the rename flow's own state).

Copy update for this section (`SettingsSheet.tsx`, "Account" section):
from *"This will remove this device. You'll need to re-enter your access
code to use it again."* to *"This will permanently remove this device and
delete its download history from the library. You'll need to re-enter
your access code to use it again."*

## 3. Log out

New button in the "This device" section of `SettingsSheet.tsx`, below the
device name/rename UI, no confirm phrase. On click: calls the existing
`clear()` (local storage only, from `useDevice`) then the existing
`onUnregistered` prop (already wired in `App.tsx` to close settings and
set `authState` back to `'needs_code'`) — reusing the same callback the
Unregister flow uses, since both end in "go back to the access code
screen," just with different side effects beforehand. No API call is
made; the device record and all its `device_downloads` entries
(downloaded + ignored flags) stay on the server untouched. Logging back
in with the same device name re-attaches to the same device via the
existing register-dedup-by-name logic in `POST /api/devices/register`
(`api/routers/devices.py:31-42`) — unchanged.

Hint text under the button: *"Switch to a different device. This device
stays registered — log back in with the same name to pick up where you
left off."*

## Error handling

- `DELETE /api/devices/{id}`: `403` if the caller isn't unregistering
  itself (matches `rename_device`/`clear_history`); `404` if the device id
  doesn't exist in `data.devices`.
- `DELETE /api/songs/{id}` (hide): `404` if the song id doesn't exist,
  matching current behavior — no new error paths, since it no longer does
  anything destructive.
- Frontend: if `api.devices.unregister` fails, `SettingsSheet` keeps the
  confirm-phrase input and shows an inline error instead of proceeding to
  clear local storage — the device must not appear "logged out" locally if
  it's still registered on the server.

## Testing

Backend (`api/tests/`):
- `DELETE /api/songs/{id}` sets `ignored=True` for the calling device
  without removing the song from `data.songs`.
- `GET /api/songs` omits a song hidden by the requesting device, but still
  returns it (with the correct `downloaded` value) for a different device
  id that hasn't hidden it.
- `DELETE /api/devices/{id}` removes the device from `data.devices` and
  strips that device's key from every song's `device_downloads`.
- `DELETE /api/devices/{id}` returns `403` when `X-Device-ID` doesn't match
  the path id, and `404` for an unknown device id.

Frontend: no new automated tests (no test framework in `web/`, consistent
with prior specs in this repo) — manual verification of the Log out button
(returns to access code screen, device still registered, logging back in
with the same name resumes state) and the Unregister flow (now actually
removes the device server-side) via the existing dev-server setup.

## Out of scope

- Any change to sync's stale-cleanup logic or `services/downloader.py` —
  disk/library deletion stays exactly as it works today.
- An "unhide" action, or any UI to see/manage songs hidden by the current
  device.
- Special-casing manually-added songs to support real deletion — confirmed
  acceptable for them to persist invisibly once hidden by every device
  that's touched them.
- Any device-staleness or last-seen-based logic — devices are removed only
  by explicit Unregister.
