# Song Row Tooltips + Mobile Swipe Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native tooltips to the desktop mark-downloaded/remove buttons in the song row, and rework the mobile swipe gesture so swiping left reveals both mark-downloaded and remove buttons together (instead of two separate swipe directions), with the mark button recolored to the app's accent color on both desktop and mobile.

**Architecture:** Single-file change to `web/src/components/SongRow.tsx`. The touchmove/touchend swipe handlers move from a two-sided clamp (`[-DELETE_WIDTH, +MARK_WIDTH]`) to a single-sided clamp (`[-revealWidth, 0]`), where `revealWidth` depends on whether the song is already downloaded (64px, remove only) or not (128px, mark + remove). Render output for the mobile revealed area changes from two separate absolutely-positioned buttons (one per swipe direction) to two buttons stacked in the same revealed strip (mark on the left, remove flush right).

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, `@phosphor-icons/react`. No test framework is configured in this repo (no vitest/jest, no test script in `web/package.json`) — see Global Constraints for how tasks are verified instead.

## Global Constraints

- Scope is limited to `web/src/components/SongRow.tsx`. No backend/API changes, no changes to `SettingsSheet.tsx` or any other file.
- No test framework exists in this repo. Every task is verified manually: run the app, interact with it in a browser, confirm the described behavior. Do not add a testing framework as part of this plan — spec marks that out of scope.
- Tooltips use the native HTML `title` attribute only — no tooltip library or custom component.
- Mark-downloaded button color changes from hardcoded green (`bg-green-500` / `hover:text-green-500`) to `var(--color-accent)` on both desktop and mobile. Remove/delete button color is unchanged (stays error/red).
- Swipe-right-to-cancel-swipe-left must keep working: the clamp/snap logic must be position-based (`baseSwipeX + dx`, clamped), never direction-based, so dragging right while the row is open closes it via the same code path as opening.
- Exact copied values from spec: `DELETE_WIDTH = 64`, `MARK_WIDTH = 64`, `SNAP_THRESHOLD = 40`, `MOVE_SLOP = 8`. Reveal width = `MARK_WIDTH + DELETE_WIDTH` (128px) when not downloaded, `DELETE_WIDTH` (64px) when downloaded.

---

## How to run the app for manual verification (all tasks)

Two terminals, from repo root:

```bash
# Terminal 1 — backend
cd api && uvicorn main:app --reload --port 8000

# Terminal 2 — frontend
cd web && npm run dev
```

Open the printed Vite URL (default `http://localhost:5173`) in a browser. For mobile swipe testing, open Chrome DevTools → toggle device toolbar (Ctrl+Shift+M / Cmd+Shift+M) → pick any mobile device preset so touch events fire — the swipe gesture code only runs on `touchmove`/`touchend`, not mouse events, so testing without device emulation will not trigger it.

You need at least one song in the library that is **not** downloaded to see the mark button. If the library is empty, add any song URL via the "Add song" form first.

---

### Task 1: Desktop tooltips + accent color

**Files:**
- Modify: `web/src/components/SongRow.tsx:288-305`

**Interfaces:** None — this task only touches JSX attributes on existing buttons, no new functions or state.

- [ ] **Step 1: Add tooltip + accent color to the desktop mark-downloaded button**

Find this block (currently around line 288):

```tsx
          {!isDownloaded && (
            <button
              onClick={handleMarkDownloaded}
              className="opacity-0 group-hover:opacity-100 cursor-pointer p-1 rounded text-[var(--color-text-muted)] hover:text-green-500 transition-all hidden md:flex"
              aria-label="Mark as downloaded"
            >
              <CheckCircle size={13} />
            </button>
          )}
```

Replace it with:

```tsx
          {!isDownloaded && (
            <button
              onClick={handleMarkDownloaded}
              className="opacity-0 group-hover:opacity-100 cursor-pointer p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-accent)] transition-all hidden md:flex"
              aria-label="Mark as downloaded"
              title="Mark as downloaded"
            >
              <CheckCircle size={13} />
            </button>
          )}
```

- [ ] **Step 2: Add tooltip to the desktop remove button**

Find this block (currently around line 299):

```tsx
          {/* Desktop-only — hidden on mobile (swipe-to-delete handles it there) */}
          <button
            onClick={() => onDelete(song.id)}
            className="opacity-0 group-hover:opacity-100 cursor-pointer p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-all hidden md:flex"
            aria-label="Remove song"
          >
            <X size={13} />
          </button>
```

Replace it with:

```tsx
          {/* Desktop-only — hidden on mobile (swipe-to-delete handles it there) */}
          <button
            onClick={() => onDelete(song.id)}
            className="opacity-0 group-hover:opacity-100 cursor-pointer p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-all hidden md:flex"
            aria-label="Remove song"
            title="Remove song"
          >
            <X size={13} />
          </button>
```

- [ ] **Step 3: Manually verify**

Start the app per the instructions above (backend + frontend). In a normal desktop browser window (no device emulation), hover over a song row:
- Confirm a small accent-colored (not green) check-circle icon appears on hover for an un-downloaded song, and hovering the icon itself for ~1 second shows a native tooltip reading "Mark as downloaded".
- Confirm hovering the X icon shows a native tooltip reading "Remove song".
- Confirm the X icon itself is still red/error-colored on hover (unchanged).

- [ ] **Step 4: Commit**

```bash
git add web/src/components/SongRow.tsx
git commit -m "feat: add tooltips and accent color to desktop song row actions"
```

---

### Task 2: Mobile swipe rework — single-direction reveal + accent color

**Files:**
- Modify: `web/src/components/SongRow.tsx` (constants, state derivation order, touchmove effect, touchend handler, mobile button render, overlay render)

**Interfaces:**
- Consumes: `isDownloaded` (existing derived boolean, `song.downloaded || isJustDownloaded || localDownloaded`), `DELETE_WIDTH`/`MARK_WIDTH` constants (existing, values unchanged).
- Produces: `revealWidth: number` — new derived value, `isDownloaded ? DELETE_WIDTH : MARK_WIDTH + DELETE_WIDTH`. Used by the touchmove clamp, touchend snap target, and the mobile overlay's `right` offset.

- [ ] **Step 1: Move the `isDownloaded` derivation above the touchmove effect**

Find (currently around line 107-109, right after the touchmove `useEffect` block):

```tsx
  const PlatformIcon = PLATFORM_ICONS[song.platform]
  const isDownloaded = song.downloaded || isJustDownloaded || localDownloaded
  const isDisabled = downloading || anyDownloading || isBatchRunning
```

Replace it with just:

```tsx
  const PlatformIcon = PLATFORM_ICONS[song.platform]
  const isDisabled = downloading || anyDownloading || isBatchRunning
```

(The `isDownloaded` line is deleted from here — it moves earlier, added in Step 2 below.)

- [ ] **Step 2: Add `isDownloaded` and `revealWidth` before the touchmove effect**

Find the end of the `setSwipeX` helper (currently around line 69-72):

```tsx
  function setSwipeX(x: number) {
    swipeXRef.current = x
    setSwipeXState(x)
  }
```

Add immediately after it (before the `// Non-passive touchmove listener...` comment and its `useEffect`):

```tsx
  function setSwipeX(x: number) {
    swipeXRef.current = x
    setSwipeXState(x)
  }

  const isDownloaded = song.downloaded || isJustDownloaded || localDownloaded
  const revealWidth = isDownloaded ? DELETE_WIDTH : MARK_WIDTH + DELETE_WIDTH
```

- [ ] **Step 3: Update the touchmove effect to single-sided clamp**

Find (currently around line 77-105):

```tsx
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
        const newX = Math.max(Math.min(touchStart.current.baseSwipeX + dx, MARK_WIDTH), -DELETE_WIDTH)
        swipeXRef.current = newX
        setSwipeXState(newX)
      }
    }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [isSelectMode])
```

Replace it with:

```tsx
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
        const newX = Math.max(Math.min(touchStart.current.baseSwipeX + dx, 0), -revealWidth)
        swipeXRef.current = newX
        setSwipeXState(newX)
      }
    }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [isSelectMode, revealWidth])
```

(Only the clamp line and the dependency array changed — `MARK_WIDTH` ceiling is now `0`, `-DELETE_WIDTH` floor is now `-revealWidth`, and `revealWidth` is added to the deps array since the effect's closure reads it.)

- [ ] **Step 4: Update the touchend handler's snap target**

Find (currently around line 125-137):

```tsx
  function handleTouchEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    if (!swipeDragging.current) return
    swipeDragging.current = false
    setSnapping(true)
    const x = swipeXRef.current
    const target = x > SNAP_THRESHOLD && !isDownloaded ? MARK_WIDTH : x < -SNAP_THRESHOLD ? -DELETE_WIDTH : 0
    swipeXRef.current = target
    setSwipeXState(target)
  }
```

Replace it with:

```tsx
  function handleTouchEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    if (!swipeDragging.current) return
    swipeDragging.current = false
    setSnapping(true)
    const x = swipeXRef.current
    const target = x < -SNAP_THRESHOLD ? -revealWidth : 0
    swipeXRef.current = target
    setSwipeXState(target)
  }
```

- [ ] **Step 5: Replace the mobile button render block**

Find (currently around line 168-196 — the swipe-right mark button, the swipe-left delete button, and both overlays):

```tsx
      {/* Mobile mark-as-downloaded button — sits behind row content, revealed by swiping right */}
      {swipeX > 0 && !isDownloaded && (
        <button
          onClick={handleMarkDownloaded}
          aria-label="Mark as downloaded"
          className="absolute left-0 top-0 bottom-0 w-16 md:hidden flex items-center justify-center bg-green-500 text-white"
        >
          <CheckCircle size={18} />
        </button>
      )}

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
      {swipeX > 0 && (
        <div
          className="absolute inset-y-0 right-0 z-10"
          style={{ left: MARK_WIDTH }}
          onClick={() => setSwipeX(0)}
        />
      )}
```

Replace it with:

```tsx
      {/* Mobile mark-as-downloaded button — revealed by swiping left, sits left of the remove button */}
      {!isDownloaded && (
        <button
          onClick={handleMarkDownloaded}
          aria-label="Mark as downloaded"
          title="Mark as downloaded"
          className="absolute top-0 bottom-0 w-16 md:hidden flex items-center justify-center bg-[var(--color-accent)] text-white"
          style={{ right: DELETE_WIDTH }}
        >
          <CheckCircle size={18} />
        </button>
      )}

      {/* Mobile delete button — sits behind row content, revealed by swiping left, flush against the right edge */}
      <button
        onClick={() => onDelete(song.id)}
        aria-label="Remove song"
        title="Remove song"
        className="absolute right-0 top-0 bottom-0 w-16 md:hidden flex items-center justify-center bg-[var(--color-error)]/90 text-white"
      >
        <Trash size={18} />
      </button>

      {/* Invisible overlay covering the row content area when swipe is open.
          Captures taps to close the swipe without triggering row actions. */}
      {swipeX < 0 && (
        <div
          className="absolute inset-y-0 left-0 z-10"
          style={{ right: revealWidth }}
          onClick={() => setSwipeX(0)}
        />
      )}
```

- [ ] **Step 6: Manually verify — not-yet-downloaded song**

With the app running (backend + frontend, per the setup instructions above) and device emulation on in DevTools:
- Find a song that is not downloaded. Swipe its row left. Confirm two buttons are revealed together: an accent-colored circle-check "mark as downloaded" button, then a red trash "remove" button flush against the right edge — total revealed width should look like two 64px buttons side by side (128px).
- Tap the mark-as-downloaded button. Confirm it calls the mark-downloaded action (row updates to show downloaded state — check-circle badge appears on the thumbnail) and the swipe closes.
- Swipe left again on a different not-yet-downloaded song, but this time — while still holding roughly midway — reverse direction and swipe back right without lifting. Confirm the row follows your finger back toward closed.
- Swipe a row fully open, release, then swipe right (drag right) and release before it re-crosses back near full-open. Confirm it snaps closed (swipe-right-to-cancel-swipe-left behavior).
- Tap the empty area of an open row (not on either button) — confirm it closes.

- [ ] **Step 7: Manually verify — already-downloaded song**

Mark a song as downloaded (or find one already downloaded). Swipe its row left. Confirm only the remove button is revealed (no mark button, no gap) — the reveal should be a single 64px-wide red trash button flush right, not 128px.

- [ ] **Step 8: Manually verify — desktop unaffected**

Switch DevTools back to normal desktop view (turn off device toolbar). Confirm the row still shows the hover-revealed accent mark button and red remove button from Task 1, and that there is no swipe/drag behavior expected or attempted on desktop (mouse drag does nothing, which is correct — the gesture only binds to touch events).

- [ ] **Step 9: Commit**

```bash
git add web/src/components/SongRow.tsx
git commit -m "feat: rework mobile swipe to reveal mark+remove together, single gesture"
```

---

## Self-Review Notes

- Spec section 1 (tooltips) → Task 1. Spec section 2 (mobile swipe rework, including swipe-right-to-cancel) → Task 2, Steps 1-5 (code) + Steps 6-7 (verification). Spec section 3 (accent color, both desktop and mobile) → Task 1 Step 1 (desktop) + Task 2 Step 5 (mobile). Spec's "swipe-right cancels swipe-left" requirement → Task 2 Step 6, explicitly verified, and called out in Global Constraints as a property of the position-based clamp (no direction-check code was introduced anywhere in Task 2).
- No placeholders: every step shows exact before/after code, exact file locations, and concrete manual verification instructions (no automated test infra exists in this repo, so none is fabricated).
- Type/name consistency checked: `revealWidth`, `isDownloaded`, `DELETE_WIDTH`, `MARK_WIDTH`, `SNAP_THRESHOLD`, `MOVE_SLOP` are used identically across both tasks' steps.
