# Frontend A11y/Perf + Backend Security Fixes — Design

Date: 2026-08-02
Related: `docs/audits/2026-08-02-frontend-quality-audit.md`

## Context

A web-quality audit covered both `web/` (React 19 + Vite 6 + Tailwind 4 PWA) and `api/` (FastAPI). Nine findings total were approved for a fix pass — four frontend, five backend.

**Frontend:**
1. `SettingsSheet` acts as a modal but has no dialog semantics, focus trap, or Escape handling.
2. `FilterBar`'s playlist-source tooltip only responds to mouse hover, invisible to keyboard/touch users.
3. `useSongs` polls the API every 10s even when the tab/app is backgrounded.
4. `index.html` has no meta description.

**Backend:**
5. Access code isn't enforced server-side beyond `/api/auth/verify` — any client can register a device and use the full API without ever knowing the code.
6. Path traversal via playlist name — `_sanitize()` doesn't reject `".."`.
7. Non-constant-time access-code comparison in `/api/auth/verify`.
8. `yt-dlp` unpinned in `requirements.txt`.
9. No rate limit/lockout on `/api/auth/verify`.

All nine are independent — no shared code path, no ordering dependency — except #5 and #7/#9, which touch the same file (`api/routers/auth.py`) and are easiest to land together since #5's new registration-ticket endpoint is also where the rate limit and constant-time compare apply.

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

## 5. Access code not enforced server-side

**Files:** `api/routers/auth.py`, `api/routers/devices.py`

**Problem:** `/api/auth/verify` checks the code but issues nothing. `/api/devices/register` requires no code at all. Every other endpoint only requires the client-supplied `X-Device-ID` header. A client can skip `/verify` entirely and register+use the API freely.

**Approach — short-lived registration ticket:**
- `/api/auth/verify` (`api/routers/auth.py`), on a correct code, generates an opaque single-use token via `secrets.token_urlsafe(24)`, stores it in a module-level in-memory dict `_pending_tickets: dict[str, datetime]` (token → expiry, e.g. `now + timedelta(minutes=5)`), and returns `{"ok": true, "ticket": token}` instead of just `{"ok": true}`.
- `RegisterBody` (`api/routers/devices.py`) gains a required `ticket: str` field.
- `register_device` validates: ticket exists in `_pending_tickets`, not expired, then pops it (single-use) before proceeding. Missing/expired/unknown ticket → `401`.
- No signature/HMAC needed — the token is never decoded, only looked up in the server's own in-memory store, so a random opaque value is exactly as secure as a signed one here and needs no signing key.
- A process restart drops all pending tickets — acceptable, since a ticket is only meant to bridge the ~seconds between typing the code and naming the device; a user mid-flow during a restart just re-enters the code.
- Every endpoint *after* registration keeps trusting `X-Device-ID` exactly as today — `device_id`'s UUID4 entropy is the accepted trust anchor post-registration (this was already the low-severity item accepted in the audit); this fix only closes the gap at the registration boundary.

**Frontend changes required (small, follows from the above):**
- `api/auth.verify` response type gains `ticket: string`.
- `AuthScreen` passes the returned ticket up via `onVerified(ticket)` instead of `onVerified()`.
- `App.tsx` holds the ticket in state between `needs_code` and `needs_name`, passes it to `DeviceNameScreen`.
- `DeviceNameScreen` passes it through `useDevice().register(name, ticket)` → `api.devices.register(name, ticket)`.

**Testing:** `api/tests/test_auth.py` — verify returns a ticket on success; `api/tests/test_devices.py` — register fails without/with expired/reused ticket, succeeds with a fresh one from `/verify`.

## 6. Path traversal via playlist name

**File:** `api/services/downloader.py`

**Approach:** `_sanitize()` currently strips `\/:*?"<>|` but leaves dot-only segments untouched. Extend it:

```python
def _sanitize(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|]', "_", name).strip()
    if cleaned in ("", ".", ".."):
        return "_"
    return cleaned
```

This is the single choke point used by `download_song`, `get_file_path`, and `remove_song_files`, so fixing it here closes the traversal for all three call sites. A playlist literally named `".."` (or blank/`"."`) becomes `"_"` instead of escaping `music_dir`.

**Testing:** `api/tests/test_download.py` (or a new `test_downloader.py`) — assert `_sanitize("..")`, `_sanitize(".")`, `_sanitize("")` all return `"_"`, and that a song added with playlist `".."` downloads into `music_dir/_/`, not a parent directory.

## 7. Non-constant-time access-code comparison

**File:** `api/routers/auth.py`

**Approach:** Replace `if code != settings.access_code:` with `if not hmac.compare_digest(code, settings.access_code):` (`import hmac`). Both are `str`, which `compare_digest` supports directly.

**Testing:** existing `test_auth.py` cases (correct/incorrect code) still pass unchanged — this is a drop-in replacement, no behavior change on the happy/unhappy path, only removes the timing signal.

## 8. yt-dlp unpinned

**File:** `api/requirements.txt`

**Approach:** Pin to the currently-installed, known-working version: `yt-dlp==2026.7.4`. Future upgrades become an explicit, reviewable diff instead of a silent floating pull.

**Testing:** none needed — reinstall (`pip install -r requirements.txt`) and confirm existing sync/download tests still pass against the pinned version.

## 9. No rate limit/lockout on /api/auth/verify

**File:** `api/routers/auth.py`

**Approach — in-memory fixed-window limiter, scoped to this one endpoint:**
- Module-level dict `_attempts: dict[str, list[datetime]]` keyed by `request.client.host`.
- On each `/verify` call: drop timestamps older than the window (15 min), then if `len(remaining) >= 10`, return `429` with a `Retry-After` header; otherwise append `now()` to the list regardless of success/failure (both count toward the limit — only successful verification should additionally clear the client's own list, so a legitimate user isn't penalized for one earlier typo-then-success).
- Deliberately in-memory, no Redis/external store — the app runs as a single uvicorn process (`Dockerfile` `CMD` has no `--workers` flag), so process-local state is valid for the lifetime of the container.
- Known limitation to note in code comment: keyed by `request.client.host`, so if the app is ever placed behind a reverse proxy that doesn't forward the real client IP, all proxied clients share one bucket. Out of scope to fix proxy trust config here — flag it, don't solve it.

**Testing:** new test in `test_auth.py` — 11 rapid requests from the same client, assert the 11th is `429`; assert a successful verify resets the counter for that client.

## Non-goals

- Not changing `SettingsSheet`'s visual design, only its semantics/behavior.
- Not adding a focus-trap library or any new dependency — native `<dialog>` covers it.
- Not virtualizing or otherwise changing the song list — out of scope.
- Not moving rate-limit/ticket state to Redis or any external store — single-process in-memory is sufficient for this deployment.
- Not changing the post-registration trust model (`X-Device-ID` header) — only closing the registration-time gap.
- Not adding a distinct signing/HMAC secret for tickets — server-side opaque token lookup is sufficient.

## Testing summary

Frontend changes (#1-4) are manual/visual + keyboard verification — no existing test suite covers UI interaction in `web/`. Backend changes (#5-9) get real automated coverage in `api/tests/`, following the repo's existing pytest convention. Each fix should be verified independently per the steps above before commit.
