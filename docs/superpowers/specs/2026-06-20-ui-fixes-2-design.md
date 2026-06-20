# UI Fixes & Enhancements (Round 2) — Design

**Date:** 2026-06-20  
**Scope:** Four small, independent UI fixes and enhancements to the React frontend.

---

## 1. Playlist Tooltip Fix

### Problem

The existing `group-hover` CSS tooltip on playlist badge pills is invisible. Root cause: `FilterBar.tsx` line 31 applies `overflow-x-auto` to the pills scroll container. Per the CSS spec, `overflow-x: auto` on an element forces `overflow-y` to also become `auto`, which clips any absolutely-positioned children that extend beyond the element's border box. The `absolute bottom-full` tooltip span is clipped before it becomes visible.

### Fix

Replace the CSS-only approach with React state + `position: fixed` tooltip.

**State in `FilterBar`:**
```tsx
const [tooltipInfo, setTooltipInfo] = useState<{ label: string; x: number; y: number } | null>(null)
```

**Per pill button:**
- `onMouseEnter`: call `getBoundingClientRect()` on the button, compute center-x and top-y, store `{ label, x, y }` into state
- `onMouseLeave`: clear state to `null`

**Tooltip element:** Rendered at the bottom of the `FilterBar` return, outside the scroll container, as a `fixed`-positioned div. `fixed` positioning places the element in the viewport coordinate space, bypassing all overflow constraints.

```tsx
{tooltipInfo && (
  <div
    className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full px-2 py-1 rounded text-[10px] bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] whitespace-nowrap"
    style={{ left: tooltipInfo.x, top: tooltipInfo.y - 6 }}
  >
    {tooltipInfo.label}
  </div>
)}
```

The wrapper `<div className="relative group/tooltip">` around each pill is removed — it's no longer needed. The `<span>` tooltip element is removed too. `PLATFORM_LABELS` map and the `platformLabel` variable are kept.

**Files:** `web/src/components/FilterBar.tsx` only.

---

## 2. `cursor: pointer` on All Interactive Elements

### Problem

Tailwind v4 preflight does not set `cursor: pointer` on `<button>` elements (the CSS spec default for buttons is `cursor: default`). All clickable buttons in the app show the default arrow cursor instead of the hand/pointer cursor, which hurts perceived interactivity on desktop.

### Fix

Add `cursor-pointer` class to every `<button>` in the frontend. Files affected:

| File | Buttons |
|---|---|
| `web/src/components/FilterBar.tsx` | Playlist pills, "Select" button |
| `web/src/components/SongRow.tsx` | Checkbox, "Download", delete (×) |
| `web/src/components/SongList.tsx` | Prev/next page buttons |
| `web/src/components/SettingsSheet.tsx` | Close (×), "Clear download history", "Unregister this device" |
| `web/src/components/SelectionBar.tsx` | All action buttons |
| `web/src/components/AuthScreen.tsx` | Submit button |
| `web/src/components/Header.tsx` | Sync, Settings buttons |

Disabled buttons should keep `cursor-pointer` — they show the pointer while disabled. The `disabled:` variant can override to `disabled:cursor-not-allowed` if preferred, but the baseline is `cursor-pointer`.

---

## 3. Unregister Confirmation

### Problem

The "Unregister this device" button in `SettingsSheet` calls `clear()` immediately on click with no confirmation. It also doesn't navigate back to the access code screen — the app state stays at `authState = 'ready'` because `App.tsx` has no listener for the device being cleared.

### Fix

**`SettingsSheet.tsx`:**

Add a new `confirmUnregister` state (string, starts empty) alongside the existing `confirmText` for clear history.

Replace the "Account" section's simple button with:
1. Description paragraph: *"This will remove this device. You'll need to re-enter your access code to use it again."*
2. Text input: placeholder `type "unregister" to confirm`, value bound to `confirmUnregister`
3. Button: disabled unless `confirmUnregister === 'unregister'`; on click, calls `clear()` then `onUnregistered()`

Add `onUnregistered: () => void` to the `Props` interface.

**`App.tsx`:**

Add `onUnregistered` prop to `<SettingsSheet>`:
```tsx
onUnregistered={() => setAuthState('needs_code')}
```

When `authState` becomes `'needs_code'`, the component returns `<AuthScreen>` early — the settings sheet disappears automatically as part of the re-render. No explicit `setSettingsOpen(false)` is needed.

---

## 4. Loading Skeleton

### Problem

`useSongs` has a `loading: boolean` state (starts `true`, goes `false` after first fetch), but it is unused in the UI. The song list area is blank during the initial load.

### Fix

**`App.tsx`:** Destructure `loading` from `useSongs()` and pass it to `<SongList loading={loading} />`.

**`SongList.tsx`:** Add `loading: boolean` to the `Props` interface. When `loading === true`, skip the empty-state checks and the filtered list render — instead return 5 skeleton rows:

```tsx
if (loading) {
  return (
    <div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] animate-pulse">
          <div className="shrink-0 w-10 h-10 rounded-md bg-[var(--color-surface-elevated)]" />
          <div className="flex-1 space-y-2">
            <div className="h-3 rounded bg-[var(--color-surface-elevated)] w-3/4" />
            <div className="h-2.5 rounded bg-[var(--color-surface-elevated)] w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}
```

The skeleton rows structurally mirror real rows (thumbnail placeholder + two text line placeholders), so the layout shift on load is minimal.

---

## Summary

| # | File(s) | Change |
|---|---|---|
| 1 | `FilterBar.tsx` | React state + fixed tooltip, remove group-hover wrapper |
| 2 | 7 component files | Add `cursor-pointer` to all `<button>` elements |
| 3 | `SettingsSheet.tsx`, `App.tsx` | Confirm input + `onUnregistered` callback + `setAuthState('needs_code')` |
| 4 | `SongList.tsx`, `App.tsx` | Pass `loading` prop, render skeleton rows when true |

No backend changes. No new dependencies.
