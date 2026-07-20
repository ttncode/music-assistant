# Song row tooltips + mobile swipe rework

## Context

`SongRow.tsx` renders each song in the playlist. Desktop shows hover-revealed
mark-as-downloaded and remove buttons; mobile currently uses two separate
swipe gestures — swipe-right reveals a mark-as-downloaded button, swipe-left
reveals a remove button. Users can't discover these actions on mobile without
already knowing the gesture, and the icon-only desktop buttons have no
tooltip.

Scope is limited to `web/src/components/SongRow.tsx`. No backend/API changes.

## 1. Tooltips (desktop)

Add native `title` attributes to the two icon-only actions:
- Mark-as-downloaded button: `title="Mark as downloaded"`
- Remove button: `title="Remove song"`

No tooltip library introduced — plain browser-native tooltips.

## 2. Mobile swipe rework

Replace the two independent gestures with a single swipe-left gesture that
reveals both actions together, mark-as-downloaded on the left, remove on the
right edge:

```
[ song content ]  <-- swipe left --  [Mark downloaded][Remove]
```

- Swipe-right-to-reveal-mark is removed entirely.
- Reveal width is `MARK_WIDTH + DELETE_WIDTH` (128px) when the song is not
  yet downloaded, or `DELETE_WIDTH` (64px) alone when it's already
  downloaded (mark button omitted, remove sits flush against the right
  edge).
- `swipeX` state is single-sided: clamped to `[-REVEAL_WIDTH, 0]` (no more
  positive range).
- Drag tracking stays position-based (`baseSwipeX + dx`, clamped), not
  direction-based. This means swiping right while the row is already open
  drags it back toward 0 the same way opening does in reverse — closing the
  row is not a separate code path, it falls out of the existing clamp/snap
  logic. Explicitly verify this during implementation: open the row, drag
  right, release before crossing back past `SNAP_THRESHOLD` from 0 → row
  must snap closed. This is a requirement, not incidental behavior — don't
  let a future refactor reintroduce a direction check that breaks it.
- Snap-on-release logic collapses to one branch:
  `target = x < -SNAP_THRESHOLD ? -REVEAL_WIDTH : 0`.
- The tap-to-close overlay (currently only rendered for the swipe-left/delete
  case) keeps working unchanged; the swipe-right-specific overlay branch is
  deleted along with the gesture.

## 3. Color change

Both the desktop hover mark-as-downloaded button and the mobile revealed
mark-as-downloaded button switch from hardcoded green
(`bg-green-500` / `hover:text-green-500`) to `var(--color-accent)`, matching
the rest of the UI's accent color. Remove button colors are unchanged
(stays error/red).

## Out of scope

- Settings/logout changes — dropped from this update.
- Any backend/API change.
- Custom tooltip component — native `title` only.
