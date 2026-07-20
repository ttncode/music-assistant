# Fix redownload on playlist move

## Context

Downloaded MP3s are stored on disk under `music_dir/<playlist>/`, with a
sidecar file (`.{url_hash}.done`) recording the MP3's path so
`get_file_path()` can tell whether a song was already downloaded. Sync
(`api/routers/sync.py`) matches songs by URL and deliberately updates
`existing.playlist` in place when a song moves to a different playlist on
the source platform (YouTube/SoundCloud) — same song id, same
`device_downloads`, just a new playlist value.

The bug: every caller of `get_file_path()` (`prepare_download`,
`serve_download` in `api/routers/download.py`, and `_auto_prepare_all` in
`api/routers/sync.py`) passes the song's *current* playlist. Once a song's
playlist changes, `get_file_path()` looks in the new playlist's folder,
doesn't find the sidecar (which is still in the old playlist's folder), and
the song is treated as not-yet-downloaded — triggering a full redownload.
The old MP3 + sidecar are never cleaned up, so a duplicate copy is left
behind under the old playlist folder permanently.

The music directory is a host-mounted volume
(`README.md`: `$HOME/Music/MusicManager` → `/music`) organized by playlist
subfolder so users can browse it directly (car stereo, phone sync, etc).
That organization is worth preserving — the fix must keep files correctly
sorted into their *current* playlist's folder, not flatten storage.

Scope: `api/services/downloader.py` only. No API, data model, or frontend
changes.

## Fix

Change `get_file_path(url, playlist, music_dir)`:

1. Check the sidecar in the current playlist's folder (`music_dir/<sanitized
   playlist>/.{url_hash}.done`) as today. If it exists, return the recorded
   path — unchanged fast path, no behavior change for songs whose playlist
   hasn't moved.
2. If not found there, scan every other immediate subdirectory of
   `music_dir` for a sidecar with the same `.{url_hash}.done` name (the hash
   is derived from the URL alone, so it's stable across playlist moves).
   For each match found:
   - If the sidecar's recorded MP3 path no longer exists on disk (stale
     sidecar — e.g. manually deleted), delete the stale sidecar and keep
     scanning other folders.
   - If the recorded MP3 does exist, this is the song's file living under
     its *old* playlist folder. Create the current playlist's folder if
     needed, move the MP3 into it, delete the old sidecar, write a new
     sidecar in the current playlist folder pointing at the moved file, and
     return the new path.
3. If no folder has a valid sidecar for this URL, return `None` — the song
   has genuinely never been downloaded; callers proceed with a real
   download exactly as today.

No caller of `get_file_path()` changes — `prepare_download`,
`serve_download`, and `_auto_prepare_all` already pass the song's current
playlist, which is exactly what the new logic needs. `remove_song_files()`
and `download_song()` are unchanged; sync's existing stale-cleanup path
(deleting files for songs whose URL disappeared from the source entirely)
is unaffected since it already uses the song's last-known playlist, which
is accurate at that point.

## Error handling

The only new failure path is a stale sidecar (recorded MP3 path no longer
exists). Handle it by deleting the stale sidecar and continuing the scan —
never raise. The directory scan itself only runs on a lookup miss (not on
every request), and is cheap: a handful of `Path.exists()` checks against
immediate subdirectories of `music_dir`.

## Testing

Backend has a real pytest suite (`api/tests/test_download.py`). Add:

- `get_file_path` finds a sidecar in a playlist folder different from the
  one requested, moves the MP3 into the requested playlist's folder,
  removes the old sidecar, and returns the new path.
- `get_file_path` encounters a stale sidecar (in a different folder,
  recorded MP3 missing) — it's deleted, and the function still returns
  `None` if no valid copy exists elsewhere.
- Existing three tests in `test_download.py`
  (`test_get_file_path_returns_none_when_not_downloaded`,
  `test_get_file_path_returns_path_when_sidecar_exists`,
  `test_download_song_calls_yt_dlp`) continue to pass unmodified.

## Out of scope

- Per-device "remove song" behavior and all-devices-purge cleanup — separate
  follow-up spec (Project 2), not part of this fix.
- Proactively sweeping `music_dir` for pre-existing duplicates — not part of
  this fix. In practice, any song still tracked in `songs.json` self-heals
  the next time its file is looked up (its stray copy gets found and moved
  per the flow above); only genuinely dangling files with no matching song
  record would be left untouched, and cleaning those up is not addressed
  here.
- Any change to `music_dir` layout, sidecar format, or folder-per-playlist
  organization.
