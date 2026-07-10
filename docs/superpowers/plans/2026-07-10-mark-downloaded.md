# Mark Song as Downloaded Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a user to manually mark a song as downloaded on their current device — swipe right on mobile, hover button on desktop — without triggering a file download.

**Architecture:** One new backend endpoint writes `device_downloads[device_id].downloaded = True` (same field the real download flow sets). Frontend extends the existing swipe logic to support rightward swipe revealing a green button, and adds a `CheckCircle` hover button on desktop. Both call the same endpoint and reuse `onDownloaded()`.

**Tech Stack:** FastAPI + Python 3.12, React 19, TypeScript strict, Tailwind CSS v4, Phosphor Icons

## Global Constraints

- No new dependencies
- TypeScript strict — no `noUnusedLocals` / `noUnusedParameters` violations
- Tailwind CSS v4 only — use `text-green-500`, `bg-green-500` (no arbitrary values)
- Icon: `CheckCircle` from `@phosphor-icons/react`
- After marking: call `onDownloaded()` — identical post-action to a real download
- No unmark per song (one-way); existing "Clear history" covers bulk undo
- Only these three files may be modified: `api/routers/songs.py`, `web/src/lib/api.ts`, `web/src/components/SongRow.tsx`

---

### Task 1: Backend endpoint

**Files:**
- Modify: `api/routers/songs.py`

**Interfaces:**
- Consumes: nothing from other tasks
- Produces: `POST /api/songs/{song_id}/mark-downloaded` → `{"ok": True}` — consumed by Task 2

**Current imports in `api/routers/songs.py`:**
```python
import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from config import Settings, get_settings
from models import Song
from store import read_songs, write_songs
from routers.auth import get_device_id
```

- [ ] **Step 1: Add missing imports**

`datetime` is needed for `downloaded_at`. `DeviceDownload` is the model written to `device_downloads`. Add both:

```python
import re
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from config import Settings, get_settings
from models import DeviceDownload, Song
from store import read_songs, write_songs
from routers.auth import get_device_id
```

- [ ] **Step 2: Add the endpoint**

Append after the `delete_song` function (end of file):

```python
@router.post("/{song_id}/mark-downloaded")
async def mark_downloaded(
    song_id: str,
    device_id: str = Depends(get_device_id),
    settings: Settings = Depends(get_settings),
):
    data = read_songs(settings.data_dir)
    song = next((s for s in data.songs if s.id == song_id), None)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    dd = song.device_downloads.get(device_id)
    if dd and dd.downloaded:
        return {"ok": True}
    device = next((d for d in data.devices if d.id == device_id), None)
    if device_id not in song.device_downloads:
        song.device_downloads[device_id] = DeviceDownload(name=device.name if device else "Unknown")
    song.device_downloads[device_id].downloaded = True
    song.device_downloads[device_id].downloaded_at = datetime.utcnow()
    write_songs(data, settings.data_dir)
    return {"ok": True}
```

- [ ] **Step 3: Verify Python syntax**

```bash
python -c "import ast; ast.parse(open('api/routers/songs.py').read()); print('ok')"
```

Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add api/routers/songs.py
git commit -m "feat: add POST /api/songs/{id}/mark-downloaded endpoint"
```

---

### Task 2: Frontend — API method + swipe right + hover button

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/components/SongRow.tsx`

**Interfaces:**
- Consumes: `POST /api/songs/{song_id}/mark-downloaded` from Task 1
- Produces: nothing downstream

#### Step-by-step

- [ ] **Step 1: Add `markDownloaded` to `api.ts`**

In `web/src/lib/api.ts`, inside `api.songs`, add after the `delete` line:

```ts
markDownloaded: (id: string) => req<{ ok: boolean }>('POST', `/api/songs/${id}/mark-downloaded`),
```

The full `api.songs` block becomes:

```ts
songs: {
  list: () => req<SongsListResponse>('GET', '/api/songs'),
  add: (url: string, playlist?: string) => req<SongResponse>('POST', '/api/songs', { url, playlist }),
  delete: (id: string) => req<{ ok: boolean }>('DELETE', `/api/songs/${id}`),
  markDownloaded: (id: string) => req<{ ok: boolean }>('POST', `/api/songs/${id}/mark-downloaded`),
},
```

- [ ] **Step 2: Add `CheckCircle` to Phosphor imports in `SongRow.tsx`**

The current import block starts with:
```ts
import {
  ArrowCircleDown,
  Check,
  CheckCircle,
  CircleNotch,
  ...
```

`CheckCircle` is already imported (used for the downloaded badge on the thumbnail). No change needed here — verify it's present before proceeding.

- [ ] **Step 3: Add `MARK_WIDTH` constant**

In `web/src/components/SongRow.tsx`, after the existing constants:

```ts
const DELETE_WIDTH = 64
const SNAP_THRESHOLD = 40
const MOVE_SLOP = 8
const MARK_WIDTH = 64
```

- [ ] **Step 4: Extend `onTouchMove` clamp to allow rightward swipe**

Find this line inside the `onTouchMove` function (inside the `useEffect` that attaches the non-passive listener):

```ts
const newX = Math.max(Math.min(touchStart.current.baseSwipeX + dx, 0), -DELETE_WIDTH)
```

Replace with:

```ts
const newX = Math.max(Math.min(touchStart.current.baseSwipeX + dx, MARK_WIDTH), -DELETE_WIDTH)
```

The upper bound changes from `0` to `MARK_WIDTH`, allowing the row to slide right up to 64 px.

- [ ] **Step 5: Update `handleTouchEnd` snap logic**

Find the existing snap target line inside `handleTouchEnd`:

```ts
const target = swipeXRef.current < -SNAP_THRESHOLD ? -DELETE_WIDTH : 0
```

Replace with:

```ts
const x = swipeXRef.current
const target = x > SNAP_THRESHOLD ? MARK_WIDTH : x < -SNAP_THRESHOLD ? -DELETE_WIDTH : 0
```

Four cases covered:
- `x > SNAP_THRESHOLD` → snap right to mark button
- `x < -SNAP_THRESHOLD` → snap left to delete button
- anything in between → snap back to 0

- [ ] **Step 6: Add `handleMarkDownloaded` function**

Add after `handleDownload`:

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

`setSwipeX(0)` resets the row position immediately before the async call so the UI doesn't stay shifted.

- [ ] **Step 7: Add mark button (mobile, left side)**

Inside the return JSX, in the outermost `<div className="relative overflow-hidden border-b ...">`, add this button **before** the existing delete button:

```tsx
{/* Mobile mark-as-downloaded button — sits behind row content, revealed by swiping right */}
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

Symmetric to the delete button (`right-0`) but on the left. Renders only when `swipeX > 0`.

- [ ] **Step 8: Add hover button (desktop, in actions area)**

Find the actions container in the row content area:

```tsx
{/* Actions */}
<div className="flex items-center gap-2 shrink-0">
  {!isDownloaded && (
    <button
      onClick={handleDownload}
      ...
    >
```

Add the mark hover button **after** the download button block and **before** the desktop delete button:

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

Hidden on mobile (`hidden md:flex`). Only shown when the song is not yet downloaded.

The full actions area becomes:

```tsx
{/* Actions */}
<div className="flex items-center gap-2 shrink-0">
  {!isDownloaded && (
    <button
      onClick={handleDownload}
      disabled={isDisabled}
      className={clsx(
        'flex items-center gap-1 cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
        downloading
          ? 'text-[var(--color-text-muted)]'
          : isDisabled
            ? 'text-[var(--color-text-muted)] opacity-50'
            : 'text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)]',
      )}
    >
      {downloading
        ? <CircleNotch size={14} className="animate-spin" />
        : <ArrowCircleDown size={14} />
      }
      {downloading ? 'Preparing...' : 'Download'}
    </button>
  )}

  {!isDownloaded && (
    <button
      onClick={handleMarkDownloaded}
      className="opacity-0 group-hover:opacity-100 cursor-pointer p-1 rounded text-[var(--color-text-muted)] hover:text-green-500 transition-all hidden md:flex"
      aria-label="Mark as downloaded"
    >
      <CheckCircle size={13} />
    </button>
  )}

  {/* Desktop-only — hidden on mobile (swipe-to-delete handles it there) */}
  <button
    onClick={() => onDelete(song.id)}
    className="opacity-0 group-hover:opacity-100 cursor-pointer p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-all hidden md:flex"
    aria-label="Remove song"
  >
    <X size={13} />
  </button>
</div>
```

- [ ] **Step 9: TypeScript build check**

```bash
cd web && npm run build 2>&1 | tail -20
```

Expected: build completes with no TypeScript errors. Any `error TS` line is a bug — fix before committing.

- [ ] **Step 10: Commit**

```bash
git add web/src/lib/api.ts web/src/components/SongRow.tsx
git commit -m "feat: mark song as downloaded — swipe right (mobile) + hover button (desktop)"
```
