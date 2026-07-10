# Mark Song as Downloaded Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a user to manually mark a song as downloaded on their current device without triggering an actual file download.

**Architecture:** New backend endpoint writes to `device_downloads` (same field the real download sets). Frontend adds a swipe-right gesture on mobile and a hover button on desktop, both calling the same endpoint and reusing the existing `onDownloaded()` callback.

**Tech Stack:** FastAPI, Python 3.12, React 19, TypeScript strict, Tailwind CSS v4, Phosphor Icons

---

## Global Constraints

- No new dependencies
- TypeScript strict — no `noUnusedLocals` / `noUnusedParameters` violations
- Tailwind CSS v4 only — no arbitrary color values; use `text-green-500`, `bg-green-500`
- Use `CheckCircle` from `@phosphor-icons/react` for the mark action icon
- After marking: call `onDownloaded()` callback — identical behavior to a real download
- No unmark / undo per song (one-way action); existing "Clear history" covers bulk undo
- Three files modified only: `api/routers/songs.py`, `web/src/lib/api.ts`, `web/src/components/SongRow.tsx`

---

## Data Model

`Song.device_downloads: dict[str, DeviceDownload]` — keyed by device ID.

```python
class DeviceDownload(BaseModel):
    name: str
    downloaded: bool = False
    downloaded_at: datetime | None = None
```

`GET /api/songs` already returns `downloaded: dd.downloaded if dd else False` per device. No model changes needed.

---

## Backend

**File:** `api/routers/songs.py`

New endpoint added to the existing `router`:

```
POST /api/songs/{song_id}/mark-downloaded
```

- Auth: `device_id` from `X-Device-ID` header via `get_device_id` dependency
- Reads songs, finds song by ID (404 if missing)
- If `device_downloads[device_id]` already has `downloaded = True` → return `{"ok": True}` (idempotent, no write)
- Otherwise: set `downloaded = True`, `downloaded_at = datetime.utcnow()`, write songs
- Returns `{"ok": True}`
- Does NOT touch `song.prepared` or trigger any file operation

---

## Frontend

### `web/src/lib/api.ts`

Add to `api.songs`:

```ts
markDownloaded: (id: string) => req<{ ok: boolean }>('POST', `/api/songs/${id}/mark-downloaded`),
```

### `web/src/components/SongRow.tsx`

**New constant:**
```ts
const MARK_WIDTH = 64
```

**Swipe extension (mobile):**

Extend `swipeX` range from `[-DELETE_WIDTH, 0]` to `[-DELETE_WIDTH, +MARK_WIDTH]`:
- In `onTouchMove`: clamp to `Math.max(Math.min(..., MARK_WIDTH), -DELETE_WIDTH)`
- In `handleTouchEnd` snap logic:
  - `swipeX > SNAP_THRESHOLD` → snap to `+MARK_WIDTH`
  - `swipeX > 0` but `<= SNAP_THRESHOLD` → snap to `0`
  - `swipeX < -SNAP_THRESHOLD` → snap to `-DELETE_WIDTH` (existing)
  - `swipeX >= -SNAP_THRESHOLD` and `<= 0` → snap to `0` (existing)

**Mark button (mobile, left side of row):**

```tsx
{swipeX > 0 && (
  <button
    onClick={handleMarkDownloaded}
    aria-label="Mark as downloaded"
    className="absolute left-0 top-0 bottom-0 w-16 md:hidden flex items-center justify-center bg-green-500 text-white"
  >
    <CheckCircle size={18} />
  </button>
)}
```

Positioned absolute left-0 (symmetric to the delete button at right-0). Hidden on `md:` and above.

**Hover button (laptop, in Actions area):**

Added inside the `<div className="flex items-center gap-2 shrink-0">` actions container, before the existing delete button:

```tsx
{!isDownloaded && (
  <button
    onClick={handleMarkDownloaded}
    className="opacity-0 group-hover:opacity-100 cursor-pointer p-1 rounded text-[var(--color-text-muted)] hover:text-green-500 transition-all hidden md:flex"
    aria-label="Mark as downloaded"
  >
    <CheckCircle size={13} />
  </button>
)}
```

Hidden on mobile (`hidden md:flex`), only shown when not yet downloaded.

**`handleMarkDownloaded` function:**

```ts
async function handleMarkDownloaded() {
  setSwipeX(0)
  try {
    await api.songs.markDownloaded(song.id)
    setLocalDownloaded(true)
    onDownloaded()
  } catch (e) {
    onError(e instanceof Error ? e.message : 'Failed to mark as downloaded')
  }
}
```

Uses existing `localDownloaded` state + `onDownloaded()` callback — identical post-action behavior to real download (hides download button, shows CheckCircle badge on thumbnail).

**Swipe overlay:** The existing invisible overlay that closes the left swipe (covers row when `swipeX < 0`) does NOT cover the right swipe — the mark button is tappable directly.

---

## Interaction Summary

| Platform | Gesture | Result |
|----------|---------|--------|
| Mobile | Swipe right → tap green button | Marks downloaded |
| Desktop | Hover row → click CheckCircle icon | Marks downloaded |
| Both | After mark | Download button hidden, CheckCircle badge on thumbnail |
