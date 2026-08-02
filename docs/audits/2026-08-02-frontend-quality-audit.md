# Frontend Quality Audit — Findings Selected for Fix

Date: 2026-08-02
Scope: `web/` (React 19 + Vite 6 + Tailwind 4 PWA)
Source: full web-quality-audit pass (performance, a11y, SEO, best practices). Full result list lives in conversation history; this doc tracks only the items approved for follow-up.

## Approved issues

### 1. SettingsSheet missing dialog semantics
- File: `web/src/components/SettingsSheet.tsx:83-92`
- Problem: Slide-over panel blocks background clicks (acts as modal) but has no `role="dialog"`/`aria-modal="true"`, no focus trap, no Escape-to-close, no initial focus movement into the panel.
- Fix: add dialog role + `aria-modal`, trap focus within panel, close on Escape key, move focus to first focusable control on open (and restore focus to trigger on close).

### 2. FilterBar playlist-source tooltip is mouse-only
- File: `web/src/components/FilterBar.tsx:96-100`
- Problem: Tooltip only wired to `onMouseEnter`/`onMouseLeave`. No focus or touch equivalent, no `aria-describedby` link between the button and the tooltip text.
- Fix: add `onFocus`/`onBlur` handlers alongside the mouse handlers, wire `aria-describedby` from the playlist button to the tooltip element.

### 3. useSongs polls every 10s regardless of tab visibility
- File: `web/src/hooks/useSongs.ts:28`
- Problem: `setInterval(fetch, 10_000)` keeps firing while `enabled`, with no `document.visibilitychange` guard — wastes battery/network when the installed PWA is backgrounded.
- Fix: pause the interval when `document.hidden`, resume and refetch immediately when the tab becomes visible again.

### 4. index.html missing meta description
- File: `web/index.html`
- Problem: No `<meta name="description">`. Low priority — app sits behind access-code auth, not meant for public indexing.
- Fix: add a one-line description only if the app is ever exposed publicly; otherwise skip.

## Status
All four items are tracked for spec + implementation. See `docs/superpowers/specs/` for the design doc once written.
