# Batch Download + Provider Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add multi-select batch download, "select all undownloaded" shortcut, and YouTube/SoundCloud connection status dots in the header.

**Architecture:** Backend adds one new endpoint (`GET /api/status/providers`) that runs YouTube and SoundCloud reachability checks concurrently. Frontend adds three hooks (`useSelection`, `useBatchDownload`, `useProviderStatus`), two new components (`SelectionBar`, extended `Header`), and modifies `SongRow`, `SongList`, `FilterBar`, and `App` to wire it all together. All batching logic lives in the frontend — no new backend batch endpoint.

**Tech Stack:** FastAPI + httpx (backend); React 19 + Vite 6 + Tailwind v4 + Phosphor Icons + Motion (frontend).

## Global Constraints

- Python 3.12, FastAPI; all new routers go in `api/routers/`, tests in `api/tests/`
- React 19, TypeScript strict, Tailwind v4 (`@import "tailwindcss"`, `@theme {}` — no `tailwind.config.js`)
- Icons: `@phosphor-icons/react` only — no Lucide, no inline SVGs
- Dark mode only; accent `#10b981`, error/amber `#f59e0b`, CSS vars `var(--color-*)` for all colors
- No em-dashes anywhere in UI copy (use `-` or `:`)
- No Spotify integration; no new backend batch endpoint
- `md:` breakpoint = desktop (always-visible checkboxes); below `md:` = mobile (select-mode toggle)

---

### Task 1: Backend - Provider Status Endpoint

**Files:**
- Create: `api/routers/status.py`
- Create: `api/tests/test_status.py`
- Modify: `api/main.py` (lines 5, 14)

**Interfaces:**
- Consumes: `config.Settings` fields: `youtube_api_key`, `youtube_channel_id`, `soundcloud_profile_url`
- Produces: `GET /api/status/providers` → `{ youtube: {configured, reachable, error}, soundcloud: {configured, reachable, error} }`

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_status.py`:

```python
from unittest.mock import patch


def _make_client(monkeypatch, yt_key="", yt_channel="", sc_url=""):
    monkeypatch.setenv("ACCESS_CODE", "secret")
    monkeypatch.setenv("YOUTUBE_API_KEY", yt_key)
    monkeypatch.setenv("YOUTUBE_CHANNEL_ID", yt_channel)
    monkeypatch.setenv("SOUNDCLOUD_PROFILE_URL", sc_url)
    from config import get_settings
    get_settings.cache_clear()
    from main import app
    from fastapi.testclient import TestClient
    return TestClient(app)


def test_not_configured(monkeypatch):
    client = _make_client(monkeypatch)
    res = client.get("/api/status/providers")
    assert res.status_code == 200
    data = res.json()
    assert data["youtube"] == {"configured": False, "reachable": False, "error": "Not configured"}
    assert data["soundcloud"] == {"configured": False, "reachable": False, "error": "Not configured"}


def test_reachable(monkeypatch):
    client = _make_client(monkeypatch, "key", "channel", "https://soundcloud.com/test")

    async def mock_get(self_or_url, url_or_none=None, **kwargs):
        url = url_or_none if url_or_none is not None else self_or_url

        class R:
            status_code = 200

            def json(self_r):
                return {"items": [{"id": "channel"}]} if "youtube" in url else {}

        return R()

    with patch("httpx.AsyncClient.get", new=mock_get):
        res = client.get("/api/status/providers")

    assert res.status_code == 200
    data = res.json()
    assert data["youtube"] == {"configured": True, "reachable": True, "error": None}
    assert data["soundcloud"] == {"configured": True, "reachable": True, "error": None}


def test_youtube_unreachable(monkeypatch):
    client = _make_client(monkeypatch, "bad_key", "channel", "")

    async def mock_get(self_or_url, url_or_none=None, **kwargs):
        class R:
            status_code = 400

            def json(self_r):
                return {}

        return R()

    with patch("httpx.AsyncClient.get", new=mock_get):
        res = client.get("/api/status/providers")

    data = res.json()
    assert data["youtube"]["configured"] is True
    assert data["youtube"]["reachable"] is False
    assert "400" in data["youtube"]["error"]
    assert data["soundcloud"]["configured"] is False
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd api && pytest tests/test_status.py -v
```

Expected: `ERROR` — `ModuleNotFoundError: No module named 'routers.status'` (router not yet created)

- [ ] **Step 3: Create `api/routers/status.py`**

```python
import asyncio
import httpx
from fastapi import APIRouter, Depends
from config import Settings, get_settings

router = APIRouter(prefix="/api/status", tags=["status"])


async def _check_youtube(api_key: str, channel_id: str) -> dict:
    if not api_key or not channel_id:
        return {"configured": False, "reachable": False, "error": "Not configured"}
    url = (
        "https://www.googleapis.com/youtube/v3/channels"
        f"?key={api_key}&id={channel_id}&part=id&maxResults=1"
    )
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(url)
        if r.status_code == 200 and r.json().get("items"):
            return {"configured": True, "reachable": True, "error": None}
        return {"configured": True, "reachable": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"configured": True, "reachable": False, "error": str(e)}


async def _check_soundcloud(profile_url: str) -> dict:
    if not profile_url:
        return {"configured": False, "reachable": False, "error": "Not configured"}
    try:
        async with httpx.AsyncClient(timeout=5, follow_redirects=True) as client:
            r = await client.get(profile_url)
        if r.status_code == 200:
            return {"configured": True, "reachable": True, "error": None}
        return {"configured": True, "reachable": False, "error": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"configured": True, "reachable": False, "error": str(e)}


@router.get("/providers")
async def provider_status(settings: Settings = Depends(get_settings)):
    youtube, soundcloud = await asyncio.gather(
        _check_youtube(settings.youtube_api_key, settings.youtube_channel_id),
        _check_soundcloud(settings.soundcloud_profile_url),
    )
    return {"youtube": youtube, "soundcloud": soundcloud}
```

- [ ] **Step 4: Register the router in `api/main.py`**

Change line 5 from:
```python
from routers import auth, devices, songs, sync, download
```
to:
```python
from routers import auth, devices, songs, sync, download, status
```

Add after `app.include_router(download.router)` (line 14):
```python
app.include_router(status.router)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd api && pytest tests/test_status.py -v
```

Expected: `3 passed`

- [ ] **Step 6: Run full test suite to check for regressions**

```bash
cd api && pytest tests/ -v
```

Expected: all existing tests still pass

- [ ] **Step 7: Commit**

```bash
git add api/routers/status.py api/tests/test_status.py api/main.py
git commit -m "feat: add GET /api/status/providers endpoint"
```

---

### Task 2: Frontend - api.ts Types + useProviderStatus Hook + Header Dots

**Files:**
- Modify: `web/src/lib/api.ts`
- Create: `web/src/hooks/useProviderStatus.ts`
- Modify: `web/src/components/Header.tsx`

**Interfaces:**
- Consumes: `GET /api/status/providers` from Task 1
- Produces:
  - `ProviderStatusItem` — `{ configured: boolean; reachable: boolean; error: string | null }`
  - `ProvidersStatusResponse` — `{ youtube: ProviderStatusItem; soundcloud: ProviderStatusItem }`
  - `useProviderStatus(syncVersion: number)` — `{ status: ProvidersStatusResponse | null; loading: boolean }`
  - `Header` gains new required prop: `providerStatus: ProvidersStatusResponse | null`

- [ ] **Step 1: Add types and `api.providers.status()` to `web/src/lib/api.ts`**

Add after the `SongsListResponse` interface (line 37):

```typescript
export interface ProviderStatusItem {
  configured: boolean
  reachable: boolean
  error: string | null
}

export interface ProvidersStatusResponse {
  youtube: ProviderStatusItem
  soundcloud: ProviderStatusItem
}
```

Add `providers` key to the `api` object, after `download`:

```typescript
  providers: {
    status: () => req<ProvidersStatusResponse>('GET', '/api/status/providers'),
  },
```

- [ ] **Step 2: Create `web/src/hooks/useProviderStatus.ts`**

```typescript
import { useState, useEffect } from 'react'
import { api, ProvidersStatusResponse } from '../lib/api'

export function useProviderStatus(syncVersion: number) {
  const [status, setStatus] = useState<ProvidersStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.providers
      .status()
      .then(setStatus)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [syncVersion])

  return { status, loading }
}
```

- [ ] **Step 3: Replace `web/src/components/Header.tsx` with the updated version**

```tsx
import { ArrowsClockwise, GearSix, MusicNote, YoutubeLogo, SoundcloudLogo } from '@phosphor-icons/react'
import { motion, AnimatePresence } from 'motion/react'
import { ProviderStatusItem, ProvidersStatusResponse } from '../lib/api'

interface Props {
  pendingCount: number
  syncRunning: boolean
  onSync: () => void
  onSettings: () => void
  providerStatus: ProvidersStatusResponse | null
}

function dotColor(item: ProviderStatusItem | undefined): string {
  if (!item || !item.configured) return 'var(--color-text-muted)'
  return item.reachable ? '#10b981' : '#f59e0b'
}

function dotTitle(label: string, item: ProviderStatusItem | undefined): string {
  if (!item || !item.configured) return `${label}: not configured`
  if (item.reachable) return `${label}: connected`
  return `${label}: ${item.error ?? 'unreachable'}`
}

export function Header({ pendingCount, syncRunning, onSync, onSettings, providerStatus }: Props) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <MusicNote size={20} weight="fill" className="text-[var(--color-accent)]" />
        <span className="font-semibold text-sm">Music Assistant</span>
      </div>

      <div className="flex items-center gap-2">
        {/* Provider status dots */}
        <div className="flex items-center gap-1.5">
          <span
            className="relative flex items-center"
            title={dotTitle('YouTube', providerStatus?.youtube)}
          >
            <YoutubeLogo size={14} className="text-[var(--color-text-muted)]" />
            <span
              className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: dotColor(providerStatus?.youtube) }}
            />
          </span>
          <span
            className="relative flex items-center"
            title={dotTitle('SoundCloud', providerStatus?.soundcloud)}
          >
            <SoundcloudLogo size={14} className="text-[var(--color-text-muted)]" />
            <span
              className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: dotColor(providerStatus?.soundcloud) }}
            />
          </span>
        </div>

        <button
          onClick={onSettings}
          className="p-2 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors"
          aria-label="Settings"
        >
          <GearSix size={18} />
        </button>

        <button
          onClick={onSync}
          disabled={syncRunning}
          className="relative flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium transition-colors hover:border-[var(--color-accent)] disabled:opacity-50"
        >
          <motion.span
            animate={syncRunning ? { rotate: 360 } : { rotate: 0 }}
            transition={{ repeat: syncRunning ? Infinity : 0, duration: 1, ease: 'linear' }}
          >
            <ArrowsClockwise size={14} />
          </motion.span>
          Sync
          <AnimatePresence>
            {pendingCount > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full bg-[var(--color-accent)] text-white text-[10px] font-bold flex items-center justify-center px-1"
              >
                {pendingCount}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Verify TypeScript compilation**

```bash
cd web && npm run build 2>&1 | tail -20
```

Expected: build succeeds. If `App.tsx` errors because `Header` now requires `providerStatus`, that's expected — it will be fixed in Task 8.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/api.ts web/src/hooks/useProviderStatus.ts web/src/components/Header.tsx
git commit -m "feat: add provider status types, hook, and header dots"
```

---

### Task 3: Frontend - useSelection Hook

**Files:**
- Create: `web/src/hooks/useSelection.ts`

**Interfaces:**
- Produces: `useSelection()` → `{ selected: Set<string>; isSelectMode: boolean; toggle(id): void; selectAll(ids): void; clearAll(): void; enterSelectMode(): void; exitSelectMode(): void }`

- [ ] **Step 1: Create `web/src/hooks/useSelection.ts`**

```typescript
import { useState, useCallback } from 'react'

export interface UseSelectionReturn {
  selected: Set<string>
  isSelectMode: boolean
  toggle: (id: string) => void
  selectAll: (ids: string[]) => void
  clearAll: () => void
  enterSelectMode: () => void
  exitSelectMode: () => void
}

export function useSelection(): UseSelectionReturn {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isSelectMode, setIsSelectMode] = useState(false)

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const selectAll = useCallback((ids: string[]) => {
    setSelected(new Set(ids))
  }, [])

  const clearAll = useCallback(() => {
    setSelected(new Set())
  }, [])

  const enterSelectMode = useCallback(() => {
    setIsSelectMode(true)
  }, [])

  const exitSelectMode = useCallback(() => {
    setIsSelectMode(false)
    setSelected(new Set())
  }, [])

  return { selected, isSelectMode, toggle, selectAll, clearAll, enterSelectMode, exitSelectMode }
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd web && npm run build 2>&1 | tail -10
```

Expected: build succeeds (or only errors from pre-existing Task 2 Header change)

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useSelection.ts
git commit -m "feat: add useSelection hook"
```

---

### Task 4: Frontend - useBatchDownload Hook

**Files:**
- Create: `web/src/hooks/useBatchDownload.ts`

**Interfaces:**
- Consumes: `api.download.prepare(id)`, `api.download.url(id)` from `web/src/lib/api.ts`
- Produces: `useBatchDownload(onComplete: () => void)` → `{ downloadBatch(ids: string[]): Promise<void>; progress: { current: number; total: number } | null; isRunning: boolean }`

- [ ] **Step 1: Create `web/src/hooks/useBatchDownload.ts`**

```typescript
import { useState, useCallback, useRef } from 'react'
import { api } from '../lib/api'

interface Progress {
  current: number
  total: number
}

export interface UseBatchDownloadReturn {
  downloadBatch: (songIds: string[]) => Promise<void>
  progress: Progress | null
  isRunning: boolean
}

export function useBatchDownload(onComplete: () => void): UseBatchDownloadReturn {
  const [progress, setProgress] = useState<Progress | null>(null)
  const runningRef = useRef(false)

  const downloadBatch = useCallback(
    async (songIds: string[]) => {
      if (songIds.length === 0 || runningRef.current) return
      runningRef.current = true
      setProgress({ current: 0, total: songIds.length })

      // Kick off all server-side downloads in parallel so yt-dlp starts fetching all songs at once
      await Promise.allSettled(songIds.map(id => api.download.prepare(id)))

      // Trigger browser file-save dialogs sequentially with 800ms gaps to avoid pop-up blocking
      for (let i = 0; i < songIds.length; i++) {
        const link = document.createElement('a')
        link.href = api.download.url(songIds[i])
        link.download = ''
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        setProgress({ current: i + 1, total: songIds.length })
        if (i < songIds.length - 1) {
          await new Promise<void>(resolve => setTimeout(resolve, 800))
        }
      }

      runningRef.current = false
      setProgress(null)
      onComplete()
    },
    [onComplete],
  )

  return { downloadBatch, progress, isRunning: progress !== null }
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd web && npm run build 2>&1 | tail -10
```

Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
git add web/src/hooks/useBatchDownload.ts
git commit -m "feat: add useBatchDownload hook"
```

---

### Task 5: Frontend - SongRow + SongList Selection Wiring

**Files:**
- Modify: `web/src/components/SongRow.tsx`
- Modify: `web/src/components/SongList.tsx`

**Interfaces:**
- Consumes: `UseSelectionReturn` from Task 3 (`isSelectMode`, `selected`, `toggle`)
- `SongRow` gains: `isSelectMode: boolean`, `selected: boolean`, `onToggle: (id: string) => void`
- `SongList` gains: `isSelectMode: boolean`, `selected: Set<string>`, `onToggle: (id: string) => void`

- [ ] **Step 1: Update `web/src/components/SongRow.tsx`**

Replace the file with:

```tsx
import { useState } from 'react'
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
  isSelectMode: boolean
  selected: boolean
  onToggle: (id: string) => void
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

export function SongRow({ song, onDelete, onDownloaded, isSelectMode, selected, onToggle }: Props) {
  const [downloading, setDownloading] = useState(false)
  const PlatformIcon = PLATFORM_ICONS[song.platform]

  async function handleDownload() {
    setDownloading(true)
    try {
      await api.download.prepare(song.id)
      const link = document.createElement('a')
      link.href = api.download.url(song.id)
      link.download = ''
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(onDownloaded, 3000)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-surface)] transition-colors group">
      {/* Checkbox: always visible on md+, only visible in select mode on mobile */}
      <button
        onClick={() => onToggle(song.id)}
        aria-label={selected ? 'Deselect song' : 'Select song'}
        className={clsx(
          'shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors',
          isSelectMode ? 'flex' : 'hidden md:flex',
          selected
            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-accent)]',
        )}
      >
        {selected && <Check size={10} weight="bold" className="text-white" />}
      </button>

      {/* Thumbnail */}
      <div className="shrink-0 w-10 h-10 rounded-md bg-[var(--color-surface-elevated)] overflow-hidden flex items-center justify-center">
        {song.thumbnail ? (
          <img src={song.thumbnail} alt="" className="w-full h-full object-cover" />
        ) : (
          <PlatformIcon size={18} color={PLATFORM_COLORS[song.platform]} />
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

      {/* Status + actions */}
      <div className="flex items-center gap-2 shrink-0">
        {song.downloaded ? (
          <span className="flex items-center gap-1 text-[11px] text-[var(--color-accent)] font-medium">
            <CheckCircle size={14} weight="fill" />
            Done
          </span>
        ) : (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className={clsx(
              'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
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
          className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-all"
          aria-label="Remove song"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update `web/src/components/SongList.tsx`**

Replace the file with:

```tsx
import { MusicNote } from '@phosphor-icons/react'
import { SongResponse } from '../lib/api'
import { SongRow } from './SongRow'

interface Props {
  songs: SongResponse[]
  activePlaylist: string
  search: string
  onDelete: (id: string) => void
  onDownloaded: () => void
  isSelectMode: boolean
  selected: Set<string>
  onToggle: (id: string) => void
}

export function SongList({
  songs,
  activePlaylist,
  search,
  onDelete,
  onDownloaded,
  isSelectMode,
  selected,
  onToggle,
}: Props) {
  const filtered = songs.filter(s => {
    const matchPlaylist = activePlaylist === 'All' || s.playlist === activePlaylist
    const matchSearch = !search || s.title.toLowerCase().includes(search.toLowerCase())
    return matchPlaylist && matchSearch
  })

  if (songs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
        <MusicNote size={40} className="text-[var(--color-text-muted)] mb-4" />
        <p className="text-sm text-[var(--color-text-secondary)]">No songs yet.</p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">
          Paste a YouTube or SoundCloud link above to get started.
        </p>
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-[var(--color-text-secondary)]">No songs match your filter.</p>
      </div>
    )
  }

  return (
    <div>
      {filtered.map(song => (
        <SongRow
          key={song.id}
          song={song}
          onDelete={onDelete}
          onDownloaded={onDownloaded}
          isSelectMode={isSelectMode}
          selected={selected.has(song.id)}
          onToggle={onToggle}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
cd web && npm run build 2>&1 | tail -15
```

Expected: build succeeds. TypeScript may still error on `App.tsx` for missing new props — those are fixed in Task 8.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/SongRow.tsx web/src/components/SongList.tsx
git commit -m "feat: add selection checkbox to SongRow and SongList"
```

---

### Task 6: Frontend - FilterBar "Select" Button (Mobile)

**Files:**
- Modify: `web/src/components/FilterBar.tsx`

**Interfaces:**
- Consumes: `enterSelectMode()` from `useSelection` (Task 3)
- `FilterBar` gains: `onEnterSelectMode: () => void`

- [ ] **Step 1: Update `web/src/components/FilterBar.tsx`**

Replace the file with:

```tsx
import { MagnifyingGlass } from '@phosphor-icons/react'
import { clsx } from 'clsx'

interface Props {
  playlists: string[]
  activePlaylist: string
  search: string
  onPlaylistChange: (p: string) => void
  onSearchChange: (s: string) => void
  onEnterSelectMode: () => void
}

export function FilterBar({
  playlists,
  activePlaylist,
  search,
  onPlaylistChange,
  onSearchChange,
  onEnterSelectMode,
}: Props) {
  return (
    <div className="space-y-3 px-4 py-3 border-b border-[var(--color-border)]">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {['All', ...playlists].map(pl => (
          <button
            key={pl}
            onClick={() => onPlaylistChange(pl)}
            className={clsx(
              'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
              activePlaylist === pl
                ? 'bg-[var(--color-accent)] text-white'
                : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
            )}
          >
            {pl}
          </button>
        ))}

        {/* Mobile-only: enter select mode */}
        <button
          onClick={onEnterSelectMode}
          className="md:hidden shrink-0 rounded-full px-3 py-1 text-xs font-medium bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
        >
          Select
        </button>
      </div>

      <div className="relative">
        <MagnifyingGlass
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
        />
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

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd web && npm run build 2>&1 | tail -10
```

Expected: build succeeds (App.tsx may still error on missing new props — fixed in Task 8)

- [ ] **Step 3: Commit**

```bash
git add web/src/components/FilterBar.tsx
git commit -m "feat: add mobile Select button to FilterBar"
```

---

### Task 7: Frontend - SelectionBar Component

**Files:**
- Create: `web/src/components/SelectionBar.tsx`

**Interfaces:**
- Consumes:
  - `selected: Set<string>`, `isSelectMode: boolean` from `useSelection` (Task 3)
  - `progress: { current: number; total: number } | null`, `isRunning: boolean` from `useBatchDownload` (Task 4)
- Props: `{ selected, isSelectMode, isRunning, progress, filteredUndownloadedIds, onDownloadSelected, onSelectAllUndownloaded, onClearAll, onCancel }`

- [ ] **Step 1: Create `web/src/components/SelectionBar.tsx`**

```tsx
import { ArrowCircleDown, X } from '@phosphor-icons/react'

interface Props {
  selected: Set<string>
  isSelectMode: boolean
  isRunning: boolean
  progress: { current: number; total: number } | null
  filteredUndownloadedIds: string[]
  onDownloadSelected: () => void
  onSelectAllUndownloaded: () => void
  onClearAll: () => void
  onCancel: () => void
}

export function SelectionBar({
  selected,
  isSelectMode,
  isRunning,
  progress,
  filteredUndownloadedIds,
  onDownloadSelected,
  onSelectAllUndownloaded,
  onClearAll,
  onCancel,
}: Props) {
  // Visible when desktop has a selection, or mobile is in select mode
  if (selected.size === 0 && !isSelectMode) return null

  return (
    <div className="fixed bottom-0 inset-x-0 z-20 border-t border-[var(--color-border)] bg-[var(--color-bg)]/95 backdrop-blur-sm">
      <div className="flex items-center gap-2 max-w-2xl mx-auto px-4 py-3 flex-wrap">
        {isRunning && progress ? (
          <span className="flex-1 text-sm text-[var(--color-text-secondary)]">
            Downloading {progress.current} of {progress.total}...
          </span>
        ) : selected.size > 0 ? (
          <button
            onClick={onDownloadSelected}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] text-white px-3 py-2 text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <ArrowCircleDown size={15} />
            Download {selected.size} song{selected.size !== 1 ? 's' : ''}
          </button>
        ) : null}

        {!isRunning && filteredUndownloadedIds.length > 0 && (
          <button
            onClick={onSelectAllUndownloaded}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
          >
            {selected.size > 0 ? 'Select All' : 'Select All Undownloaded'}
          </button>
        )}

        {selected.size > 0 && !isRunning && (
          <button
            onClick={onClearAll}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            Clear
          </button>
        )}

        {/* Mobile-only cancel button — exits select mode and clears selection */}
        <button
          onClick={onCancel}
          className="md:hidden ml-auto p-2 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          aria-label="Cancel selection"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd web && npm run build 2>&1 | tail -10
```

Expected: build succeeds

- [ ] **Step 3: Commit**

```bash
git add web/src/components/SelectionBar.tsx
git commit -m "feat: add SelectionBar component"
```

---

### Task 8: Frontend - App.tsx Wiring

**Files:**
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes all new hooks and components from Tasks 2-7
- Wires `syncVersion` counter to re-fetch provider status after each sync
- Computes `filteredUndownloadedIds` matching `SongList`'s filter logic
- `onSelectAllUndownloaded` selects all undownloaded AND immediately starts batch download (Feature 2 "Download All" shortcut)

- [ ] **Step 1: Replace `web/src/App.tsx`**

```tsx
import { useState, useCallback } from 'react'
import { useDevice } from './hooks/useDevice'
import { useSongs } from './hooks/useSongs'
import { useSync } from './hooks/useSync'
import { useSelection } from './hooks/useSelection'
import { useBatchDownload } from './hooks/useBatchDownload'
import { useProviderStatus } from './hooks/useProviderStatus'
import { AuthScreen } from './components/AuthScreen'
import { DeviceNameScreen } from './components/DeviceNameScreen'
import { Header } from './components/Header'
import { AddSongForm } from './components/AddSongForm'
import { FilterBar } from './components/FilterBar'
import { SongList } from './components/SongList'
import { SelectionBar } from './components/SelectionBar'
import { TikTokDownload } from './components/TikTokDownload'
import { SettingsSheet } from './components/SettingsSheet'

type AuthState = 'checking' | 'needs_code' | 'needs_name' | 'ready'

export default function App() {
  const { isRegistered } = useDevice()
  const [authState, setAuthState] = useState<AuthState>(isRegistered ? 'ready' : 'needs_code')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activePlaylist, setActivePlaylist] = useState('All')
  const [search, setSearch] = useState('')
  const [syncVersion, setSyncVersion] = useState(0)

  const { songs, playlists, pendingCount, refetch, removeSong, addSong } = useSongs()

  const handleSyncComplete = useCallback(() => {
    refetch()
    setSyncVersion(v => v + 1)
  }, [refetch])

  const { trigger: triggerSync, running: syncRunning } = useSync(handleSyncComplete)
  const { status: providerStatus } = useProviderStatus(syncVersion)
  const { selected, isSelectMode, toggle, selectAll, clearAll, enterSelectMode, exitSelectMode } =
    useSelection()
  const { downloadBatch, progress, isRunning } = useBatchDownload(refetch)

  // Mirror the filter logic from SongList to compute what's visible and undownloaded
  const filteredUndownloadedIds = songs
    .filter(s => {
      const matchPlaylist = activePlaylist === 'All' || s.playlist === activePlaylist
      const matchSearch = !search || s.title.toLowerCase().includes(search.toLowerCase())
      return matchPlaylist && matchSearch && !s.downloaded
    })
    .map(s => s.id)

  const handleDownloadSelected = useCallback(() => {
    downloadBatch(Array.from(selected))
  }, [downloadBatch, selected])

  // "Select All Undownloaded" selects them and immediately starts the batch download
  const handleSelectAllUndownloaded = useCallback(() => {
    selectAll(filteredUndownloadedIds)
    downloadBatch(filteredUndownloadedIds)
  }, [selectAll, downloadBatch, filteredUndownloadedIds])

  const handleAdd = useCallback(
    async (url: string, playlist: string): Promise<void> => {
      await addSong(url, playlist)
    },
    [addSong],
  )

  const handleVerified = useCallback(() => setAuthState('needs_name'), [])
  const handleRegistered = useCallback(() => setAuthState('ready'), [])

  if (authState === 'needs_code') return <AuthScreen onVerified={handleVerified} />
  if (authState === 'needs_name') return <DeviceNameScreen onRegistered={handleRegistered} />

  return (
    <div className="min-h-[100dvh] flex flex-col max-w-2xl mx-auto">
      <Header
        pendingCount={pendingCount}
        syncRunning={syncRunning}
        onSync={triggerSync}
        onSettings={() => setSettingsOpen(true)}
        providerStatus={providerStatus}
      />

      <AddSongForm playlists={playlists} onAdd={handleAdd} />
      <FilterBar
        playlists={playlists}
        activePlaylist={activePlaylist}
        search={search}
        onPlaylistChange={setActivePlaylist}
        onSearchChange={setSearch}
        onEnterSelectMode={enterSelectMode}
      />

      <main className="flex-1 pb-20">
        <SongList
          songs={songs}
          activePlaylist={activePlaylist}
          search={search}
          onDelete={removeSong}
          onDownloaded={refetch}
          isSelectMode={isSelectMode}
          selected={selected}
          onToggle={toggle}
        />
      </main>

      <TikTokDownload />

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
      />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onHistoryCleared={refetch}
      />
    </div>
  )
}
```

Note: `pb-20` on `<main>` adds bottom padding so the last song row is not hidden behind the fixed `SelectionBar`.

- [ ] **Step 2: Verify TypeScript compilation — full clean build**

```bash
cd web && npm run build 2>&1
```

Expected: `vite build` completes with no TypeScript errors. Output should end with something like:
```
dist/index.html             x.xx kB
dist/assets/index-xxx.js    xx.xx kB
```

If there are errors, read each one carefully — they will name the file and line.

- [ ] **Step 3: Run backend tests to confirm no regressions**

```bash
cd api && pytest tests/ -v
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat: wire batch download, selection, and provider status in App"
```

---

## Verification Checklist (after all tasks)

Run the dev server and manually verify:

```bash
cd web && npm run dev
```

- [ ] Header shows two small dots (YT + SC icons) with gray dots when not configured; dots turn green when configured + reachable
- [ ] Hovering/tapping a dot shows tooltip with status message
- [ ] On desktop (`>= 768px`): checkboxes are always visible on the left of each song row
- [ ] On mobile (`< 768px`): checkboxes are hidden; "Select" button appears in FilterBar pill row
- [ ] Tapping "Select" on mobile shows checkboxes + SelectionBar at the bottom
- [ ] Selecting songs on desktop shows SelectionBar with "Download X songs"
- [ ] "Select All Undownloaded" selects all undownloaded songs in the current filtered view and starts downloading
- [ ] "Download X songs" triggers batch download with progress indicator ("Downloading 1 of X...")
- [ ] Downloads arrive in the browser 800ms apart
- [ ] "Clear" clears selection (desktop); "Cancel" (X button) exits select mode and clears selection (mobile)
- [ ] SelectionBar does not overlap last song row (bottom padding applied)
- [ ] After sync completes, provider status dots re-fetch
