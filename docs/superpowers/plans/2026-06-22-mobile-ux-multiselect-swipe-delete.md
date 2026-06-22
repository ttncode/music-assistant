# Mobile UX — Multi-select & Swipe-to-Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make multi-select discoverable on mobile via long-press gesture + a visible "Select" button, and add swipe-left on song rows to reveal a delete button on mobile.

**Architecture:** Two independent frontend-only tasks. Task 1 threads a new `onEnterSelectMode` prop through App → SongList → SongRow, adds a 300ms long-press handler to SongRow, and moves the "Select" button from the hidden scrollable playlist row to alongside the search bar. Task 2 wraps each SongRow in a `relative overflow-hidden` container, adds an absolute delete button behind the row, and implements touch-event swipe logic with a non-passive `touchmove` listener so `e.preventDefault()` can block page scroll during horizontal swipes.

**Tech Stack:** React 19, TypeScript strict, Tailwind CSS v4, @phosphor-icons/react

## Global Constraints

- No new npm dependencies
- TypeScript strict mode — zero `tsc --noEmit` errors required
- `md:hidden` for mobile-only elements; `hidden md:flex` for desktop-only
- `touchmove` handlers that call `e.preventDefault()` must use non-passive native listeners (via `useEffect`), not JSX `onTouchMove`
- TypeScript check command: `cd /home/ttndev/workspace/personal/music-assistant/web && npx tsc --noEmit`
- Docker test command (backend, unchanged): `docker compose run --rm app python -m pytest tests/ -v`

---

### Task 1: Multi-select Discoverability

**Files:**
- Modify: `web/src/components/SongRow.tsx`
- Modify: `web/src/components/SongList.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/FilterBar.tsx`

**Interfaces:**
- Produces: `SongRow` new prop `onEnterSelectMode: () => void` — called on 300ms long-press; also auto-toggles the pressed song into the selection
- Produces: `SongList` new prop `onEnterSelectMode: () => void` — threaded to every `SongRow`
- Consumes: `enterSelectMode` from `useSelection()` already present in `App.tsx` — just not yet passed to `SongList`

- [ ] **Step 1: Update `SongRow.tsx` — add `onEnterSelectMode` prop and long-press touch handlers**

Replace the full content of `web/src/components/SongRow.tsx` with:

```tsx
import { useState, useEffect, useRef } from 'react'
import {
  ArrowCircleDown,
  Check,
  CheckCircle,
  X,
  SoundcloudLogo,
  YoutubeLogo,
  TiktokLogo,
  MusicNote,
} from '@phosphor-icons/react'
import { clsx } from 'clsx'
import { SongResponse, api } from '../lib/api'

interface Props {
  song: SongResponse
  onDelete: (id: string) => void
  onDownloaded: () => void
  onError: (message: string) => void
  isSelectMode: boolean
  selected: boolean
  onToggle: (id: string) => void
  onEnterSelectMode: () => void
  isJustDownloaded?: boolean
  historyVersion: number
}

const PLATFORM_ICONS = {
  youtube: YoutubeLogo,
  soundcloud: SoundcloudLogo,
  tiktok: TiktokLogo,
  other: MusicNote,
}

const PLATFORM_COLORS = {
  youtube: 'var(--color-platform-youtube)',
  soundcloud: 'var(--color-platform-soundcloud)',
  tiktok: 'var(--color-platform-tiktok)',
  other: 'var(--color-text-secondary)',
}

const MOVE_SLOP = 8

export function SongRow({ song, onDelete, onDownloaded, onError, isSelectMode, selected, onToggle, onEnterSelectMode, isJustDownloaded, historyVersion }: Props) {
  const [downloading, setDownloading] = useState(false)
  const [localDownloaded, setLocalDownloaded] = useState(false)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    setLocalDownloaded(false)
  }, [historyVersion])

  const PlatformIcon = PLATFORM_ICONS[song.platform]
  const isDownloaded = song.downloaded || isJustDownloaded || localDownloaded

  function cancelLongPress() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }

  function handleTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY }
    if (!isSelectMode) {
      longPressTimer.current = setTimeout(() => {
        navigator.vibrate?.(30)
        onEnterSelectMode()
        onToggle(song.id)
      }, 300)
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (!touchStart.current) return
    const touch = e.touches[0]
    const dx = Math.abs(touch.clientX - touchStart.current.x)
    const dy = Math.abs(touch.clientY - touchStart.current.y)
    if (dx > MOVE_SLOP || dy > MOVE_SLOP) cancelLongPress()
  }

  function handleTouchEnd() {
    cancelLongPress()
  }

  async function handleDownload() {
    setDownloading(true)
    try {
      await api.download.prepare(song.id)
      api.download.file(song.id)
      setLocalDownloaded(true)
      onDownloaded()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-surface)] transition-colors group"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Checkbox */}
      <button
        onClick={() => onToggle(song.id)}
        aria-label={selected ? 'Deselect song' : 'Select song'}
        className={clsx(
          'shrink-0 cursor-pointer w-4 h-4 rounded border flex items-center justify-center transition-colors',
          isSelectMode ? 'flex' : 'hidden md:flex',
          selected
            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-accent)]',
        )}
      >
        {selected && <Check size={10} weight="bold" className="text-white" />}
      </button>

      {/* Thumbnail with downloaded badge */}
      <div className="relative shrink-0 w-10 h-10 rounded-md bg-[var(--color-surface-elevated)] overflow-visible flex items-center justify-center">
        <div className="w-10 h-10 rounded-md overflow-hidden flex items-center justify-center">
          {song.thumbnail ? (
            <img src={song.thumbnail} alt="" className="w-full h-full object-cover" />
          ) : (
            <PlatformIcon size={18} color={PLATFORM_COLORS[song.platform]} />
          )}
        </div>
        {isDownloaded && (
          <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[var(--color-bg)] flex items-center justify-center">
            <CheckCircle size={13} weight="fill" className="text-[var(--color-accent)]" />
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <a
          href={song.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-sm font-medium hover:text-[var(--color-accent)] transition-colors"
        >
          {song.title}
        </a>
        <div className="flex items-center gap-1.5 mt-0.5">
          <PlatformIcon size={11} color={PLATFORM_COLORS[song.platform]} />
          <span className="text-[11px] text-[var(--color-text-muted)]">{song.playlist}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {!isDownloaded && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className={clsx(
              'flex items-center gap-1 cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              downloading
                ? 'text-[var(--color-text-muted)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)]',
            )}
          >
            <ArrowCircleDown size={14} className={downloading ? 'animate-spin' : ''} />
            {downloading ? 'Preparing...' : 'Download'}
          </button>
        )}

        <button
          onClick={() => onDelete(song.id)}
          className="opacity-0 group-hover:opacity-100 cursor-pointer p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-all"
          aria-label="Remove song"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update `SongList.tsx` — add `onEnterSelectMode` prop and thread it to `SongRow`**

In `web/src/components/SongList.tsx`, replace the `Props` interface (lines 8–22):

Old:
```tsx
interface Props {
  songs: SongResponse[]
  activePlaylist: string
  search: string
  activePlatform: 'all' | 'youtube' | 'soundcloud' | 'tiktok'
  loading: boolean
  onDelete: (id: string) => void
  onDownloaded: () => void
  onError: (message: string) => void
  isSelectMode: boolean
  selected: Set<string>
  onToggle: (id: string) => void
  justDownloaded: Set<string>
  historyVersion: number
}
```

New:
```tsx
interface Props {
  songs: SongResponse[]
  activePlaylist: string
  search: string
  activePlatform: 'all' | 'youtube' | 'soundcloud' | 'tiktok'
  loading: boolean
  onDelete: (id: string) => void
  onDownloaded: () => void
  onError: (message: string) => void
  isSelectMode: boolean
  selected: Set<string>
  onToggle: (id: string) => void
  onEnterSelectMode: () => void
  justDownloaded: Set<string>
  historyVersion: number
}
```

Replace the function destructuring (lines 24–38):

Old:
```tsx
export function SongList({
  songs,
  activePlaylist,
  search,
  activePlatform,
  loading,
  onDelete,
  onDownloaded,
  onError,
  isSelectMode,
  selected,
  onToggle,
  justDownloaded,
  historyVersion,
}: Props) {
```

New:
```tsx
export function SongList({
  songs,
  activePlaylist,
  search,
  activePlatform,
  loading,
  onDelete,
  onDownloaded,
  onError,
  isSelectMode,
  selected,
  onToggle,
  onEnterSelectMode,
  justDownloaded,
  historyVersion,
}: Props) {
```

Replace the `<SongRow>` call inside `pageItems.map` (lines 97–108):

Old:
```tsx
        <SongRow
          key={song.id}
          song={song}
          onDelete={onDelete}
          onDownloaded={onDownloaded}
          onError={onError}
          isSelectMode={isSelectMode}
          selected={selected.has(song.id)}
          onToggle={onToggle}
          isJustDownloaded={justDownloaded.has(song.id)}
          historyVersion={historyVersion}
        />
```

New:
```tsx
        <SongRow
          key={song.id}
          song={song}
          onDelete={onDelete}
          onDownloaded={onDownloaded}
          onError={onError}
          isSelectMode={isSelectMode}
          selected={selected.has(song.id)}
          onToggle={onToggle}
          onEnterSelectMode={onEnterSelectMode}
          isJustDownloaded={justDownloaded.has(song.id)}
          historyVersion={historyVersion}
        />
```

- [ ] **Step 3: Update `App.tsx` — pass `enterSelectMode` to `SongList`**

In `web/src/App.tsx`, replace the `<SongList>` block (lines 123–137):

Old:
```tsx
      <main className="flex-1 pb-20">
        <SongList
          songs={songs}
          activePlaylist={activePlaylist}
          search={search}
          activePlatform={activePlatform}
          loading={loading}
          onDelete={handleDelete}
          onDownloaded={refetch}
          onError={(msg) => toast.error(msg)}
          isSelectMode={isSelectMode}
          selected={selected}
          onToggle={toggle}
          justDownloaded={justDownloaded}
          historyVersion={historyVersion}
        />
      </main>
```

New:
```tsx
      <main className="flex-1 pb-20">
        <SongList
          songs={songs}
          activePlaylist={activePlaylist}
          search={search}
          activePlatform={activePlatform}
          loading={loading}
          onDelete={handleDelete}
          onDownloaded={refetch}
          onError={(msg) => toast.error(msg)}
          isSelectMode={isSelectMode}
          selected={selected}
          onToggle={toggle}
          onEnterSelectMode={enterSelectMode}
          justDownloaded={justDownloaded}
          historyVersion={historyVersion}
        />
      </main>
```

- [ ] **Step 4: Update `FilterBar.tsx` — move "Select" button next to search bar**

In `web/src/components/FilterBar.tsx`:

**a) Add `CheckSquare` to the import.** Old:
```tsx
import { MagnifyingGlass, YoutubeLogo, SoundcloudLogo, TiktokLogo } from '@phosphor-icons/react'
```

New:
```tsx
import { CheckSquare, MagnifyingGlass, YoutubeLogo, SoundcloudLogo, TiktokLogo } from '@phosphor-icons/react'
```

**b) Remove the "Select" pill from the scrollable playlist row.** Delete these lines (113–118):
```tsx
          <button
            onClick={onEnterSelectMode}
            className="md:hidden shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs font-medium bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
          >
            Select
          </button>
```

**c) Replace the search `<div>` with a flex row that includes the "Select" button.** Old (lines 121–129):
```tsx
        <div className="relative">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search songs..."
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-4 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition-colors placeholder:text-[var(--color-text-muted)]"
          />
        </div>
```

New:
```tsx
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="Search songs..."
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-4 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition-colors placeholder:text-[var(--color-text-muted)]"
            />
          </div>
          <button
            onClick={onEnterSelectMode}
            aria-label="Enter select mode"
            className="md:hidden shrink-0 cursor-pointer flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
          >
            <CheckSquare size={14} />
            Select
          </button>
        </div>
```

- [ ] **Step 5: TypeScript check**

```bash
cd /home/ttndev/workspace/personal/music-assistant/web && npx tsc --noEmit
```

Expected: zero errors. Common failure: missing `onEnterSelectMode` prop — means Step 2 or Step 3 was not applied.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/SongRow.tsx web/src/components/SongList.tsx web/src/App.tsx web/src/components/FilterBar.tsx
git commit -m "feat: mobile multi-select — long-press to enter select mode, visible Select button beside search"
```

---

### Task 2: Swipe Left to Reveal Delete (Mobile)

**Files:**
- Modify: `web/src/components/SongRow.tsx`

**Interfaces:**
- Consumes: `onDelete`, `isSelectMode`, `onEnterSelectMode`, `onToggle` — all already on `SongRow` Props after Task 1
- Produces: no new public interface; all changes are internal to `SongRow`

- [ ] **Step 1: Replace `SongRow.tsx` with swipe-to-delete implementation**

This rewrites `SongRow.tsx` to add:
- Swipe state (`swipeX`, `snapping`) with a mirrored ref (`swipeXRef`) for stale-closure-safe access in event handlers
- A non-passive native `touchmove` listener (via `useEffect`) so `e.preventDefault()` blocks page scroll during horizontal swipe
- A new outer `relative overflow-hidden` wrapper that holds the absolute delete button behind the row content
- The row content becomes an inner `div` that translates left on swipe
- A tap-to-close overlay rendered when the swipe is open
- Desktop `X` delete button gets `hidden md:flex` so it doesn't appear on mobile (swipe handles it there)

Replace the full content of `web/src/components/SongRow.tsx` with:

```tsx
import { useState, useEffect, useRef } from 'react'
import {
  ArrowCircleDown,
  Check,
  CheckCircle,
  Trash,
  X,
  SoundcloudLogo,
  YoutubeLogo,
  TiktokLogo,
  MusicNote,
} from '@phosphor-icons/react'
import { clsx } from 'clsx'
import { SongResponse, api } from '../lib/api'

interface Props {
  song: SongResponse
  onDelete: (id: string) => void
  onDownloaded: () => void
  onError: (message: string) => void
  isSelectMode: boolean
  selected: boolean
  onToggle: (id: string) => void
  onEnterSelectMode: () => void
  isJustDownloaded?: boolean
  historyVersion: number
}

const PLATFORM_ICONS = {
  youtube: YoutubeLogo,
  soundcloud: SoundcloudLogo,
  tiktok: TiktokLogo,
  other: MusicNote,
}

const PLATFORM_COLORS = {
  youtube: 'var(--color-platform-youtube)',
  soundcloud: 'var(--color-platform-soundcloud)',
  tiktok: 'var(--color-platform-tiktok)',
  other: 'var(--color-text-secondary)',
}

const DELETE_WIDTH = 64
const SNAP_THRESHOLD = 40
const MOVE_SLOP = 8

export function SongRow({ song, onDelete, onDownloaded, onError, isSelectMode, selected, onToggle, onEnterSelectMode, isJustDownloaded, historyVersion }: Props) {
  const [downloading, setDownloading] = useState(false)
  const [localDownloaded, setLocalDownloaded] = useState(false)
  const [swipeX, setSwipeXState] = useState(0)
  const [snapping, setSnapping] = useState(false)

  const swipeXRef = useRef(0)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStart = useRef<{ x: number; y: number; baseSwipeX: number } | null>(null)
  const swipeDragging = useRef(false)
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLocalDownloaded(false)
  }, [historyVersion])

  function setSwipeX(x: number) {
    swipeXRef.current = x
    setSwipeXState(x)
  }

  // Non-passive touchmove listener so e.preventDefault() can block page scroll
  // during a confirmed horizontal swipe. JSX onTouchMove is passive and cannot
  // call preventDefault().
  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    function onTouchMove(e: TouchEvent) {
      if (!touchStart.current) return
      const touch = e.touches[0]
      const dx = touch.clientX - touchStart.current.x
      const dy = touch.clientY - touchStart.current.y
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      if (absDx > MOVE_SLOP || absDy > MOVE_SLOP) {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current)
          longPressTimer.current = null
        }
      }
      if (!swipeDragging.current && absDx > absDy && absDx > MOVE_SLOP && !isSelectMode) {
        swipeDragging.current = true
      }
      if (swipeDragging.current) {
        e.preventDefault()
        const newX = Math.max(Math.min(touchStart.current.baseSwipeX + dx, 0), -DELETE_WIDTH)
        swipeXRef.current = newX
        setSwipeXState(newX)
      }
    }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [isSelectMode])

  const PlatformIcon = PLATFORM_ICONS[song.platform]
  const isDownloaded = song.downloaded || isJustDownloaded || localDownloaded

  function handleTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY, baseSwipeX: swipeXRef.current }
    swipeDragging.current = false
    setSnapping(false)
    if (!isSelectMode) {
      longPressTimer.current = setTimeout(() => {
        navigator.vibrate?.(30)
        onEnterSelectMode()
        onToggle(song.id)
      }, 300)
    }
  }

  function handleTouchEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    if (!swipeDragging.current) return
    swipeDragging.current = false
    setSnapping(true)
    const target = swipeXRef.current < -SNAP_THRESHOLD ? -DELETE_WIDTH : 0
    swipeXRef.current = target
    setSwipeXState(target)
  }

  async function handleDownload() {
    setDownloading(true)
    try {
      await api.download.prepare(song.id)
      api.download.file(song.id)
      setLocalDownloaded(true)
      onDownloaded()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="relative overflow-hidden border-b border-[var(--color-border)]">
      {/* Mobile delete button — sits behind row content, revealed by swiping left */}
      <button
        onClick={() => onDelete(song.id)}
        aria-label="Remove song"
        className="absolute right-0 top-0 bottom-0 w-16 md:hidden flex items-center justify-center bg-[var(--color-error)]/90 text-white"
      >
        <Trash size={18} />
      </button>

      {/* Invisible overlay covering the row content area when swipe is open.
          Captures taps to close the swipe without triggering row actions. */}
      {swipeX < 0 && (
        <div
          className="absolute inset-y-0 left-0 z-10"
          style={{ right: DELETE_WIDTH }}
          onClick={() => setSwipeX(0)}
        />
      )}

      {/* Row content — translates left on swipe */}
      <div
        ref={rowRef}
        className="flex items-center gap-3 px-4 py-3 bg-[var(--color-bg)] hover:bg-[var(--color-surface)] group"
        style={{
          transform: `translateX(${swipeX}px)`,
          transition: snapping
            ? 'transform 150ms ease-out, background-color 150ms'
            : 'background-color 150ms',
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Checkbox */}
        <button
          onClick={() => onToggle(song.id)}
          aria-label={selected ? 'Deselect song' : 'Select song'}
          className={clsx(
            'shrink-0 cursor-pointer w-4 h-4 rounded border flex items-center justify-center transition-colors',
            isSelectMode ? 'flex' : 'hidden md:flex',
            selected
              ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
              : 'border-[var(--color-border)] hover:border-[var(--color-accent)]',
          )}
        >
          {selected && <Check size={10} weight="bold" className="text-white" />}
        </button>

        {/* Thumbnail with downloaded badge */}
        <div className="relative shrink-0 w-10 h-10 rounded-md bg-[var(--color-surface-elevated)] overflow-visible flex items-center justify-center">
          <div className="w-10 h-10 rounded-md overflow-hidden flex items-center justify-center">
            {song.thumbnail ? (
              <img src={song.thumbnail} alt="" className="w-full h-full object-cover" />
            ) : (
              <PlatformIcon size={18} color={PLATFORM_COLORS[song.platform]} />
            )}
          </div>
          {isDownloaded && (
            <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[var(--color-bg)] flex items-center justify-center">
              <CheckCircle size={13} weight="fill" className="text-[var(--color-accent)]" />
            </span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <a
            href={song.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block truncate text-sm font-medium hover:text-[var(--color-accent)] transition-colors"
          >
            {song.title}
          </a>
          <div className="flex items-center gap-1.5 mt-0.5">
            <PlatformIcon size={11} color={PLATFORM_COLORS[song.platform]} />
            <span className="text-[11px] text-[var(--color-text-muted)]">{song.playlist}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {!isDownloaded && (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className={clsx(
                'flex items-center gap-1 cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                downloading
                  ? 'text-[var(--color-text-muted)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)]',
              )}
            >
              <ArrowCircleDown size={14} className={downloading ? 'animate-spin' : ''} />
              {downloading ? 'Preparing...' : 'Download'}
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
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd /home/ttndev/workspace/personal/music-assistant/web && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Build and deploy**

```bash
cd /home/ttndev/workspace/personal/music-assistant && docker compose build --quiet && docker compose up -d
```

- [ ] **Step 4: Commit**

```bash
git add web/src/components/SongRow.tsx
git commit -m "feat: swipe left to reveal delete button on mobile song rows"
```

- [ ] **Step 5: Ask user to verify on mobile**

No automated tests for touch interactions. Ask the user to verify:

1. **Long-press** — on iPhone/Android, press and hold any song for ~300 ms → select mode enters, that song is checked
2. **Long-press cancelled** — start press-hold, scroll the page → no select mode entered
3. **"Select" button visible** — without scrolling, the "Select" button is visible next to the search bar on mobile; hidden on desktop
4. **Swipe delete** — swipe any song row left → red delete button reveals; tap it → song removed
5. **Swipe below threshold** — short leftward swipe, release → row snaps back
6. **Swipe disabled in select mode** — enter select mode, try swiping a row → no swipe, checkbox toggles
7. **Desktop unaffected** — on laptop: checkboxes always visible, hover shows delete `X`, no swipe behaviour
