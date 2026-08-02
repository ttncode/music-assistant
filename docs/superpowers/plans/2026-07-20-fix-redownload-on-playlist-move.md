# Fix Redownload on Playlist Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop songs from being redownloaded when their playlist changes (e.g. moved to a different YouTube/SoundCloud playlist, picked up by sync), by making `get_file_path()` find and relocate an already-downloaded file that's sitting under a different playlist's folder instead of reporting it missing.

**Architecture:** Single function change in `api/services/downloader.py`: `get_file_path()` gets a fallback path — if the sidecar isn't in the requested playlist's folder, scan sibling playlist folders under `music_dir` for a sidecar matching the same URL hash, move the MP3 into the requested playlist's folder if found, and self-heal a stale sidecar (pointing at a deleted file) by removing it. No other file needs to change — every caller already passes the song's current playlist.

**Tech Stack:** Python, pytest (backend test suite already exists at `api/tests/`).

## Global Constraints

- Scope is limited to `api/services/downloader.py` and its test file
  `api/tests/test_download.py`. No API route changes, no data model changes,
  no frontend changes.
- `get_file_path(url, playlist, music_dir)`'s signature does not change —
  only its internal implementation. `download_song()` and
  `remove_song_files()` are not modified.
- Music files stay organized in `music_dir/<playlist>/` subfolders (this is
  a host-mounted volume users browse directly) — files are *moved* into the
  correct current-playlist folder, never flattened into a single directory.
- A stale sidecar (recorded MP3 path no longer exists on disk) must be
  deleted and scanning must continue to other folders, never raise an
  exception.

---

## How to run backend tests

No Python virtualenv exists yet for this backend. Set one up once:

```bash
cd api
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Run the relevant tests with:

```bash
cd api
.venv/bin/pytest tests/test_download.py -v
```

---

### Task 1: Self-healing `get_file_path()`

**Files:**
- Modify: `api/services/downloader.py:24-35` (the `get_file_path` function)
- Test: `api/tests/test_download.py`

**Interfaces:**
- Consumes: `_sanitize(name: str) -> str` and `_url_hash(url: str) -> str`
  (both already defined in `api/services/downloader.py`, unchanged).
- Produces: `get_file_path(url: str, playlist: str, music_dir: str) -> str |
  None` — same signature as today; callers (`api/routers/download.py`,
  `api/routers/sync.py`) need no changes.

- [ ] **Step 1: Write the failing test for relocation-on-move**

Add this test to `api/tests/test_download.py`, immediately after
`test_get_file_path_returns_path_when_sidecar_exists` (which ends at line
24) and before `test_download_song_calls_yt_dlp`:

```python
def test_get_file_path_relocates_file_from_different_playlist_folder(tmp_path):
    from services.downloader import get_file_path, _url_hash, _sanitize
    url = "https://youtube.com/watch?v=moved"
    old_folder = tmp_path / _sanitize("OldPlaylist")
    old_folder.mkdir()
    mp3 = old_folder / "Moved Song.mp3"
    mp3.write_text("fake")
    old_sidecar = old_folder / f".{_url_hash(url)}.done"
    old_sidecar.write_text(str(mp3))

    result = get_file_path(url, "NewPlaylist", str(tmp_path))

    new_folder = tmp_path / _sanitize("NewPlaylist")
    new_mp3 = new_folder / "Moved Song.mp3"
    assert result == str(new_mp3)
    assert new_mp3.exists()
    assert not mp3.exists()
    assert not old_sidecar.exists()
    assert (new_folder / f".{_url_hash(url)}.done").exists()
```

- [ ] **Step 2: Write the failing test for stale-sidecar cleanup**

Add this test right after the one from Step 1:

```python
def test_get_file_path_cleans_up_stale_sidecar_in_other_folder(tmp_path):
    from services.downloader import get_file_path, _url_hash, _sanitize
    url = "https://youtube.com/watch?v=gone"
    old_folder = tmp_path / _sanitize("OldPlaylist")
    old_folder.mkdir()
    old_sidecar = old_folder / f".{_url_hash(url)}.done"
    old_sidecar.write_text(str(old_folder / "Deleted Song.mp3"))  # mp3 never actually created

    result = get_file_path(url, "NewPlaylist", str(tmp_path))

    assert result is None
    assert not old_sidecar.exists()
```

- [ ] **Step 3: Run both new tests to verify they fail**

```bash
cd api && .venv/bin/pytest tests/test_download.py -k "relocates_file or cleans_up_stale" -v
```

Expected: both FAIL. The relocation test fails because `get_file_path`
returns `None` (current code only looks in the requested playlist's
folder). The stale-sidecar test fails because `old_sidecar.exists()` is
still `True` afterward (current code never touches other folders).

- [ ] **Step 4: Replace `get_file_path` with the self-healing implementation**

In `api/services/downloader.py`, replace the current function (lines
24-35):

```python
def get_file_path(url: str, playlist: str, music_dir: str) -> str | None:
    """Return path to existing MP3 for this URL if already downloaded, else None."""
    safe_playlist = _sanitize(playlist)
    folder = Path(music_dir) / safe_playlist
    if not folder.exists():
        return None
    # yt-dlp names files as %(title)s.mp3 — we can't know the exact name without extracting info
    # So we embed the song ID in a sidecar file instead (see download_song)
    sidecar = folder / f".{_url_hash(url)}.done"
    if sidecar.exists():
        return sidecar.read_text().strip()
    return None
```

with:

```python
def get_file_path(url: str, playlist: str, music_dir: str) -> str | None:
    """Return path to existing MP3 for this URL if already downloaded, else None.

    Self-heals across playlist moves: if the song was downloaded while it
    belonged to a different playlist, the file is found under that old
    playlist's folder and relocated into the current one here, so the song
    is never redownloaded just because its playlist changed.
    """
    # yt-dlp names files as %(title)s.mp3 — we can't know the exact name without extracting info
    # So we embed the song ID in a sidecar file instead (see download_song)
    hash_name = f".{_url_hash(url)}.done"
    safe_playlist = _sanitize(playlist)
    folder = Path(music_dir) / safe_playlist

    sidecar = folder / hash_name
    if sidecar.exists():
        return sidecar.read_text().strip()

    root = Path(music_dir)
    if not root.exists():
        return None

    for other in root.iterdir():
        if not other.is_dir() or other == folder:
            continue
        other_sidecar = other / hash_name
        if not other_sidecar.exists():
            continue
        old_mp3 = Path(other_sidecar.read_text().strip())
        if not old_mp3.exists():
            other_sidecar.unlink(missing_ok=True)
            continue
        folder.mkdir(parents=True, exist_ok=True)
        new_mp3 = folder / old_mp3.name
        old_mp3.rename(new_mp3)
        other_sidecar.unlink()
        sidecar.write_text(str(new_mp3))
        return str(new_mp3)

    return None
```

- [ ] **Step 5: Run the two new tests to verify they pass**

```bash
cd api && .venv/bin/pytest tests/test_download.py -k "relocates_file or cleans_up_stale" -v
```

Expected: both PASS.

- [ ] **Step 6: Run the full test file to check for regressions**

```bash
cd api && .venv/bin/pytest tests/test_download.py -v
```

Expected: all tests PASS, including the three pre-existing ones
(`test_get_file_path_returns_none_when_not_downloaded`,
`test_get_file_path_returns_path_when_sidecar_exists`,
`test_download_song_calls_yt_dlp`) and all the route tests below them.

- [ ] **Step 7: Run the full backend test suite**

```bash
cd api && .venv/bin/pytest -v
```

Expected: all tests PASS (this also exercises `test_sync.py`, which relies
on the same `get_file_path` through `_auto_prepare_all`).

- [ ] **Step 8: Commit**

```bash
git add api/services/downloader.py api/tests/test_download.py
git commit -m "fix: relocate downloaded file when song's playlist changes instead of re-downloading"
```

---

## Self-Review Notes

- Spec's "Fix" section (the 3-step lookup flow: current-folder hit, scan
  other folders for a match, relocate, fall through to `None`) →
  Task 1 Step 4 implements exactly this.
- Spec's "Error handling" section (stale sidecar deleted, scan continues,
  never raises) → Task 1 Step 4 handles it inline (`unlink(missing_ok=True)`
  + `continue`), covered by the Step 2 test.
- Spec's "Testing" section lists exactly two new tests plus "existing three
  tests continue to pass unmodified" → Task 1 Steps 1-2 (new tests),
  Step 6 (regression check on the same file), Step 7 (whole suite, since
  `_auto_prepare_all` in sync also depends on this function).
- Spec's "Out of scope" (no sweep of pre-existing dangling files, no
  `music_dir` layout change) → nothing in this plan touches layout or adds
  a sweep; confirmed no such task exists.
- No placeholders: both test bodies and the full replacement function are
  written out in full, no elided logic.
- Type/name consistency: `get_file_path(url: str, playlist: str, music_dir:
  str) -> str | None` matches its existing signature and both new tests'
  call patterns; `_sanitize` and `_url_hash` are used exactly as already
  defined elsewhere in the file, not redefined.
