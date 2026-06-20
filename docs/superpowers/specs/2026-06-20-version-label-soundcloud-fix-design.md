# Version Label + SoundCloud Fix — Design

**Date:** 2026-06-20  
**Scope:** Two independent improvements — display the app version in Settings, and fix the SoundCloud playlist fetch that returns empty results.

---

## 1. App Version Label

### Goal

Show the current app version in a small muted label at the bottom of the Settings sheet so users can identify which version they're running.

### Approach

Inject the version from `web/package.json` at Vite build time using `define`. This is zero runtime cost — the value is replaced at build time as a string literal.

**`web/vite.config.ts`:** add a `define` entry:

```ts
import { readFileSync } from 'fs'
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  // ...existing config...
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
})
```

**`web/src/app-version.d.ts`:** declare the global so TypeScript doesn't complain:

```ts
declare const __APP_VERSION__: string
```

**`web/src/components/SettingsSheet.tsx`:** add a footer after the last section, inside the `p-4 space-y-6` div:

```tsx
<p className="text-[11px] text-[var(--color-text-muted)] pt-2">v{__APP_VERSION__}</p>
```

No new component needed. No API call. Version updates automatically when `package.json` version bumps.

---

## 2. SoundCloud Playlist Fetch Fix

### Root Cause

`api/services/soundcloud.py` calls `ydl.extract_info(profile_url)` where `profile_url` is a SoundCloud user profile URL (e.g. `https://soundcloud.com/ttn-music`). A profile URL returns the user's **track stream** — flat track entries, not playlists. The code then filters for `_type == "playlist"`, so every entry is skipped and the result is always empty.

The correct URL is `https://soundcloud.com/ttn-music/sets`, which returns a two-level structure: playlist entries → track entries. The status check (`_check_soundcloud` in `routers/status.py`) only does an HTTP GET to the profile URL and checks for HTTP 200, so it shows "connected" even though yt-dlp extracts nothing.

### Fix

Normalize the URL in `fetch_soundcloud_playlists` before passing it to yt-dlp:

```python
def _sets_url(profile_url: str) -> str:
    url = profile_url.rstrip('/')
    return url if url.endswith('/sets') else url + '/sets'
```

Call `_sets_url(profile_url)` instead of `profile_url` when invoking `ydl.extract_info`. The rest of the extraction logic is correct once the URL points to `/sets`.

**Files:** `api/services/soundcloud.py` only. No change to `config.py`, `sync.py`, or the status check (the reachability check is intentionally lightweight).

### Test

`api/tests/test_soundcloud.py` — unit test the URL normalization and the extraction logic with a mocked yt-dlp response:

```python
def test_sets_url_appends_sets():
    assert _sets_url('https://soundcloud.com/ttn-music') == 'https://soundcloud.com/ttn-music/sets'

def test_sets_url_preserves_existing_sets():
    assert _sets_url('https://soundcloud.com/ttn-music/sets') == 'https://soundcloud.com/ttn-music/sets'

def test_sets_url_strips_trailing_slash():
    assert _sets_url('https://soundcloud.com/ttn-music/') == 'https://soundcloud.com/ttn-music/sets'
```

For integration-level extraction, mock `yt_dlp.YoutubeDL` to return a two-level playlist structure and verify `fetch_soundcloud_playlists` returns the expected list.

---

## Summary

| # | File(s) | Change |
|---|---|---|
| 1 | `web/vite.config.ts`, `web/src/app-version.d.ts`, `web/src/components/SettingsSheet.tsx` | Inject version at build time, display in settings footer |
| 2 | `api/services/soundcloud.py`, `api/tests/test_soundcloud.py` | Normalize URL to `/sets`, add tests |

No backend API changes for item 1. No env var changes for item 2.
