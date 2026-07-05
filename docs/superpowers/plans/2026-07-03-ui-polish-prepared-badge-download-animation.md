# UI Polish: Prepared Badge + Download Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tiny prepared dot badge with a proper icon badge matching the downloaded badge style, and fix the download spinner to use the standard `CircleNotch` icon.

**Architecture:** Single file change in `web/src/components/SongRow.tsx`. Two icon imports added (`HardDrive`, `CircleNotch`). No new dependencies, no backend changes.

**Tech Stack:** React 19, TypeScript strict, Tailwind CSS v4, `@phosphor-icons/react`

## Global Constraints

- TypeScript strict — `cd web && npx tsc --noEmit` must pass zero errors
- No new npm dependencies
- Only `web/src/components/SongRow.tsx` may be modified
- `HardDrive` icon: `size={11}` `weight="fill"` `className="text-emerald-500"`
- `CircleNotch` icon: `size={14}` `className="animate-spin"`
- Badge container at `-bottom-1 -left-1`: `w-4 h-4 rounded-full bg-[var(--color-bg)] flex items-center justify-center`

---

### Task 1: Prepared badge + download animation

**Files:**
- Modify: `web/src/components/SongRow.tsx`

**Interfaces:**
- Consumes: `song.prepared: boolean`, `isDownloaded: boolean`, `downloading: boolean` — all already on the component
- Produces: nothing downstream depends on this change

- [ ] **Step 1: Read the current file**

Open `web/src/components/SongRow.tsx` and confirm:
- Line ~2: imports from `@phosphor-icons/react` — currently has `ArrowCircleDown, Check, CheckCircle, Trash, X, SoundcloudLogo, YoutubeLogo, TiktokLogo, MusicNote`
- Line ~210: downloaded badge at `-bottom-1 -right-1`
- Line ~215: prepared dot span with `bg-emerald-500 ring-1`
- Line ~251: `<ArrowCircleDown size={14} className={downloading ? 'animate-spin' : ''} />`

- [ ] **Step 2: Update the icon imports**

Replace the existing `@phosphor-icons/react` import line:

```tsx
import {
  ArrowCircleDown,
  Check,
  CheckCircle,
  CircleNotch,
  HardDrive,
  Trash,
  X,
  SoundcloudLogo,
  YoutubeLogo,
  TiktokLogo,
  MusicNote,
} from '@phosphor-icons/react'
```

- [ ] **Step 3: Replace the prepared dot with an icon badge**

Find this block (around line 215):
```tsx
          {song.prepared && !isDownloaded && (
            <span className="absolute -bottom-0.5 -left-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500 ring-1 ring-[var(--color-bg)]" />
          )}
```

Replace with:
```tsx
          {song.prepared && !isDownloaded && (
            <span className="absolute -bottom-1 -left-1 w-4 h-4 rounded-full bg-[var(--color-bg)] flex items-center justify-center">
              <HardDrive size={11} weight="fill" className="text-emerald-500" />
            </span>
          )}
```

- [ ] **Step 4: Fix the download button animation**

Find this inside the download button (around line 251):
```tsx
              <ArrowCircleDown size={14} className={downloading ? 'animate-spin' : ''} />
              {downloading ? 'Preparing...' : 'Download'}
```

Replace with:
```tsx
              {downloading
                ? <CircleNotch size={14} className="animate-spin" />
                : <ArrowCircleDown size={14} />
              }
              {downloading ? 'Preparing...' : 'Download'}
```

- [ ] **Step 5: TypeScript check**

```bash
cd /path/to/project/web && npx tsc --noEmit
```

Expected: zero errors, exit 0.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/SongRow.tsx
git commit -m "feat: improve prepared badge and download spinner in SongRow"
```
