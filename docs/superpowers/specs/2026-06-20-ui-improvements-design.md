# UI Improvements — Design Spec
**Date:** 2026-06-20

## Overview

Four small, independent UI improvements to the Music Assistant web frontend.

---

## 1. Auth Screen — Admin Contact Guideline

### Goal
Guide users who don't have an access code to contact the admin rather than guessing or getting stuck.

### Change
In `AuthScreen.tsx`, replace the existing single-line subtitle with two paragraphs:

1. Original instruction: `"Enter your access code to continue."`
2. New contact line: `"Don't have an access code? Contact the admin at "` followed by a `mailto:` anchor for `ttn.dev.fullstack@gmail.com`.

### Styling
- Both lines use `text-[var(--color-text-secondary)] text-sm`, consistent with the existing subtitle.
- The email link uses `text-[var(--color-accent)] underline-offset-2 hover:underline` so it reads as a clickable link without breaking the visual hierarchy.
- No layout changes. The two lines sit in the same `space-y-4` form flow.

### Files
- `web/src/components/AuthScreen.tsx`

---

## 2. Clear History — Refresh Downloaded Status

### Goal
After a user clears their download history, all songs must visually reflect their new undownloaded state immediately — including songs downloaded earlier in the same session.

### Root Cause
Two local caches stay stale after `refetch()`:
- `justDownloaded: Set<string>` in `App.tsx` — accumulates IDs from batch downloads this session.
- `localDownloaded: boolean` in each `SongRow` — set to `true` on a single-song download within the session.

`song.downloaded` from the API is correctly reset after `refetch()`, but both local caches override it via `isDownloaded = song.downloaded || isJustDownloaded || localDownloaded`.

### Fix

**`App.tsx`:**
- Add `const [historyVersion, setHistoryVersion] = useState(0)`.
- In `onHistoryCleared`: call `setJustDownloaded(new Set())` and `setHistoryVersion(v => v + 1)` alongside the existing `refetch()`.
- Pass `historyVersion` through `SongList` → `SongRow`.

**`SongList.tsx`:**
- Accept and forward `historyVersion: number` prop to each `SongRow`.

**`SongRow.tsx`:**
- Accept `historyVersion: number` prop.
- Add `useEffect(() => { setLocalDownloaded(false) }, [historyVersion])`.

### Files
- `web/src/App.tsx`
- `web/src/components/SongList.tsx`
- `web/src/components/SongRow.tsx`

---

## 3. Select All — Preserve Existing Checked Songs

### Goal
Clicking "Select All" (or "Select All Undownloaded") while some songs are already checked should add the undownloaded songs to the selection, not replace it.

### Root Cause
`handleSelectAllUndownloaded` in `App.tsx` calls `selectAll(filteredUndownloadedIds)`, which sets `selected = new Set(ids)`, discarding any previously checked songs that are already downloaded.

### Fix
Change `handleSelectAllUndownloaded` to union the current selection with the undownloaded IDs:

```ts
const handleSelectAllUndownloaded = useCallback(() => {
  selectAll([...new Set([...selected, ...filteredUndownloadedIds])])
}, [selectAll, filteredUndownloadedIds, selected])
```

No changes needed to `useSelection.ts` — `selectAll` already accepts any array of IDs.

### Files
- `web/src/App.tsx`

---

## 4. Playlist Badge — Platform Tooltip on Hover

### Goal
When a user hovers over a playlist pill in the filter bar, show a small tooltip indicating the source platform (e.g., "YouTube", "SoundCloud").

### Data
`useSongs` already returns `playlistSources: Record<string, string>` (playlist name → lowercase platform, e.g. `{ "Boost Energy": "youtube" }`). `App.tsx` receives it from `useSongs` but doesn't pass it to `FilterBar`.

### Approach
Custom CSS tooltip using Tailwind's `group` hover pattern — consistent with the app's visual style. Native `title` attribute is not used as it renders inconsistently across OS/browser.

### Display Name Mapping
```ts
const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  tiktok: 'TikTok',
}
```
Unknown or missing platforms show no tooltip. The "All" pill shows no tooltip.

### Tooltip Structure (per pill)
```
<div class="relative group/tooltip">
  <button>  {/* existing pill */} </button>
  <span class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded text-[10px] bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] whitespace-nowrap opacity-0 pointer-events-none group-hover/tooltip:opacity-100 transition-opacity">
    YouTube
  </span>
</div>
```

### Files
- `web/src/App.tsx` — pass `playlistSources` to `FilterBar`
- `web/src/components/FilterBar.tsx` — accept `playlistSources` prop, render tooltips

---

## Testing

Each change is visually verifiable:

1. **Auth screen:** Open the app unauthenticated — verify the contact line and clickable email link appear.
2. **Clear history:** Download a song manually (sets `localDownloaded`), run a batch download (sets `justDownloaded`), then clear history — verify all downloaded badges disappear immediately.
3. **Select All:** Check a downloaded song, then click "Select All" — verify the already-checked song stays checked.
4. **Playlist tooltip:** Hover over a playlist pill — verify tooltip appears with correct platform name. Hover "All" — verify no tooltip.
