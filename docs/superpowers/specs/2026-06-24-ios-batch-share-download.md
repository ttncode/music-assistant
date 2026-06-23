# iOS Batch Download via Web Share API — Design Spec

**Date:** 2026-06-24

---

## Problem

The current iOS batch download requires one tap per song ("Tap to download (1 of N) ▼"). For 3 songs that means 4 taps total (1 to start + 3 to download). The user wants fewer than 3 taps for any batch size.

---

## Solution

Use the Web Share API (`navigator.share({ files })`) to hand all pre-fetched MP3 files to iOS at once. The flow becomes:

1. Tap "Download N songs" → prepare phase begins
2. Server prepares songs + app fetches MP3 bytes to browser memory (combined "Preparing…" phase)
3. Tap "Save N songs to Files ↗" → iOS Share Sheet opens with all files attached
4. Tap "Save to Files" in the Share Sheet → all N songs saved

**Total: 2 taps** (+ 1 action inside the Share Sheet) for any batch size.

Desktop auto-loop behavior is unchanged. The tap-per-song flow is kept as a fallback for iOS devices without Web Share API support.

---

## Detection

Capability-based detection replaces the `isIOS` user-agent check:

```ts
const canShareFiles =
  'share' in navigator &&
  'canShare' in navigator &&
  navigator.canShare({ files: [new File([], 'test.mp3', { type: 'audio/mpeg' })] })
```

**Mode selection in `App.tsx`:**

```ts
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
const canShareFiles = isIOS &&
  'share' in navigator &&
  'canShare' in navigator &&
  navigator.canShare({ files: [new File([], 'test.mp3', { type: 'audio/mpeg' })] })

const batchMode: 'auto' | 'tap-per-song' | 'share' =
  canShareFiles ? 'share' : isIOS ? 'tap-per-song' : 'auto'
```

| Condition | Mode | Behaviour |
|---|---|---|
| `canShareFiles` (iOS 15+ Safari) | `'share'` | Pre-fetch blobs → share all at once |
| iOS, no Share API | `'tap-per-song'` | Existing tap-per-song fallback |
| Desktop | `'auto'` | Existing auto-loop |

---

## `useBatchDownload` Changes

### Options

Replace `manual?: boolean` with `mode?: 'auto' | 'tap-per-song' | 'share'` (default `'auto'`).

### Return type additions

```ts
export interface UseBatchDownloadReturn {
  downloadBatch: (songIds: string[]) => Promise<void>
  downloadNext: () => void          // tap-per-song (unchanged)
  shareAll: () => void              // NEW: triggers navigator.share()
  cancel: () => void
  progress: Progress | null
  isRunning: boolean
  awaitingGesture: boolean          // tap-per-song mode (unchanged)
  awaitingShare: boolean            // NEW: share mode, blobs ready
}
```

### Internal additions

```ts
const pendingFilesRef = useRef<{ id: string; blob: Blob; filename: string }[]>([])
const awaitingShareRef = useRef(false)  // mirror for cancel() stale closure
const failedCountRef = useRef(0)
```

### State machine

| State | `isRunning` | `awaitingGesture` | `awaitingShare` |
|---|---|---|---|
| Idle | false | false | false |
| Preparing (all modes) | true | false | false |
| Awaiting share | true | false | true |
| Awaiting gesture (tap-per-song) | true | true | false |
| Auto-loop (desktop) | true | false | false |

### Blob fetch helper (inside the hook file)

```ts
async function fetchBlob(
  songId: string,
): Promise<{ id: string; blob: Blob; filename: string }> {
  const url = api.download.url(songId)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') ?? ''
  const match5987 = disposition.match(/filename\*=UTF-8''([^\s;]+)/i)
  const matchQuoted = disposition.match(/filename="(.+?)"/)
  const filename = match5987
    ? decodeURIComponent(match5987[1])
    : (matchQuoted?.[1] ?? `song-${songId}.mp3`)
  return { id: songId, blob, filename }
}
```

### `downloadBatch` flow for `mode === 'share'`

```
1. Reset state, setProgress({ current: 0, total: N })
2. await Promise.allSettled(songIds.map(id => api.download.prepare(id)))
3. if cancelled → reset, return
4. await Promise.allSettled(songIds.map(id => fetchBlob(id)))
   - filter to fulfilled results → pendingFilesRef.current
   - count rejections → failedCountRef
5. if 0 successful → reset, onComplete(0, N), return
6. setProgress({ current: 0, total: pendingFilesRef.current.length })
7. awaitingShareRef.current = true; setAwaitingShare(true)
```

### `shareAll()`

Must be called directly in a user tap handler (no `await` before the call):

```ts
const shareAll = useCallback(() => {
  if (!awaitingShareRef.current || cancelledRef.current) return
  const files = pendingFilesRef.current.map(
    ({ blob, filename }) => new File([blob], filename, { type: 'audio/mpeg' }),
  )
  const downloaded = files.length
  const failed = failedCountRef.current

  navigator
    .share({ files })
    .then(() => {
      files.forEach((_, i) => onSongDownloaded?.(pendingFilesRef.current[i].id))
      resetState()
      onComplete?.(downloaded, failed)
    })
    .catch((err: unknown) => {
      if (err instanceof Error && err.name === 'AbortError') return // user cancelled share sheet — stay in awaitingShare so they can retry
      resetState()
      onComplete?.(0, downloaded + failed)
    })
}, [onSongDownloaded, onComplete])
```

> **Note on `onSongDownloaded`:** The share API doesn't confirm per-file delivery, so all songs are marked downloaded when the share promise resolves (user tapped "Save to Files"). This matches the existing desktop behavior where `api.download.file()` also has no per-file completion callback.

### `cancel()` update

When `awaitingShareRef.current` is true, reset immediately (same pattern as existing `awaitingGesture` cancel path):

```ts
if (awaitingShareRef.current) {
  resetState()  // clears blobs, resets all refs/state
}
```

### `resetState()` helper (internal)

Extract repeated reset logic into a shared internal function:

```ts
function resetState() {
  runningRef.current = false
  cancelledRef.current = false
  awaitingGestureRef.current = false
  awaitingShareRef.current = false
  pendingFilesRef.current = []
  failedCountRef.current = 0   // reset alongside pendingFilesRef
  downloadedCountRef.current = 0
  currentIndexRef.current = 0
  setProgress(null)
  setAwaitingGesture(false)
  setAwaitingShare(false)
}
```

---

## `SelectionBar` Changes

### New props

```ts
awaitingShare: boolean
shareAll: () => void
```

### New UI state (when `awaitingShare && progress`)

```
[ Save {progress.total} songs to Files ↗ ]   [ Cancel ]
```

- Full-width accent button, calls `shareAll()`
- Uses `Share` icon from `@phosphor-icons/react`
- Cancel calls `onCancelDownload()`

The existing `awaitingGesture` button and `isRunning` text are unchanged.

---

## `App.tsx` Changes

1. Replace `const isIOS = ...` with `isIOS` + `canShareFiles` + `batchMode` (see Detection section)
2. Replace `manual: isIOS` with `mode: batchMode` in `useBatchDownload` call
3. Destructure `shareAll` and `awaitingShare` from the hook
4. Pass `awaitingShare` and `shareAll` to `<SelectionBar>`

---

## Files Changed

| File | Change |
|---|---|
| `web/src/hooks/useBatchDownload.ts` | Replace `manual` with `mode`, add `awaitingShare`, `shareAll`, blob fetch logic, `resetState` helper |
| `web/src/components/SelectionBar.tsx` | Add `awaitingShare` + `shareAll` props, "Save N songs to Files" button |
| `web/src/App.tsx` | Detection logic, pass new props |

No backend changes. No new npm dependencies.

---

## Testing

1. **iOS Safari — batch download (share flow)** — select 3 songs → "Download 3 songs" → "Preparing 3 songs…" → "Save 3 songs to Files ↗" appears → tap → iOS Share Sheet opens with 3 MP3 files → "Save to Files" → all 3 in Files app, toast "Downloaded 3 songs"
2. **iOS Safari — cancel during prepare** — tap "Download 3 songs", tap Cancel during "Preparing…" → no downloads, SelectionBar clears
3. **iOS Safari — cancel share sheet** — tap "Save 3 songs to Files ↗", dismiss iOS Share Sheet without saving → "Save 3 songs to Files ↗" button reappears (retry allowed)
4. **iOS Safari — cancel after share sheet dismissed** — tap Cancel on the SelectionBar → SelectionBar clears, no songs downloaded
5. **Desktop Chrome — batch download** — select 3 songs → all download automatically (auto-loop unchanged)
6. **Single song download** — unchanged on both platforms
