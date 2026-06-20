# UI Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement four small independent UI improvements — auth screen contact guidance, clear-history state refresh, Select All merge behaviour, and playlist platform tooltips.

**Architecture:** All changes are isolated to the React frontend (`web/src/`). No API or backend changes required. There is no frontend test framework; correctness is verified via TypeScript compilation (`npm run build` inside `web/`) and browser inspection.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Vite, `@phosphor-icons/react`

---

## File Map

| File | Change |
|---|---|
| `web/src/components/AuthScreen.tsx` | Add admin contact line with mailto link |
| `web/src/App.tsx` | Add `historyVersion` state; clear `justDownloaded` on history clear; fix Select All to union; pass `playlistSources` to FilterBar |
| `web/src/components/SongList.tsx` | Accept and forward `historyVersion` prop |
| `web/src/components/SongRow.tsx` | Accept `historyVersion` prop; reset `localDownloaded` on change |
| `web/src/components/FilterBar.tsx` | Accept `playlistSources` prop; render hover tooltip on playlist pills |

---

## Task 1: Auth Screen — Admin Contact Guideline

**Files:**
- Modify: `web/src/components/AuthScreen.tsx`

- [ ] **Step 1: Replace the subtitle in AuthScreen.tsx**

Open `web/src/components/AuthScreen.tsx`. The current subtitle is:

```tsx
<p className="text-[var(--color-text-secondary)] text-sm">Enter your access code to continue.</p>
```

Replace it with:

```tsx
<div className="space-y-1">
  <p className="text-[var(--color-text-secondary)] text-sm">Enter your access code to continue.</p>
  <p className="text-[var(--color-text-secondary)] text-sm">
    Don't have an access code? Contact the admin at{' '}
    <a
      href="mailto:ttn.dev.fullstack@gmail.com"
      className="text-[var(--color-accent)] underline-offset-2 hover:underline"
    >
      ttn.dev.fullstack@gmail.com
    </a>
    {' '}to request one.
  </p>
</div>
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no TypeScript errors.

- [ ] **Step 3: Visual check**

Open `http://localhost:8000` in a browser while logged out (or clear device registration via Settings → Unregister). Verify:
- Both lines appear below the "Music Assistant" heading
- The email address is styled differently (accent color)
- Clicking the email opens the mail client

- [ ] **Step 4: Commit**

```bash
git add web/src/components/AuthScreen.tsx
git commit -m "feat: add admin contact guideline on auth screen"
```

---

## Task 2: Clear History — Refresh Downloaded Status

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/SongList.tsx`
- Modify: `web/src/components/SongRow.tsx`

- [ ] **Step 1: Add historyVersion state to App.tsx and wire it up**

In `web/src/App.tsx`, add `historyVersion` state alongside the existing `justDownloaded` state:

```tsx
const [justDownloaded, setJustDownloaded] = useState<Set<string>>(new Set())
const [historyVersion, setHistoryVersion] = useState(0)
```

Find the `onHistoryCleared` handler in the `SettingsSheet` props (near the bottom of the JSX). Change it from:

```tsx
onHistoryCleared={() => { refetch(); toast.success('Download history cleared') }}
```

to:

```tsx
onHistoryCleared={() => {
  refetch()
  setJustDownloaded(new Set())
  setHistoryVersion(v => v + 1)
  toast.success('Download history cleared')
}}
```

Then pass `historyVersion` to `SongList`. Find the `<SongList ...>` JSX block and add the prop:

```tsx
<SongList
  songs={songs}
  activePlaylist={activePlaylist}
  search={search}
  onDelete={handleDelete}
  onDownloaded={refetch}
  onError={(msg) => toast.error(msg)}
  isSelectMode={isSelectMode}
  selected={selected}
  onToggle={toggle}
  justDownloaded={justDownloaded}
  historyVersion={historyVersion}
/>
```

- [ ] **Step 2: Add historyVersion prop to SongList and forward to SongRow**

In `web/src/components/SongList.tsx`, add `historyVersion: number` to the `Props` interface:

```tsx
interface Props {
  songs: SongResponse[]
  activePlaylist: string
  search: string
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

Destructure it in the function signature:

```tsx
export function SongList({
  songs,
  activePlaylist,
  search,
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

Pass it to each `<SongRow>` inside the `pageItems.map`:

```tsx
{pageItems.map(song => (
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
))}
```

- [ ] **Step 3: Add historyVersion prop to SongRow and reset localDownloaded**

In `web/src/components/SongRow.tsx`, add `historyVersion: number` to the `Props` interface:

```tsx
interface Props {
  song: SongResponse
  onDelete: (id: string) => void
  onDownloaded: () => void
  onError: (message: string) => void
  isSelectMode: boolean
  selected: boolean
  onToggle: (id: string) => void
  isJustDownloaded?: boolean
  historyVersion: number
}
```

Destructure it in the function signature:

```tsx
export function SongRow({ song, onDelete, onDownloaded, onError, isSelectMode, selected, onToggle, isJustDownloaded, historyVersion }: Props) {
```

Add a `useEffect` import (it's already imported via React) and add the reset effect immediately after the existing state declarations:

```tsx
const [downloading, setDownloading] = useState(false)
const [localDownloaded, setLocalDownloaded] = useState(false)

useEffect(() => {
  setLocalDownloaded(false)
}, [historyVersion])
```

`useState` is already imported. Verify `useEffect` is in the import at the top — the current file only imports `useState`. Update the import:

```tsx
import { useState, useEffect } from 'react'
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd web && npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no errors.

- [ ] **Step 5: Visual check**

1. Download one song individually (sets `localDownloaded = true` in its SongRow).
2. Trigger a batch download of another song (sets `justDownloaded`).
3. Open Settings, type `clear history`, click the button.
4. Verify: both songs' download badges (✓ checkmark on thumbnail) disappear immediately. The song list should look identical to a fresh session.

- [ ] **Step 6: Commit**

```bash
git add web/src/App.tsx web/src/components/SongList.tsx web/src/components/SongRow.tsx
git commit -m "fix: refresh downloaded status after clearing history"
```

---

## Task 3: Select All — Preserve Existing Checked Songs

**Files:**
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Fix handleSelectAllUndownloaded to union selections**

In `web/src/App.tsx`, find `handleSelectAllUndownloaded`:

```tsx
const handleSelectAllUndownloaded = useCallback(() => {
  selectAll(filteredUndownloadedIds)
}, [selectAll, filteredUndownloadedIds])
```

Replace it with:

```tsx
const handleSelectAllUndownloaded = useCallback(() => {
  selectAll([...new Set([...selected, ...filteredUndownloadedIds])])
}, [selectAll, filteredUndownloadedIds, selected])
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd web && npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no errors.

- [ ] **Step 3: Visual check**

1. On desktop (checkboxes are always visible), check one downloaded song.
2. Click "Select All" in the bottom bar.
3. Verify: the previously checked downloaded song remains checked. All undownloaded songs in the current filter are also now checked.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "fix: preserve existing checked songs when clicking Select All"
```

---

## Task 4: Playlist Badge — Platform Tooltip on Hover

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/FilterBar.tsx`

- [ ] **Step 1: Pass playlistSources to FilterBar from App.tsx**

In `web/src/App.tsx`, `useSongs()` already returns `playlistSources`. It's destructured but not passed to `FilterBar`. Find the `<FilterBar ...>` JSX block:

```tsx
<FilterBar
  playlists={playlists}
  activePlaylist={activePlaylist}
  search={search}
  onPlaylistChange={setActivePlaylist}
  onSearchChange={setSearch}
  onEnterSelectMode={enterSelectMode}
/>
```

Replace with:

```tsx
<FilterBar
  playlists={playlists}
  activePlaylist={activePlaylist}
  search={search}
  playlistSources={playlistSources}
  onPlaylistChange={setActivePlaylist}
  onSearchChange={setSearch}
  onEnterSelectMode={enterSelectMode}
/>
```

- [ ] **Step 2: Update FilterBar to accept playlistSources and render tooltips**

Replace the entire contents of `web/src/components/FilterBar.tsx` with:

```tsx
import { MagnifyingGlass } from '@phosphor-icons/react'
import { clsx } from 'clsx'

const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  tiktok: 'TikTok',
}

interface Props {
  playlists: string[]
  activePlaylist: string
  search: string
  playlistSources: Record<string, string>
  onPlaylistChange: (p: string) => void
  onSearchChange: (s: string) => void
  onEnterSelectMode: () => void
}

export function FilterBar({
  playlists,
  activePlaylist,
  search,
  playlistSources,
  onPlaylistChange,
  onSearchChange,
  onEnterSelectMode,
}: Props) {
  return (
    <div className="space-y-3 px-4 py-3 border-b border-[var(--color-border)]">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {['All', ...playlists].map(pl => {
          const platformLabel = pl !== 'All' ? PLATFORM_LABELS[playlistSources[pl]] : undefined

          return (
            <div key={pl} className="relative group/tooltip shrink-0">
              <button
                onClick={() => onPlaylistChange(pl)}
                className={clsx(
                  'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  activePlaylist === pl
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
                )}
              >
                {pl}
              </button>

              {platformLabel && (
                <span className="pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded px-2 py-1 text-[10px] bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] opacity-0 transition-opacity group-hover/tooltip:opacity-100">
                  {platformLabel}
                </span>
              )}
            </div>
          )
        })}

        <button
          onClick={onEnterSelectMode}
          className="md:hidden shrink-0 rounded-full px-3 py-1 text-xs font-medium bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
        >
          Select
        </button>
      </div>

      <div className="relative">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search songs..."
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-4 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition-colors placeholder:text-[var(--color-text-muted)]"
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd web && npm run build 2>&1 | tail -5
```

Expected: `✓ built in` with no errors.

- [ ] **Step 4: Visual check**

1. In the filter bar, hover over a playlist pill (e.g., "Boost Energy").
2. Verify a small tooltip appears above the pill showing "YouTube" or "SoundCloud" as appropriate.
3. Hover over the "All" pill — verify no tooltip appears.
4. Hover over a manually-added playlist (one with no `playlistSources` entry) — verify no tooltip appears.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/components/FilterBar.tsx
git commit -m "feat: show platform tooltip on playlist badge hover"
```
