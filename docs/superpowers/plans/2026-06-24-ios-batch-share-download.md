# iOS Batch Download via Web Share API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tap-per-song iOS batch download with a Web Share API flow — user taps once to prepare, once to save all songs to Files (2 taps total for any batch size).

**Architecture:** `useBatchDownload` gains a `mode` option (`'auto' | 'tap-per-song' | 'share'`). In `'share'` mode, after server-side prepare it fetches all MP3 bytes into browser memory, then enters `awaitingShare` state. The user's tap calls `shareAll()` which synchronously invokes `navigator.share({ files })` — no `await` before the call, so iOS gesture chain is intact. `SelectionBar` renders a "Save N songs to Files" button when `awaitingShare` is true. `App.tsx` computes the mode from `canShareFiles` capability detection.

**Tech Stack:** React 19, TypeScript strict, Tailwind CSS v4

## Global Constraints

- No new npm dependencies
- TypeScript strict mode — zero `tsc --noEmit` errors required
- No backend changes
- Desktop batch download behavior must be identical to today (auto-loop)
- Tap-per-song fallback preserved for iOS without Web Share API support
- TypeScript check: `cd /home/ttndev/workspace/personal/music-assistant/web && npx tsc --noEmit`

---

### Task 1: iOS Batch Share Download

**Files:**
- Modify: `web/src/hooks/useBatchDownload.ts`
- Modify: `web/src/components/SelectionBar.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- `useBatchDownload` new option: `mode?: 'auto' | 'tap-per-song' | 'share'` (replaces `manual?: boolean`)
- `useBatchDownload` new return values: `shareAll: () => void`, `awaitingShare: boolean`
- `SelectionBar` new props: `awaitingShare: boolean`, `shareAll: () => void`

---

- [ ] **Step 1: Replace `web/src/hooks/useBatchDownload.ts`**

```ts
import { useState, useCallback, useRef } from 'react'
import { api } from '../lib/api'

interface Progress {
  current: number
  total: number
}

export interface UseBatchDownloadReturn {
  downloadBatch: (songIds: string[]) => Promise<void>
  downloadNext: () => void
  shareAll: () => void
  cancel: () => void
  progress: Progress | null
  isRunning: boolean
  awaitingGesture: boolean
  awaitingShare: boolean
}

interface Options {
  onSongDownloaded?: (id: string) => void
  onComplete?: (downloaded: number, failed: number) => void
  mode?: 'auto' | 'tap-per-song' | 'share'
}

async function fetchBlob(songId: string): Promise<{ id: string; blob: Blob; filename: string }> {
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

export function useBatchDownload({ onSongDownloaded, onComplete, mode = 'auto' }: Options): UseBatchDownloadReturn {
  const [progress, setProgress] = useState<Progress | null>(null)
  const [awaitingGesture, setAwaitingGesture] = useState(false)
  const [awaitingShare, setAwaitingShare] = useState(false)

  const runningRef = useRef(false)
  const cancelledRef = useRef(false)
  const awaitingGestureRef = useRef(false)
  const awaitingShareRef = useRef(false)
  const pendingIdsRef = useRef<string[]>([])
  const pendingFilesRef = useRef<{ id: string; blob: Blob; filename: string }[]>([])
  const failedCountRef = useRef(0)
  const downloadedCountRef = useRef(0)
  const currentIndexRef = useRef(0)

  // Only uses refs and stable state setters — safe to call from any memoized callback
  function resetState() {
    runningRef.current = false
    cancelledRef.current = false
    awaitingGestureRef.current = false
    awaitingShareRef.current = false
    pendingIdsRef.current = []
    pendingFilesRef.current = []
    failedCountRef.current = 0
    downloadedCountRef.current = 0
    currentIndexRef.current = 0
    setProgress(null)
    setAwaitingGesture(false)
    setAwaitingShare(false)
  }

  const cancel = useCallback(() => {
    cancelledRef.current = true
    if (awaitingGestureRef.current || awaitingShareRef.current) {
      // Not in an async loop — reset immediately without calling onComplete
      resetState()
    }
    // Auto mode: the running loop checks cancelledRef and resets itself
  }, [])

  const downloadNext = useCallback(() => {
    if (!awaitingGestureRef.current || cancelledRef.current) return
    const ids = pendingIdsRef.current
    const index = currentIndexRef.current
    if (index >= ids.length) return

    // Synchronous — no await between user tap and file() call, preserving iOS gesture chain
    api.download.file(ids[index])
    downloadedCountRef.current++
    onSongDownloaded?.(ids[index])

    const next = index + 1
    currentIndexRef.current = next
    setProgress({ current: next, total: ids.length })

    if (next >= ids.length) {
      const downloaded = downloadedCountRef.current
      resetState()
      onComplete?.(downloaded, 0)
    }
  }, [onSongDownloaded, onComplete])

  const shareAll = useCallback(() => {
    if (!awaitingShareRef.current || cancelledRef.current) return
    const files = pendingFilesRef.current.map(
      ({ blob, filename }) => new File([blob], filename, { type: 'audio/mpeg' }),
    )
    const downloaded = files.length
    const failed = failedCountRef.current
    const ids = pendingFilesRef.current.map(f => f.id)

    // Synchronous call — no await before navigator.share(), preserving iOS gesture chain
    navigator
      .share({ files })
      .then(() => {
        ids.forEach(id => onSongDownloaded?.(id))
        resetState()
        onComplete?.(downloaded, failed)
      })
      .catch((err: unknown) => {
        // AbortError = user dismissed the share sheet — stay in awaitingShare so they can retry
        if (err instanceof Error && err.name === 'AbortError') return
        resetState()
        onComplete?.(0, downloaded + failed)
      })
  }, [onSongDownloaded, onComplete])

  const downloadBatch = useCallback(
    async (songIds: string[]) => {
      if (songIds.length === 0 || runningRef.current) return
      runningRef.current = true
      cancelledRef.current = false
      downloadedCountRef.current = 0
      currentIndexRef.current = 0
      failedCountRef.current = 0
      setProgress({ current: 0, total: songIds.length })

      // Prepare all songs on the server in parallel
      await Promise.allSettled(songIds.map(id => api.download.prepare(id)))

      if (cancelledRef.current) {
        resetState()
        return
      }

      if (mode === 'share') {
        // iOS Web Share API: fetch all MP3 bytes to browser memory, then share all at once
        const results = await Promise.allSettled(songIds.map(id => fetchBlob(id)))
        if (cancelledRef.current) {
          resetState()
          return
        }
        const successful = results
          .filter((r): r is PromiseFulfilledResult<{ id: string; blob: Blob; filename: string }> => r.status === 'fulfilled')
          .map(r => r.value)
        failedCountRef.current = results.length - successful.length
        if (successful.length === 0) {
          resetState()
          onComplete?.(0, songIds.length)
          return
        }
        pendingFilesRef.current = successful
        setProgress({ current: 0, total: successful.length })
        awaitingShareRef.current = true
        setAwaitingShare(true)
        return
      }

      if (mode === 'tap-per-song') {
        // iOS fallback: pause and let the user tap once per song
        pendingIdsRef.current = songIds
        awaitingGestureRef.current = true
        setAwaitingGesture(true)
        return
      }

      // Desktop auto mode: download all songs sequentially
      let downloaded = 0
      let failed = 0

      for (let i = 0; i < songIds.length; i++) {
        if (cancelledRef.current) break
        try {
          api.download.file(songIds[i])
          downloaded++
          onSongDownloaded?.(songIds[i])
        } catch {
          failed++
        }
        setProgress({ current: i + 1, total: songIds.length })
        if (i < songIds.length - 1) {
          await new Promise<void>(resolve => setTimeout(resolve, 800))
        }
      }

      const wasCancelled = cancelledRef.current
      resetState()
      if (!wasCancelled) onComplete?.(downloaded, failed)
    },
    [onSongDownloaded, onComplete, mode],
  )

  return {
    downloadBatch,
    downloadNext,
    shareAll,
    cancel,
    progress,
    isRunning: progress !== null,
    awaitingGesture,
    awaitingShare,
  }
}
```

---

- [ ] **Step 2: Replace `web/src/components/SelectionBar.tsx`**

```tsx
import { ArrowCircleDown, X, StopCircle, CircleNotch, ShareNetwork } from '@phosphor-icons/react'

interface Props {
  selected: Set<string>
  isSelectMode: boolean
  isRunning: boolean
  progress: { current: number; total: number } | null
  filteredUndownloadedIds: string[]
  awaitingGesture: boolean
  awaitingShare: boolean
  onDownloadSelected: () => void
  onSelectAllUndownloaded: () => void
  onClearAll: () => void
  onCancel: () => void
  onCancelDownload: () => void
  downloadNext: () => void
  shareAll: () => void
}

export function SelectionBar({
  selected,
  isSelectMode,
  isRunning,
  progress,
  filteredUndownloadedIds,
  awaitingGesture,
  awaitingShare,
  onDownloadSelected,
  onSelectAllUndownloaded,
  onClearAll,
  onCancel,
  onCancelDownload,
  downloadNext,
  shareAll,
}: Props) {
  if (selected.size === 0 && !isSelectMode) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-20 border-t border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur-sm">
      <div className="flex items-center gap-2 max-w-2xl mx-auto px-4 py-3 flex-wrap">
        {awaitingShare && progress ? (
          <>
            <button
              onClick={shareAll}
              className="flex-1 flex items-center justify-center gap-1.5 cursor-pointer rounded-lg bg-[var(--color-accent)] text-white px-3 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <ShareNetwork size={15} />
              Save {progress.total} song{progress.total !== 1 ? 's' : ''} to Files
            </button>
            <button
              onClick={onCancelDownload}
              className="flex items-center gap-1.5 cursor-pointer rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:border-[var(--color-error)] transition-colors"
            >
              <StopCircle size={14} />
              Cancel
            </button>
          </>
        ) : awaitingGesture && progress ? (
          <>
            <button
              onClick={downloadNext}
              className="flex-1 flex items-center justify-center gap-1.5 cursor-pointer rounded-lg bg-[var(--color-accent)] text-white px-3 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
            >
              <ArrowCircleDown size={15} />
              Tap to download ({progress.current + 1} of {progress.total})
            </button>
            <button
              onClick={onCancelDownload}
              className="flex items-center gap-1.5 cursor-pointer rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:border-[var(--color-error)] transition-colors"
            >
              <StopCircle size={14} />
              Cancel
            </button>
          </>
        ) : isRunning && progress ? (
          <>
            <span className="flex-1 flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
              {progress.current === 0 && (
                <CircleNotch size={15} className="animate-spin shrink-0" />
              )}
              {progress.current === 0
                ? `Preparing ${progress.total} song${progress.total !== 1 ? 's' : ''}…`
                : `Downloading ${progress.current} of ${progress.total}…`}
            </span>
            <button
              onClick={onCancelDownload}
              className="flex items-center gap-1.5 cursor-pointer rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-error)] hover:border-[var(--color-error)] transition-colors"
            >
              <StopCircle size={14} />
              Cancel
            </button>
          </>
        ) : selected.size > 0 ? (
          <button
            onClick={onDownloadSelected}
            className="flex items-center gap-1.5 cursor-pointer rounded-lg bg-[var(--color-accent)] text-white px-3 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <ArrowCircleDown size={15} />
            Download {selected.size} song{selected.size !== 1 ? 's' : ''}
          </button>
        ) : null}

        {!isRunning && !awaitingGesture && !awaitingShare && filteredUndownloadedIds.length > 0 && (
          <button
            onClick={onSelectAllUndownloaded}
            className="cursor-pointer rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
          >
            {selected.size > 0 ? 'Select All' : 'Select All Undownloaded'}
          </button>
        )}

        {selected.size > 0 && !isRunning && !awaitingGesture && !awaitingShare && (
          <button
            onClick={onClearAll}
            className="cursor-pointer rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Clear
          </button>
        )}

        {/* Mobile-only cancel button — exits select mode and clears selection */}
        <button
          onClick={onCancel}
          className="md:hidden ml-auto cursor-pointer p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          aria-label="Cancel selection"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
```

---

- [ ] **Step 3: Update `web/src/App.tsx`**

Two targeted edits — no other lines change.

**Edit A:** Replace the `isIOS` line and `useBatchDownload` call (currently lines 52–63).

Old:
```ts
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
  const { downloadBatch, downloadNext, cancel: cancelDownload, progress, isRunning, awaitingGesture } = useBatchDownload({
    manual: isIOS,
    onSongDownloaded: (id) => setJustDownloaded(prev => new Set([...prev, id])),
    onComplete: (downloaded, failed) => {
      refetch()
      exitSelectMode()
      setJustDownloaded(new Set())
      if (downloaded > 0) toast.success(`Downloaded ${downloaded} song${downloaded !== 1 ? 's' : ''}`)
      if (failed > 0) toast.error(`${failed} song${failed !== 1 ? 's' : ''} failed to download`)
    },
  })
```

New:
```ts
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
  const canShareFiles = isIOS &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [new File([], 'test.mp3', { type: 'audio/mpeg' })] })
  const batchMode = canShareFiles ? 'share' : isIOS ? 'tap-per-song' : 'auto'

  const { downloadBatch, downloadNext, shareAll, cancel: cancelDownload, progress, isRunning, awaitingGesture, awaitingShare } = useBatchDownload({
    mode: batchMode,
    onSongDownloaded: (id) => setJustDownloaded(prev => new Set([...prev, id])),
    onComplete: (downloaded, failed) => {
      refetch()
      exitSelectMode()
      setJustDownloaded(new Set())
      if (downloaded > 0) toast.success(`Downloaded ${downloaded} song${downloaded !== 1 ? 's' : ''}`)
      if (failed > 0) toast.error(`${failed} song${failed !== 1 ? 's' : ''} failed to download`)
    },
  })
```

**Edit B:** Replace the `<SelectionBar>` block (currently lines 143–156).

Old:
```tsx
      <SelectionBar
        selected={selected}
        isSelectMode={isSelectMode}
        isRunning={isRunning}
        progress={progress}
        filteredUndownloadedIds={filteredUndownloadedIds}
        awaitingGesture={awaitingGesture}
        onDownloadSelected={handleDownloadSelected}
        onSelectAllUndownloaded={handleSelectAllUndownloaded}
        onClearAll={clearAll}
        onCancel={exitSelectMode}
        onCancelDownload={cancelDownload}
        downloadNext={downloadNext}
      />
```

New:
```tsx
      <SelectionBar
        selected={selected}
        isSelectMode={isSelectMode}
        isRunning={isRunning}
        progress={progress}
        filteredUndownloadedIds={filteredUndownloadedIds}
        awaitingGesture={awaitingGesture}
        awaitingShare={awaitingShare}
        onDownloadSelected={handleDownloadSelected}
        onSelectAllUndownloaded={handleSelectAllUndownloaded}
        onClearAll={clearAll}
        onCancel={exitSelectMode}
        onCancelDownload={cancelDownload}
        downloadNext={downloadNext}
        shareAll={shareAll}
      />
```

---

- [ ] **Step 4: TypeScript check**

```bash
cd /home/ttndev/workspace/personal/music-assistant/web && npx tsc --noEmit
```

Expected: zero output (zero errors).

Common failures and fixes:
- `Property 'canShare' does not exist on type 'Navigator'` → replace `navigator.canShare` with `(navigator as Navigator & { canShare?: (d: ShareData) => boolean }).canShare`
- `Property 'shareAll' does not exist on type 'UseBatchDownloadReturn'` → Step 1 not applied correctly
- `Property 'awaitingShare' does not exist on type 'IntrinsicAttributes & Props'` → Step 2 or 3 not applied
- `Argument of type '"share" | "tap-per-song" | "auto"'` mismatch → the `mode` prop type in `Options` must match exactly

---

- [ ] **Step 5: Build and deploy**

```bash
cd /home/ttndev/workspace/personal/music-assistant && docker compose build --quiet && docker compose up -d
```

Expected:
```
Container music-assistant-app-1 Started
```

---

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/useBatchDownload.ts web/src/components/SelectionBar.tsx web/src/App.tsx
git commit -m "feat: iOS batch download via Web Share API — 2 taps for any batch size"
```

---

- [ ] **Step 7: Ask user to verify on iPhone**

No automated tests. Ask the user to verify:

1. **iOS Safari — batch share flow** — select 3 songs → tap "Download 3 songs" → "Preparing 3 songs…" spinner appears → then "Save 3 songs to Files" button appears → tap → iOS Share Sheet opens with all 3 MP3 files attached → tap "Save to Files" in the sheet → all 3 songs appear in Files app → app shows toast "Downloaded 3 songs"
2. **iOS Safari — cancel during prepare** — tap "Download 3 songs", tap Cancel during "Preparing…" → SelectionBar clears, no files downloaded
3. **iOS Safari — cancel share sheet** — tap "Save 3 songs to Files", dismiss the iOS Share Sheet (swipe down or tap Cancel in the sheet) → "Save 3 songs to Files" button reappears (retry allowed)
4. **iOS Safari — cancel after share sheet dismissed** — after retrying once, tap the SelectionBar Cancel button → SelectionBar clears entirely
5. **Desktop Chrome — batch download** — select 3 songs → all 3 download automatically without any tap-per-song or share sheet (auto-loop unchanged)
6. **Single song download** — unchanged on both platforms
