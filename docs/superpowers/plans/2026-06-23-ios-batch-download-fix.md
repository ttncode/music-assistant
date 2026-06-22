# iOS Batch Download Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix iOS Safari batch downloads so every selected song downloads reliably, by pausing after server-side prepare and requiring one user tap per song.

**Architecture:** `useBatchDownload` grows a `manual` mode — after preparing all songs it sets `awaitingGesture: true` and exposes `downloadNext()`, a synchronous function the user's tap calls directly. No `await` sits between the tap and `api.download.file()`, so iOS Safari's gesture chain is intact. `SelectionBar` renders a "Tap to download (N of M)" button when `awaitingGesture` is true. `App.tsx` detects iOS and passes `manual: true` to the hook. Desktop auto-loop behavior is unchanged.

**Tech Stack:** React 19, TypeScript strict, Tailwind CSS v4

## Global Constraints

- No new npm dependencies
- TypeScript strict mode — zero `tsc --noEmit` errors required
- No backend changes
- Desktop batch download behavior must be identical to today
- TypeScript check: `cd /home/ttndev/workspace/personal/music-assistant/web && npx tsc --noEmit`

---

### Task 1: iOS Batch Download — Prepare-then-Tap

**Files:**
- Modify: `web/src/hooks/useBatchDownload.ts`
- Modify: `web/src/components/SelectionBar.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- `useBatchDownload` new option: `manual?: boolean`
- `useBatchDownload` new return values: `downloadNext: () => void`, `awaitingGesture: boolean`
- `SelectionBar` new props: `awaitingGesture: boolean`, `downloadNext: () => void`

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
  cancel: () => void
  progress: Progress | null
  isRunning: boolean
  awaitingGesture: boolean
}

interface Options {
  onSongDownloaded?: (id: string) => void
  onComplete?: (downloaded: number, failed: number) => void
  manual?: boolean
}

export function useBatchDownload({ onSongDownloaded, onComplete, manual }: Options): UseBatchDownloadReturn {
  const [progress, setProgress] = useState<Progress | null>(null)
  const [awaitingGesture, setAwaitingGesture] = useState(false)

  const runningRef = useRef(false)
  const cancelledRef = useRef(false)
  const awaitingGestureRef = useRef(false)  // ref mirror so cancel() reads current value
  const pendingIdsRef = useRef<string[]>([])
  const downloadedCountRef = useRef(0)
  const currentIndexRef = useRef(0)

  const cancel = useCallback(() => {
    cancelledRef.current = true
    if (awaitingGestureRef.current) {
      // Manual mode: no loop is running, reset immediately without calling onComplete
      runningRef.current = false
      cancelledRef.current = false
      awaitingGestureRef.current = false
      pendingIdsRef.current = []
      downloadedCountRef.current = 0
      currentIndexRef.current = 0
      setProgress(null)
      setAwaitingGesture(false)
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
      runningRef.current = false
      cancelledRef.current = false
      awaitingGestureRef.current = false
      pendingIdsRef.current = []
      downloadedCountRef.current = 0
      currentIndexRef.current = 0
      setProgress(null)
      setAwaitingGesture(false)
      onComplete?.(downloaded, 0)
    }
  }, [onSongDownloaded, onComplete])

  const downloadBatch = useCallback(
    async (songIds: string[]) => {
      if (songIds.length === 0 || runningRef.current) return
      runningRef.current = true
      cancelledRef.current = false
      downloadedCountRef.current = 0
      currentIndexRef.current = 0
      setProgress({ current: 0, total: songIds.length })

      // Prepare all songs on the server in parallel
      await Promise.allSettled(songIds.map(id => api.download.prepare(id)))

      if (cancelledRef.current) {
        runningRef.current = false
        cancelledRef.current = false
        setProgress(null)
        return
      }

      if (manual) {
        // iOS: pause here and let the user tap once per song
        pendingIdsRef.current = songIds
        awaitingGestureRef.current = true
        setAwaitingGesture(true)
        return
      }

      // Desktop: auto-download all songs sequentially
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
      runningRef.current = false
      cancelledRef.current = false
      setProgress(null)
      if (!wasCancelled) onComplete?.(downloaded, failed)
    },
    [onSongDownloaded, onComplete, manual],
  )

  return { downloadBatch, downloadNext, cancel, progress, isRunning: progress !== null, awaitingGesture }
}
```

- [ ] **Step 2: Replace `web/src/components/SelectionBar.tsx`**

The key change: when `awaitingGesture && progress`, show a full-width "Tap to download (N of M) ▼" button instead of the auto-progress text. `Select All` and `Clear` buttons are hidden while running or awaiting to keep the UI focused.

```tsx
import { ArrowCircleDown, X, StopCircle } from '@phosphor-icons/react'

interface Props {
  selected: Set<string>
  isSelectMode: boolean
  isRunning: boolean
  progress: { current: number; total: number } | null
  filteredUndownloadedIds: string[]
  awaitingGesture: boolean
  onDownloadSelected: () => void
  onSelectAllUndownloaded: () => void
  onClearAll: () => void
  onCancel: () => void
  onCancelDownload: () => void
  downloadNext: () => void
}

export function SelectionBar({
  selected,
  isSelectMode,
  isRunning,
  progress,
  filteredUndownloadedIds,
  awaitingGesture,
  onDownloadSelected,
  onSelectAllUndownloaded,
  onClearAll,
  onCancel,
  onCancelDownload,
  downloadNext,
}: Props) {
  if (selected.size === 0 && !isSelectMode) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-20 border-t border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur-sm">
      <div className="flex items-center gap-2 max-w-2xl mx-auto px-4 py-3 flex-wrap">
        {awaitingGesture && progress ? (
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
            <span className="flex-1 text-sm text-[var(--color-text-secondary)]">
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

        {!isRunning && !awaitingGesture && filteredUndownloadedIds.length > 0 && (
          <button
            onClick={onSelectAllUndownloaded}
            className="cursor-pointer rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
          >
            {selected.size > 0 ? 'Select All' : 'Select All Undownloaded'}
          </button>
        )}

        {selected.size > 0 && !isRunning && !awaitingGesture && (
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

- [ ] **Step 3: Update `web/src/App.tsx`**

Three edits:

**a) Add iOS detection constant** just before the `useBatchDownload` call (line ~52). Insert:

```ts
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
```

**b) Replace the `useBatchDownload` destructure** (currently lines 52–61). Old:

```ts
  const { downloadBatch, cancel: cancelDownload, progress, isRunning } = useBatchDownload({
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

**c) Replace the `<SelectionBar>` block** (currently lines 140–151). Old:

```tsx
      <SelectionBar
        selected={selected}
        isSelectMode={isSelectMode}
        isRunning={isRunning}
        progress={progress}
        filteredUndownloadedIds={filteredUndownloadedIds}
        onDownloadSelected={handleDownloadSelected}
        onSelectAllUndownloaded={handleSelectAllUndownloaded}
        onClearAll={clearAll}
        onCancel={exitSelectMode}
        onCancelDownload={cancelDownload}
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
        onDownloadSelected={handleDownloadSelected}
        onSelectAllUndownloaded={handleSelectAllUndownloaded}
        onClearAll={clearAll}
        onCancel={exitSelectMode}
        onCancelDownload={cancelDownload}
        downloadNext={downloadNext}
      />
```

- [ ] **Step 4: TypeScript check**

```bash
cd /home/ttndev/workspace/personal/music-assistant/web && npx tsc --noEmit
```

Expected: zero errors. Common failures:
- `Property 'awaitingGesture' does not exist on type 'UseBatchDownloadReturn'` → Step 1 not applied
- `Property 'downloadNext' does not exist on type 'Props'` → Step 2 not applied
- `Property 'awaitingGesture' does not exist on type 'IntrinsicAttributes & Props'` → Step 2 or 3 not applied

- [ ] **Step 5: Build and deploy**

```bash
cd /home/ttndev/workspace/personal/music-assistant && docker compose build --quiet && docker compose up -d
```

Expected:
```
Container music-assistant-app-1 Started
```

- [ ] **Step 6: Commit**

```bash
git add web/src/hooks/useBatchDownload.ts web/src/components/SelectionBar.tsx web/src/App.tsx
git commit -m "fix: iOS Safari batch download — prepare then tap-per-song to preserve gesture chain"
```

- [ ] **Step 7: Ask user to verify on iPhone**

No automated tests. Ask the user to:

1. On iPhone Safari — select 3 songs → tap "Download 3 songs" → "Preparing 3 songs…" appears → then "Tap to download (1 of 3) ▼" → tap → song downloads without iOS confirmation popup → "(2 of 3)" → tap → "(3 of 3)" → tap → all 3 songs in Files app, toast "Downloaded 3 songs"
2. On iPhone Safari — select 3 songs, tap start, then tap Cancel during prepare → no downloads, SelectionBar disappears
3. On iPhone Safari — select 3 songs, tap through 1 of 3, then tap Cancel → 1 song downloaded, SelectionBar clears
4. On laptop Chrome — select 3 songs → all 3 download automatically (current desktop behavior unchanged)
