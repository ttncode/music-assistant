# UI Polish: Prepared Badge + Download Animation

**Date:** 2026-07-03

---

## Problem

1. **Prepared badge** — current `w-1.5 h-1.5` emerald dot at bottom-left of thumbnail is too small to notice. The downloaded badge (bottom-right) uses a `CheckCircle` icon in a white ring — clear and readable. Prepared badge should match that quality.

2. **Download animation** — `ArrowCircleDown` with `animate-spin` looks wrong. A spinning directional arrow reads as a broken animation. The app already uses `CircleNotch` as the standard loading spinner in `SelectionBar`.

---

## Solution

Both changes in `web/src/components/SongRow.tsx` only. No other files.

---

## Prepared Badge

Replace the dot span with a badge that mirrors the downloaded badge, at bottom-left:

**Before:**
```tsx
{song.prepared && !isDownloaded && (
  <span className="absolute -bottom-0.5 -left-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500 ring-1 ring-[var(--color-bg)]" />
)}
```

**After:**
```tsx
{song.prepared && !isDownloaded && (
  <span className="absolute -bottom-1 -left-1 w-4 h-4 rounded-full bg-[var(--color-bg)] flex items-center justify-center">
    <HardDrive size={11} weight="fill" className="text-emerald-500" />
  </span>
)}
```

`HardDrive` icon = "file on server disk". Emerald = established prepared color. Symmetric with the blue `CheckCircle` at bottom-right. Same `w-4 h-4` ring container as the downloaded badge.

---

## Download Animation

Replace `ArrowCircleDown` + `animate-spin` with `CircleNotch` while downloading:

**Before:**
```tsx
<ArrowCircleDown size={14} className={downloading ? 'animate-spin' : ''} />
{downloading ? 'Preparing...' : 'Download'}
```

**After:**
```tsx
{downloading
  ? <CircleNotch size={14} className="animate-spin" />
  : <ArrowCircleDown size={14} />
}
{downloading ? 'Preparing...' : 'Download'}
```

---

## Imports

Add `HardDrive` and `CircleNotch` to the `@phosphor-icons/react` import. Remove nothing else.

---

## Files Changed

| File | Change |
|---|---|
| `web/src/components/SongRow.tsx` | Replace prepared dot with HardDrive badge; swap spinning arrow to CircleNotch spinner |

No new dependencies. TypeScript check: `cd web && npx tsc --noEmit`.
