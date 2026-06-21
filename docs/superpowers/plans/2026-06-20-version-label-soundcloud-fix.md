# Version Label + SoundCloud Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the app version in the Settings sheet footer, and fix SoundCloud playlist sync which returns empty results due to fetching the wrong URL.

**Architecture:** Task 1 is frontend-only (Vite build-time injection + one component change). Task 2 is backend-only (one-line URL normalizer in the SoundCloud service + tests). No cross-task dependencies.

**Tech Stack:** React 19, TypeScript strict, Tailwind CSS v4, Vite (frontend); FastAPI, Python, pytest, yt-dlp (backend); Docker for running backend tests.

---

## File Map

| File | Task | Change |
|---|---|---|
| `web/vite.config.ts` | 1 | Add `define: { __APP_VERSION__ }` injected from package.json |
| `web/src/app-version.d.ts` | 1 | Create — TypeScript declaration for `__APP_VERSION__` global |
| `web/src/components/SettingsSheet.tsx` | 1 | Add version label paragraph after Account section |
| `api/services/soundcloud.py` | 2 | Add `_sets_url()` normalizer, use it in `fetch_soundcloud_playlists` |
| `api/tests/test_soundcloud.py` | 2 | Create — URL normalization tests + mocked extraction tests |

---

## Task 1: App Version Label

**Files:**
- Modify: `web/vite.config.ts`
- Create: `web/src/app-version.d.ts`
- Modify: `web/src/components/SettingsSheet.tsx`

There is no frontend test framework. Verification is TypeScript type check (`npx tsc -b --noEmit` inside `web/`) plus browser inspection.

- [ ] **Step 1: Update vite.config.ts to inject app version**

Replace the entire contents of `web/vite.config.ts` with:

```ts
import { readFileSync } from 'fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 2: Create the TypeScript declaration file**

Create `web/src/app-version.d.ts` with:

```ts
declare const __APP_VERSION__: string
```

This tells TypeScript that `__APP_VERSION__` is a globally available string (injected by Vite at build time). Without this file, `noUnusedLocals` strict mode will error on any reference to `__APP_VERSION__`.

- [ ] **Step 3: Add version label to SettingsSheet.tsx**

In `web/src/components/SettingsSheet.tsx`, find the closing of the Account section (line 164 `</section>`), just before the `</div>` that closes the `p-4 space-y-6` container (line 165). Insert the version paragraph between them:

Change:
```tsx
          </section>
        </div>
      </div>
```

To:
```tsx
          </section>

          <p className="text-[11px] text-[var(--color-text-muted)] pt-2">v{__APP_VERSION__}</p>
        </div>
      </div>
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /home/ttndev/workspace/personal/music-assistant/web && npx tsc -b --noEmit 2>&1
```

Expected: no output (zero errors).

- [ ] **Step 5: Commit**

```bash
git add web/vite.config.ts web/src/app-version.d.ts web/src/components/SettingsSheet.tsx
git commit -m "feat: show app version in settings footer"
```

---

## Task 2: SoundCloud URL Fix

**Files:**
- Modify: `api/services/soundcloud.py`
- Create: `api/tests/test_soundcloud.py`

**Background:** `fetch_soundcloud_playlists` calls yt-dlp on `https://soundcloud.com/username`, which returns the user's track stream (flat tracks, no playlist wrapper). The code then filters for `_type == "playlist"` entries — all entries fail the filter, so the result is always empty.

The correct URL is `https://soundcloud.com/username/sets`, which returns a two-level structure: playlist entries containing track entries. Fix: normalize the URL before passing it to yt-dlp.

**How to run tests:**

```bash
docker compose build --quiet && docker compose run --rm app python -m pytest tests/test_soundcloud.py -v 2>&1 | tail -20
```

The test container's working directory is `/app` (the `api/` directory contents). Test files live at `tests/` relative to that root.

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_soundcloud.py`:

```python
from unittest.mock import patch, MagicMock
from services.soundcloud import fetch_soundcloud_playlists, _sets_url


def test_sets_url_appends_sets():
    assert _sets_url('https://soundcloud.com/ttn-music') == 'https://soundcloud.com/ttn-music/sets'


def test_sets_url_preserves_existing_sets():
    assert _sets_url('https://soundcloud.com/ttn-music/sets') == 'https://soundcloud.com/ttn-music/sets'


def test_sets_url_strips_trailing_slash():
    assert _sets_url('https://soundcloud.com/ttn-music/') == 'https://soundcloud.com/ttn-music/sets'


def test_fetch_soundcloud_playlists_calls_sets_url():
    mock_info = {
        "entries": [
            {
                "_type": "playlist",
                "title": "My Mix",
                "entries": [
                    {"title": "Track 1", "url": "https://soundcloud.com/ttn-music/track-1", "thumbnail": ""},
                    {"title": "Track 2", "url": "https://soundcloud.com/ttn-music/track-2", "thumbnail": ""},
                ],
            }
        ]
    }
    with patch("services.soundcloud.yt_dlp.YoutubeDL") as mock_cls:
        mock_ydl = MagicMock()
        mock_ydl.extract_info.return_value = mock_info
        mock_cls.return_value.__enter__.return_value = mock_ydl

        result = fetch_soundcloud_playlists("https://soundcloud.com/ttn-music")

    mock_ydl.extract_info.assert_called_once_with(
        "https://soundcloud.com/ttn-music/sets", download=False
    )
    assert len(result) == 1
    assert result[0]["title"] == "My Mix"
    assert result[0]["platform"] == "soundcloud"
    assert len(result[0]["songs"]) == 2
    assert result[0]["songs"][0]["title"] == "Track 1"
    assert result[0]["songs"][1]["url"] == "https://soundcloud.com/ttn-music/track-2"


def test_fetch_soundcloud_playlists_skips_non_playlist_entries():
    mock_info = {
        "entries": [
            {"_type": "url", "title": "Loose Track", "url": "https://soundcloud.com/track"},
            {
                "_type": "playlist",
                "title": "Good Set",
                "entries": [
                    {"title": "T1", "url": "https://soundcloud.com/t1", "thumbnail": ""},
                ],
            },
        ]
    }
    with patch("services.soundcloud.yt_dlp.YoutubeDL") as mock_cls:
        mock_ydl = MagicMock()
        mock_ydl.extract_info.return_value = mock_info
        mock_cls.return_value.__enter__.return_value = mock_ydl

        result = fetch_soundcloud_playlists("https://soundcloud.com/ttn-music")

    assert len(result) == 1
    assert result[0]["title"] == "Good Set"


def test_fetch_soundcloud_playlists_returns_empty_on_no_info():
    with patch("services.soundcloud.yt_dlp.YoutubeDL") as mock_cls:
        mock_ydl = MagicMock()
        mock_ydl.extract_info.return_value = None
        mock_cls.return_value.__enter__.return_value = mock_ydl

        result = fetch_soundcloud_playlists("https://soundcloud.com/ttn-music")

    assert result == []
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
docker compose build --quiet && docker compose run --rm app python -m pytest tests/test_soundcloud.py -v 2>&1 | tail -20
```

Expected: `ImportError: cannot import name '_sets_url' from 'services.soundcloud'` — confirms the tests are exercising the not-yet-written code.

- [ ] **Step 3: Implement the fix in soundcloud.py**

Replace the entire contents of `api/services/soundcloud.py` with:

```python
import yt_dlp


def _sets_url(profile_url: str) -> str:
    url = profile_url.rstrip('/')
    return url if url.endswith('/sets') else url + '/sets'


def fetch_soundcloud_playlists(profile_url: str) -> list[dict]:
    """Extract all playlists and tracks from a SoundCloud profile using yt-dlp flat extraction."""
    ydl_opts = {
        "quiet": True,
        "extract_flat": "in_playlist",
        "ignoreerrors": True,
    }
    playlists = []
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(_sets_url(profile_url), download=False)
        if not info:
            return []
        entries = info.get("entries", [])
        for entry in entries:
            if not entry or entry.get("_type") != "playlist":
                continue
            songs = []
            for track in entry.get("entries", []) or []:
                if not track:
                    continue
                songs.append({
                    "title": track.get("title", track.get("url", "")),
                    "url": track.get("url", ""),
                    "thumbnail": track.get("thumbnail", ""),
                })
            playlists.append({"title": entry.get("title", ""), "platform": "soundcloud", "songs": songs})
    return playlists
```

The only changes from the original are: removal of the unused `from pathlib import Path` import, addition of `_sets_url()`, and using `_sets_url(profile_url)` instead of `profile_url` in the `extract_info` call.

- [ ] **Step 4: Run tests to confirm they pass**

```bash
docker compose build --quiet && docker compose run --rm app python -m pytest tests/test_soundcloud.py -v 2>&1 | tail -20
```

Expected:
```
tests/test_soundcloud.py::test_sets_url_appends_sets PASSED
tests/test_soundcloud.py::test_sets_url_preserves_existing_sets PASSED
tests/test_soundcloud.py::test_sets_url_strips_trailing_slash PASSED
tests/test_soundcloud.py::test_fetch_soundcloud_playlists_calls_sets_url PASSED
tests/test_soundcloud.py::test_fetch_soundcloud_playlists_skips_non_playlist_entries PASSED
tests/test_soundcloud.py::test_fetch_soundcloud_playlists_returns_empty_on_no_info PASSED
6 passed
```

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
docker compose run --rm app python -m pytest -v 2>&1 | tail -15
```

Expected: all previously passing tests still pass, plus the 6 new soundcloud tests.

- [ ] **Step 6: Commit**

```bash
git add api/services/soundcloud.py api/tests/test_soundcloud.py
git commit -m "fix: normalize SoundCloud profile URL to /sets before fetching playlists"
```
