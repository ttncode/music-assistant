# Platform Filter + TikTok Playlist — Design

**Date:** 2026-06-20  
**Scope:** Three related improvements — a platform filter row in the UI, a persistent TikTok playlist, and TikTok downloads saving songs to the shared library.

---

## 1. Platform Filter Row

### Goal

Let users filter the song list by platform (YouTube, SoundCloud, TikTok) independently of the active playlist and search text. All three platforms always show, regardless of whether songs exist.

### UI

A new horizontal-scrollable row of pills added as the **first row** in `FilterBar`, above the existing playlist pills. The row renders four pills:

| Pill | Icon | Color |
|---|---|---|
| All | — | — |
| YouTube | `YoutubeLogo` | `var(--color-platform-youtube)` |
| SoundCloud | `SoundcloudLogo` | `var(--color-platform-soundcloud)` |
| TikTok | `TiktokLogo` | `var(--color-platform-tiktok)` |

Active pill: accent background + white text (same style as active playlist pill). Inactive pills: surface background + secondary text, icon at its brand color.

### State & Props

`activePlatform: 'all' | 'youtube' | 'soundcloud' | 'tiktok'` — added to `App.tsx`, default `'all'`.

New FilterBar props:
- `activePlatform: 'all' | 'youtube' | 'soundcloud' | 'tiktok'`
- `onPlatformChange: (p: 'all' | 'youtube' | 'soundcloud' | 'tiktok') => void`

New SongList prop:
- `activePlatform: 'all' | 'youtube' | 'soundcloud' | 'tiktok'`

### Filter Logic

A song is visible if all three conditions pass:

```
matchPlaylist  = activePlaylist === 'All' || s.playlist === activePlaylist
matchSearch    = !search || s.title.toLowerCase().includes(search.toLowerCase())
matchPlatform  = activePlatform === 'all' || s.platform === activePlatform
```

`SongList.tsx` applies `matchPlatform` in its existing `filtered` computation. `App.tsx`'s `filteredUndownloadedIds` (used for "Select all undownloaded") also applies `matchPlatform`.

`SongList` already resets page to 1 via `useEffect` on `[activePlaylist, search]` — add `activePlatform` to that dependency array.

### Files Changed

- `web/src/App.tsx` — add `activePlatform` state, update `filteredUndownloadedIds`, pass new props
- `web/src/components/FilterBar.tsx` — add platform row (import `TiktokLogo`), new props
- `web/src/components/SongList.tsx` — add `activePlatform` prop + filter condition + `useEffect` dep

No backend changes for this section.

---

## 2. TikTok Playlist — Always Present

### Goal

The "TikTok" playlist appears in the sidebar for all users, even before any TikTok song has been added.

### Approach

`GET /api/songs` response always includes `"TikTok"` in `playlists` and `playlist_sources["TikTok"] = "tiktok"`, injected in the endpoint after reading from the store.

```python
# In get_songs(), after building songs_out:
playlists = list(data.playlists)
if "TikTok" not in playlists:
    playlists.append("TikTok")
playlist_sources = dict(data.playlist_sources)
playlist_sources["TikTok"] = "tiktok"
return {"songs": songs_out, "playlists": playlists, "playlist_sources": playlist_sources}
```

The store is not modified — the injection is response-only. This avoids writing to disk just for a default playlist.

### Files Changed

- `api/routers/songs.py` — `get_songs` endpoint

---

## 3. TikTok Download → Shared Library

### Goal

When User A downloads a TikTok song, it is added to the shared library under the "TikTok" playlist. User B syncs and sees it; User B can download it via the normal song download flow.

### Current Behaviour

`POST /api/download/tiktok` downloads to a `tempfile.TemporaryDirectory`, returns the blob, deletes the temp dir. No library entry is created.

### New Behaviour

`POST /api/download/tiktok`:

1. Check if URL already in library (by `url` field match).
2. **If not in library:**
   - Download to `music_dir/TikTok/` (persistent directory, same as other playlists).
   - Create a `Song` entry: `title = Path(mp3_path).stem`, `url = body.url`, `platform = "tiktok"`, `playlist = "TikTok"`, `manually_added = True`.
   - Append to `data.songs`.
   - Ensure `"TikTok"` is in `data.playlists` and `data.playlist_sources["TikTok"] = "tiktok"`.
3. **If already in library:**
   - Use the existing song's `playlist` to locate the file via `get_file_path`.
   - If file is missing, re-download.
4. Mark as downloaded for the requesting device (same pattern as `serve_download`).
5. Write data to store once.
6. Return file bytes as `Response` (same headers as before, using RFC 5987 encoding).

The endpoint changes `_: str = Depends(get_device_id)` to `device_id: str = Depends(get_device_id)` so the download is tracked.

### Imports to Add

`api/routers/download.py` needs `Song` from `models` (already imports `DeviceDownload`).

### Files Changed

- `api/routers/download.py` — `download_tiktok` endpoint
- `api/tests/test_download.py` — add tests for the new behaviour (see Testing below)

---

## 4. Testing

### Backend

`api/tests/test_download.py` — add two new tests:

- `test_tiktok_download_adds_song_to_library` — mock `download_song`, call the endpoint, verify the song appears in the store under playlist "TikTok" and `playlist_sources["TikTok"] == "tiktok"`.
- `test_tiktok_download_deduplicates_by_url` — add a TikTok song to the store first, then call the endpoint with the same URL, verify only one entry remains in `data.songs`.

`api/tests/test_songs.py` — add one test:

- `test_get_songs_always_includes_tiktok_playlist` — call `GET /api/songs` on an empty store, verify `"TikTok"` in `playlists` and `playlist_sources["TikTok"] == "tiktok"`.

### Frontend

No test framework — verification is `npx tsc -b --noEmit` (zero errors) from `web/`.

---

## Summary

| File | Change |
|---|---|
| `web/src/App.tsx` | `activePlatform` state, updated `filteredUndownloadedIds`, pass new props to FilterBar + SongList |
| `web/src/components/FilterBar.tsx` | Platform filter row (always-shown pills with brand icons/colors) |
| `web/src/components/SongList.tsx` | `activePlatform` prop, filter condition, `useEffect` dependency |
| `api/routers/songs.py` | Inject TikTok into playlists/playlist_sources in response |
| `api/routers/download.py` | Save TikTok download to library, track device download |
| `api/tests/test_download.py` | 2 new tests for library persistence and deduplication |
| `api/tests/test_songs.py` | 1 new test for always-present TikTok playlist |
