# Batch Download + Provider Status Design

**Date:** 2026-06-18

## Goal

Three enhancements to the Music Assistant app:
1. Multi-select songs and batch download them
2. "Download all undownloaded" shortcut for the current view
3. Provider connection status indicators in the header (YouTube + SoundCloud)

---

## Feature 1: Multi-select + Batch Download

### Selection State

A new `useSelection` hook manages all selection state:

```typescript
interface UseSelectionReturn {
  selected: Set<string>           // song IDs currently selected
  isSelectMode: boolean           // mobile: whether selection mode is active
  toggle: (id: string) => void
  selectAll: (ids: string[]) => void
  clearAll: () => void
  enterSelectMode: () => void     // mobile only
  exitSelectMode: () => void      // mobile only — also clears selection
}
```

### Responsive Behaviour

| Breakpoint | Checkbox visibility | Enter selection mode |
|---|---|---|
| `< md` (mobile) | Hidden until `isSelectMode === true` | "Select" button in FilterBar |
| `md:+` (desktop) | Always visible on left of each row | N/A — always active |

### SongRow Changes

Two new optional props:
- `selected?: boolean` — whether this row is checked
- `onToggle?: (id: string) => void` — called when checkbox changes

Checkbox rendered as a 16×16 square on the left of the row. On desktop it is always shown. On mobile it is conditionally rendered based on `isSelectMode` passed down from `SongList`.

### FilterBar Changes

A "Select" button added to the right of the playlist pills row — **visible only below `md:`** (hidden on desktop via `md:hidden`). Calls `enterSelectMode()`.

### SelectionBar (new component)

A sticky bottom bar (`fixed bottom-0`) that appears when:
- Desktop: `selected.size > 0`
- Mobile: `isSelectMode === true`

Contents:
```
[ Select All Undownloaded ]  [ Cancel ]      ← when nothing selected (mobile)
[ Download 3 songs ]  [ Select All ]  [ Cancel ]  ← when songs selected
```

- **"Download X songs"** — triggers batch download for all selected song IDs
- **"Select All Undownloaded"** — calls `selectAll(undownloadedIds)` for the current filtered view (this is also feature 2's "Download All")
- **"Cancel"** — calls `exitSelectMode()` on mobile; calls `clearAll()` on desktop
- Shows a progress label while downloading: `Downloading 2 of 5...`

### useBatchDownload Hook

```typescript
interface UseBatchDownloadReturn {
  downloadBatch: (songIds: string[]) => void
  progress: { current: number; total: number } | null
  isRunning: boolean
}
```

Algorithm:
1. Fire all `POST /api/download/{id}/prepare` calls in parallel (server starts fetching all songs at once in the background).
2. Serve downloads sequentially: for each song ID, click an `<a href="/api/download/{id}?device_id=...">` with 800ms gap between each. This avoids browsers blocking multiple simultaneous downloads.
3. Call `onComplete` (refetch) after all downloads are served.

---

## Feature 2: Download All Undownloaded

This is not a separate endpoint — it is implemented entirely in the frontend as a shortcut:

1. From the current filtered song list, collect all song IDs where `downloaded === false`.
2. Call `selectAll(undownloadedIds)` to select them.
3. Immediately trigger `downloadBatch(undownloadedIds)`.

The "Select All Undownloaded" button in `SelectionBar` handles this in one tap. No backend changes needed.

---

## Feature 3: Provider Connection Status

### Backend — New Endpoint

`GET /api/status/providers` — no auth required (called on app load before device registration).

Response shape:
```json
{
  "youtube": {
    "configured": true,
    "reachable": true,
    "error": null
  },
  "soundcloud": {
    "configured": true,
    "reachable": true,
    "error": null
  }
}
```

**YouTube check:**
- `configured`: `youtube_api_key` and `youtube_channel_id` both non-empty in settings.
- `reachable`: if configured, calls `GET https://www.googleapis.com/youtube/v3/channels?key={key}&id={channel_id}&part=id&maxResults=1` with `timeout=5s`. Returns `reachable: true` if HTTP 200 with non-empty `items`. Otherwise `reachable: false, error: <message>`.
- If not configured: `reachable: false, error: "Not configured"`.

**SoundCloud check:**
- `configured`: `soundcloud_profile_url` non-empty in settings.
- `reachable`: if configured, sends `httpx.get(soundcloud_profile_url, follow_redirects=True, timeout=5)`. Returns `reachable: true` if HTTP 200. Otherwise `reachable: false, error: <HTTP status or connection error>`.
- If not configured: `reachable: false, error: "Not configured"`.

Both checks run concurrently via `asyncio.gather`.

### Frontend

**`api.providers.status()`** — `GET /api/status/providers`, no `X-Device-ID` header needed (public endpoint).

**`useProviderStatus` hook:**
- Fetches on mount.
- Re-fetches after every sync completes (passed as `onSyncComplete` callback chain).
- Returns `{ youtube, soundcloud, loading }`.

**Header changes:**
- Two small status dots added between the app title and the Sync button.
- Each dot: platform icon (`YoutubeLogo` / `SoundcloudLogo`, size 13) + 6px colored circle:
  - Green `#10b981` — configured and reachable
  - Amber `#f59e0b` — configured but unreachable (API key wrong, network error, etc.)
  - Gray `var(--color-text-muted)` — not configured
- On hover/focus: a small tooltip (`title` attribute or a CSS tooltip) shows the error string if `reachable === false`.

---

## Files Changed

### New
- `api/routers/status.py` — `GET /api/status/providers`
- `web/src/hooks/useSelection.ts`
- `web/src/hooks/useBatchDownload.ts`
- `web/src/hooks/useProviderStatus.ts`
- `web/src/components/SelectionBar.tsx`

### Modified
- `api/main.py` — include status router
- `web/src/lib/api.ts` — add `api.providers.status()`
- `web/src/components/SongRow.tsx` — add checkbox + selection props
- `web/src/components/SongList.tsx` — pass `isSelectMode` + selection callbacks down
- `web/src/components/FilterBar.tsx` — add mobile "Select" button
- `web/src/components/Header.tsx` — add provider status dots + `useProviderStatus`
- `web/src/App.tsx` — wire `useSelection`, `useBatchDownload`, `useProviderStatus`

---

## Non-Goals

- No server-side batch download endpoint (all batching is frontend-only)
- No SoundCloud deep validation (only HTTP 200 check on profile URL)
- No per-song download progress percentage (yt-dlp progress hooks not wired)
- No download queue persistence (queue lost on page refresh)
