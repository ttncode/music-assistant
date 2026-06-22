# Mobile UX — Multi-select Discoverability & Swipe-to-Delete Design

**Date:** 2026-06-22

---

## Overview

Two independent mobile UX improvements:

1. **Multi-select discoverability** — the existing "Select" button is buried in a horizontally-scrollable row and hard to find. Fix with long-press gesture + a visible button.
2. **Swipe-to-delete** — remove button is hidden behind hover on mobile. Fix with swipe-left gesture to reveal delete. Desktop behavior unchanged.

These are frontend-only changes. No backend or API changes.

---

## Feature 1: Multi-select Entry on Mobile

### Problem

The "Select" button lives inside the horizontally-scrollable playlist pill row (as the last item). On mobile, it is off-screen and requires deliberate horizontal scrolling to find. Most users won't discover it.

### Solution

Two complementary changes:

**A. Long-press to enter select mode**

Pressing and holding any song row for 300 ms enters select mode and auto-selects that song. This is the standard native mobile pattern (iOS Photos, Android Files).

Behavior:
- Touch down → start a 300 ms timer
- If finger lifts before 300 ms → cancel timer, treat as normal tap
- If 300 ms elapses without lift → call `onEnterSelectMode()`, call `onToggle(song.id)`, provide haptic feedback via `navigator.vibrate(30)` where supported
- If finger moves more than 8 px before 300 ms → cancel timer (user is scrolling, not long-pressing)
- Long-press is disabled when already in select mode

**B. Always-visible "Select" button**

Move the "Select" pill out of the scrollable playlist row. Place it as a small icon-and-text button (`md:hidden`) inlined with the search bar row — right side, inside the search row container.

Layout of the search row after change:
```
[ 🔍 Search songs...              ] [☑ Select]
```

The button uses `CheckSquare` icon from `@phosphor-icons/react` at size 14, with label "Select". It calls `onEnterSelectMode`. Hidden on `md+` screens (desktop uses always-visible checkboxes).

Remove the current "Select" pill from the scrollable playlist row in `FilterBar.tsx`.

### Props Changes

`SongRow` gets one new prop:
```ts
onEnterSelectMode: () => void
```

`SongList` gets one new prop:
```ts
onEnterSelectMode: () => void
```

`App.tsx` passes `enterSelectMode` (already in `useSelection`) to `SongList`, which threads it to each `SongRow`.

`FilterBar` keeps `onEnterSelectMode` (already present) — it now wires it to the new search-row button instead of the scrollable pill.

---

## Feature 2: Swipe Left to Reveal Delete (Mobile Only)

### Problem

The delete (✕) button on each song row is only visible on hover (`group-hover:opacity-100`). Hover does not exist on touch screens, so on mobile there is no discoverable way to remove a song without entering settings or other flows.

### Solution

Swipe left on a song row reveals a red delete button from the right edge. Desktop behavior is unchanged.

### Interaction Spec

| Gesture | Result |
|---|---|
| Swipe left ≥ 40 px | Snap to open state (content translated −64 px, delete button fully visible) |
| Swipe left < 40 px, release | Spring back to closed |
| Swipe right while open | Close |
| Tap delete button | Call `onDelete(song.id)`, close |
| Tap anywhere else while open | Close |
| During select mode | Swipe disabled; touch goes to checkbox toggle |
| Desktop | No change — hover-only delete button retained |

### Layout

The row container is `position: relative; overflow: hidden`.

```
┌─────────────────────────────────────────┐
│  [row content — translates left]  [del] │  ← delete button: absolute right-0
└─────────────────────────────────────────┘
```

Delete button: `position: absolute; right: 0; top: 0; bottom: 0; width: 64px`. Red background (`var(--color-error)` with opacity), white trash icon, visible at all times but revealed only when content slides.

Row content `div`: `transform: translateX(swipeX)` with `transition: transform 150ms ease` when snapping (transition disabled during active drag for responsiveness).

### Touch Event Logic (inside `SongRow`)

```ts
const DELETE_WIDTH = 64
const SNAP_THRESHOLD = 40
const SWIPE_CANCEL_SLOP = 8  // px vertical movement to cancel swipe

swipeX: number  // 0 = closed, -DELETE_WIDTH = open (local state)
isTransitioning: boolean  // true during snap animation
touchStartX: useRef
touchStartY: useRef
isDragging: useRef  // true once horizontal intent confirmed
```

- `onTouchStart`: record `startX`, `startY`, set `isDragging = false`
- `onTouchMove`: on first move, check if `|deltaX| > |deltaY|` — if yes, `isDragging = true` and `e.preventDefault()` to block scroll. While `isDragging`, `setSwipeX(clamp(deltaX + currentSwipeX, -DELETE_WIDTH, 0))`, disable transition.
- `onTouchEnd`: if not `isDragging`, ignore. If `swipeX < -SNAP_THRESHOLD`, snap to `-DELETE_WIDTH`; else snap to `0`. Enable transition for snap.

### Select Mode Interaction

When `isSelectMode` is true, `onTouchStart`/`onTouchMove`/`onTouchEnd` handlers are not attached (or short-circuit immediately). This prevents swipe from interfering with checkbox tap in select mode.

### Long-press + Swipe Coexistence

Long-press uses a `setTimeout` that is cancelled if `onTouchMove` fires with movement > 8 px. Swipe activation requires horizontal movement intent. They do not conflict.

---

## Files Changed

| File | Change |
|---|---|
| `web/src/components/SongRow.tsx` | Add `onEnterSelectMode` prop; long-press handler; swipe-to-delete touch logic |
| `web/src/components/SongList.tsx` | Add `onEnterSelectMode` prop, thread to each `SongRow` |
| `web/src/components/FilterBar.tsx` | Remove "Select" from scrollable row; add icon button next to search bar |
| `web/src/App.tsx` | Pass `enterSelectMode` to `SongList` |

---

## Testing

No automated tests (frontend interaction tests are out of scope per project convention).

Manual verification:
1. **Long-press on mobile** — press-hold any song ≥ 300 ms → select mode entered, song checked
2. **Long-press cancelled by scroll** — start press-hold, move finger 10 px → no select mode, normal scroll
3. **"Select" button visible** — without scrolling, "Select" button is visible next to search bar on mobile; hidden on desktop
4. **Swipe delete on mobile** — swipe left on song → delete button revealed; tap it → song removed
5. **Swipe below threshold** — short swipe left, release → snaps back
6. **Swipe disabled in select mode** — enter select mode, swipe on a row → no swipe, checkbox toggles instead
7. **Desktop unaffected** — hover shows delete button, no checkboxes visible until clicked, no swipe
