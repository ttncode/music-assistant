# Frontend A11y/Perf Fixes — Design

Date: 2026-08-02
Related: `docs/audits/2026-08-02-frontend-quality-audit.md`

## Context

A web-quality audit of `web/` (React 19 + Vite 6 + Tailwind 4 PWA) surfaced several findings. Four were approved for a fix pass:

1. `SettingsSheet` acts as a modal but has no dialog semantics, focus trap, or Escape handling.
2. `FilterBar`'s playlist-source tooltip only responds to mouse hover, invisible to keyboard/touch users.
3. `useSongs` polls the API every 10s even when the tab/app is backgrounded.
4. `index.html` has no meta description.

These four are independent — no shared code path, no ordering dependency. Each is scoped to a single file.

## 1. SettingsSheet dialog semantics

**File:** `web/src/components/SettingsSheet.tsx`

**Approach:** Replace the outer `<div className="fixed inset-0 z-50 ...">` wrapper with a native `<dialog>` element, imperatively opened/closed via a ref.

- Add `const dialogRef = useRef<HTMLDialogElement>(null)`.
- `useEffect(() => { if (open) dialogRef.current?.showModal(); else dialogRef.current?.close() }, [open])`.
- The panel's own `onClose` prop already fires on backdrop click and the X button; also listen for the dialog's native `close` event (fired on Escape) and call `onClose` there too, so Escape produces the same state transition as clicking backdrop/X.
- Backdrop click-to-close: `<dialog>` has no `absolute inset-0` backdrop div anymore (that pattern assumed manual layering). Keep click-outside detection via `onClick` on the `<dialog>` itself, checking `e.target === dialogRef.current` (native `::backdrop` clicks bubble to the dialog element, clicks inside the panel content do not reach it because the panel is a nested element — stop propagation isn't needed since inner content is a separate child div).
- Reset default `<dialog>` UA styles: `margin: 0`, remove default border/padding/background, keep existing Tailwind classes for sizing/position (`fixed inset-0` no longer needed on the dialog itself once it's top-layer; the inner panel div keeps its `w-full max-w-sm ... h-full` classes for the slide-over look).
- No manual focus trap or initial-focus code needed — `showModal()` gives native focus containment and moves initial focus per browser default (first focusable descendant, or the dialog itself if none). Focus returns to the triggering element (the gear icon button in `Header.tsx`) automatically when `close()` is called, per native `<dialog>` behavior.

**Testing:** manual — open settings, Tab through controls and confirm focus never leaves the panel; press Escape and confirm panel closes and focus returns to the gear icon; click backdrop and confirm same.

## 2. FilterBar tooltip focus/touch support

**File:** `web/src/components/FilterBar.tsx`

**Approach:**
- Change tooltip state shape from `{ label, x, y } | null` to `{ label: string; x: number; y: number; forPlaylist: string } | null`.
- Add `onFocus`/`onBlur` handlers to each playlist button, identical trigger logic to the existing `onMouseEnter`/`onMouseLeave` (same `getBoundingClientRect` positioning), setting/clearing `tooltipInfo` the same way.
- Give the tooltip element a stable `id="playlist-source-tooltip"` and `role="tooltip"`.
- Each playlist button gets `aria-describedby={tooltipInfo?.forPlaylist === pl ? 'playlist-source-tooltip' : undefined}` — only the button currently showing the tooltip gets the reference, others stay `undefined` (omitted attribute).
- No change to visual appearance or positioning logic — this only adds keyboard/touch trigger parity and the ARIA link.

**Testing:** manual — Tab to a playlist pill with a platform source, confirm tooltip appears; Tab away, confirm it disappears; verify with a screen reader that the description is announced on focus.

## 3. useSongs pause-on-hidden polling

**File:** `web/src/hooks/useSongs.ts`

**Approach:**
- Keep the existing `fetch` callback and initial `fetch()` call on mount unchanged.
- Replace the bare `setInterval(fetch, 10_000)` with a ref-held interval id (`const intervalId = useRef<ReturnType<typeof setInterval> | null>(null)`), extracted into a small `startPolling()` / `stopPolling()` pair defined inside the effect.
- Add a `document.addEventListener('visibilitychange', handleVisibilityChange)` in the same effect. `handleVisibilityChange`: if `document.hidden`, call `stopPolling()`; else call `fetch()` immediately and `startPolling()`.
- Effect cleanup removes both the interval and the visibility listener.
- Behavior: polling runs normally while the tab is visible; the moment it's hidden, the interval stops (no wasted requests); the moment it's visible again, an immediate refetch happens plus the interval resumes — so data is never more than one "tab switch" stale.

**Testing:** manual — open devtools, throttle/hide tab (or use `document.dispatchEvent` in console to simulate `visibilitychange` with `Object.defineProperty(document, 'hidden', ...)`), confirm network tab shows polling stop/resume as expected. Existing behavior (10s poll while visible) must be unchanged.

## 4. index.html meta description

**File:** `web/index.html`

**Approach:** Add one line in `<head>`, near the existing `<title>`:

```html
<meta name="description" content="Personal music downloader for YouTube, SoundCloud, and TikTok playlists." />
```

No other changes.

## Non-goals

- Not touching the backend findings from the same audit (tracked separately, not in scope for this spec).
- Not changing `SettingsSheet`'s visual design, only its semantics/behavior.
- Not adding a focus-trap library or any new dependency — native `<dialog>` covers it.
- Not virtualizing or otherwise changing the song list — out of scope.

## Testing summary

All four changes are manual/visual + keyboard verification (no existing test suite covers UI interaction in `web/`; `api/tests/` is backend-only). Each fix should be verified independently per the steps above before commit.
