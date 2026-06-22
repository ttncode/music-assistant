# iOS Batch Download Fix — Design Spec

**Date:** 2026-06-23

---

## Problem

On iOS Safari, batch-downloading multiple songs shows one confirmation popup per song (iOS asks the user to approve each anchor click), but only the last song actually downloads. Single-song download works correctly.

**Root cause:** `useBatchDownload` calls `await Promise.allSettled(songIds.map(id => api.download.prepare(id)))` before looping through `api.download.file()` calls. The `await` breaks iOS Safari's user gesture chain. Each subsequent `a.click()` is treated as a programmatic (non-gesture) navigation, so iOS shows a popup but each new navigation cancels the previous download. Only the final one survives.

On desktop (Chrome/Firefox), this is not an issue because those browsers are permissive about programmatic anchor clicks.

---

## Solution

Two-phase batch download on iOS. Desktop behavior is unchanged.

### Phase 1 — Prepare (async, triggered by the initial "Download N songs" tap)

When the user taps "Download N songs" on iOS:
- Call `api.download.prepare(id)` for all selected songs in parallel (`Promise.allSettled`)
- While preparing, SelectionBar shows "Preparing…" with a Cancel button
- Once all songs are prepared, set `awaitingGesture = true`

### Phase 2 — Tap per song (synchronous, one download per user tap)

Once prepared, SelectionBar replaces the progress text with a tap button:

> **"Tap to download (1 of 3) ▼"**

Each button tap calls `downloadNext()`, which synchronously calls `api.download.file(currentId)` — no `await`, no async gap. The user gesture → `downloadNext()` → `a.click()` chain is unbroken, so iOS Safari honours the download without a confirmation popup.

After each tap:
- `onSongDownloaded(id)` fires
- Progress advances: "Tap to download (2 of 3) ▼"
- When the last song is done, `onComplete()` fires and the SelectionBar disappears

The user taps once per song. For 3 songs: 1 tap to kick off preparing + 3 taps to download = 4 taps total. On desktop: 1 tap, automatic.

---

## iOS Detection

```ts
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
```

Evaluated once at app load in `App.tsx`. Passed as `manual: isIOS` to `useBatchDownload`.

---

## `useBatchDownload` Changes

New option:
```ts
interface Options {
  onSongDownloaded?: (id: string) => void
  onComplete?: (downloaded: number, failed: number) => void
  manual?: boolean  // if true, pause after prepare and wait for downloadNext() calls
}
```

New return values:
```ts
interface UseBatchDownloadReturn {
  downloadBatch: (songIds: string[]) => Promise<void>
  downloadNext: () => void   // synchronously downloads current song and advances
  cancel: () => void
  progress: Progress | null
  isRunning: boolean
  awaitingGesture: boolean   // true when prepared, waiting for user taps
}
```

State machine:
- **Idle:** `isRunning: false`, `awaitingGesture: false`
- **Preparing (manual mode):** `isRunning: true`, `awaitingGesture: false` — prepare all songs in parallel
- **Awaiting gesture:** `isRunning: true`, `awaitingGesture: true` — ready for user taps
- **Auto loop (non-manual):** `isRunning: true`, `awaitingGesture: false` — existing desktop behavior

`downloadNext()` implementation:
- Reads current index from a `useRef`
- Calls `api.download.file(ids[index])` synchronously
- Calls `onSongDownloaded(ids[index])`
- Advances index ref
- Updates progress state
- If more songs remain: stays in `awaitingGesture: true`
- If all done: calls `onComplete(downloaded, 0)`, resets all state

`cancel()` works the same in both modes — resets state and calls `onComplete` with the partial count if in manual mode.

---

## `SelectionBar` Changes

New props:
```ts
awaitingGesture: boolean
downloadNext: () => void
```

When `awaitingGesture && progress` (`isRunning` remains true throughout):

UI when `awaitingGesture && progress`:

```
[ Tap to download (N of M) ▼ ]   [ Cancel ]
```

- "Tap to download (N of M) ▼" is a full-width accent button that calls `downloadNext()`
- "Cancel" (X icon) calls `onCancel` as usual

UI during preparing phase (manual mode, `isRunning && !awaitingGesture && progress`):

```
Preparing (N of M)...   [ Cancel ]
```

This replaces the existing "Downloading N of M..." text — same layout, different copy.

UI during auto-download (desktop, `isRunning && !awaitingGesture && progress`):

```
Downloading N of M...   [ Cancel ]
```

Existing behavior unchanged.

---

## `App.tsx` Changes

```ts
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)

const { downloadBatch, downloadNext, cancel: cancelDownload, progress, isRunning, awaitingGesture } = useBatchDownload({
  manual: isIOS,
  onSongDownloaded: ...,
  onComplete: ...,
})
```

Pass `awaitingGesture` and `downloadNext` to `SelectionBar`.

---

## Files Changed

| File | Change |
|---|---|
| `web/src/hooks/useBatchDownload.ts` | Add `manual` option, `awaitingGesture` state, `downloadNext()`, `pendingIds` ref |
| `web/src/components/SelectionBar.tsx` | Add `awaitingGesture` + `downloadNext` props, show tap-per-song button |
| `web/src/App.tsx` | Detect iOS, pass `manual: isIOS` + new props to SelectionBar |

No backend changes. No new dependencies.

---

## Testing

No automated tests (frontend interaction tests are out of scope per project convention).

Manual verification:
1. **iOS Safari — batch download** — select 3 songs, tap "Download 3 songs" → "Preparing…" appears → then "Tap to download (1 of 3) ▼" → tap → iOS downloads without popup → "Tap to download (2 of 3) ▼" → tap → etc. → all 3 songs in Files app
2. **iOS Safari — cancel during prepare** — tap "Download 3 songs", immediately tap Cancel → no downloads, selection preserved
3. **iOS Safari — cancel during tap phase** — tap through 1 of 3, then Cancel → 1 downloaded, selection cleared
4. **iOS Safari — single song download** — unchanged, still works
5. **Desktop Chrome/Firefox — batch download** — unchanged automatic behavior, no tap-per-song
6. **Desktop Chrome/Firefox — cancel** — existing cancel behavior unchanged
