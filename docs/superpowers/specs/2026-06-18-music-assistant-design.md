# Music Assistant — Design Spec
**Date:** 2026-06-18  
**Status:** Approved

---

## 1. Product Overview

A personal music manager running locally on a laptop, exposed via Ngrok so any device (iPhone, iPad, second laptop) can access it through a browser. Users sync playlists from YouTube and SoundCloud, download songs as MP3 320kbps to their device, and track download status independently per device.

**Single owner, multiple devices. No cloud hosting. No cost.**

---

## 2. Hard Constraints

| Constraint | Detail |
|---|---|
| No cloud hosting | Runs locally via Docker, exposed via Ngrok |
| No database | `songs.json` is the single source of truth |
| No cost | All tools are free/open-source |
| No Spotify | DRM prevents download — removed from scope |
| MP3 320kbps | Always re-encode to MP3 at highest quality via ffmpeg |
| Per-device tracking | Each device is independent — download status never shared between devices |
| Simple access control | Single access code stored in `.env` |

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────┐
│  Docker Compose (laptop)                              │
│                                                       │
│  ┌─────────────────────┐  ┌──────────────────────┐  │
│  │  FastAPI :8000       │  │  React + Vite :5173  │  │
│  │  - REST API          │  │  - UI (PWA)          │  │
│  │  - yt-dlp (Python)   │  │                      │  │
│  │  - YouTube API v3    │  │                      │  │
│  └──────────┬───────────┘  └──────────────────────┘  │
│             │                                         │
│  ┌──────────▼────────────────────────────────────┐   │
│  │  Docker Volumes                                │   │
│  │  /data/songs.json    ← metadata + tracking     │   │
│  │  /music/             ← downloaded MP3 files    │   │
│  │  (mapped to ~/Music/MusicManager/ on host)     │   │
│  └───────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
         │
         │  Ngrok tunnel (user runs manually)
         ▼
   Any device (iPhone, iPad, second laptop)
   Opens website in browser (Documents app on iPhone)
   Downloads MP3 via browser file download
```

### Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.12 + FastAPI |
| Frontend | React 19 + Vite + Tailwind v4 |
| Styling | Tailwind v4 + shadcn/ui (customized) + Motion |
| Icons | Phosphor Icons |
| Music download | yt-dlp + ffmpeg |
| Data | `songs.json` (file on Docker volume) |
| Containerization | Docker Compose |
| External access | Ngrok (user-managed) |

---

## 4. Configuration (`.env`)

```env
ACCESS_CODE=yourpassphrase
YOUTUBE_API_KEY=AIza...
YOUTUBE_CHANNEL_ID=UCxxxxxx
SOUNDCLOUD_PROFILE_URL=https://soundcloud.com/yourname
MUSIC_DIR=/music
DATA_DIR=/data
```

No other secrets needed. No database credentials, no OAuth tokens.

---

## 5. Data Model (`songs.json`)

```typescript
interface SongsFile {
  songs: Song[]
  playlists: string[]
  devices: Device[]
}

interface Song {
  id: string             // UUID v4
  title: string          // from YouTube/SoundCloud API, or fallback to URL
  url: string            // original source URL, never modified
  platform: 'youtube' | 'soundcloud' | 'tiktok' | 'other'
  playlist: string       // playlist name from source platform
  thumbnail: string      // thumbnail URL or ''
  added_at: string       // ISO 8601
  device_downloads: {
    [deviceId: string]: {
      name: string       // human-readable device name
      downloaded: boolean
      downloaded_at: string | null  // ISO 8601 or null
    }
  }
}

interface Device {
  id: string             // UUID v4, generated on first visit
  name: string           // user-assigned (e.g. "iPhone Main", "Work Laptop")
  last_seen: string      // ISO 8601
}
```

### Invariants

1. `id` never changes after creation.
2. Duplicate detection uses exact `url` match.
3. `device_downloads[deviceId].downloaded` is only set `true` after a successful file download and HTTP response completion.
4. `platform` is inferred from URL regex — never user-input.
5. Playlists array is kept in sync as songs are added; no cleanup required when a playlist becomes empty.
6. TikTok songs are NOT saved to `songs.json` — they are on-demand only.

### File download once, tracked per device

The MP3 file is downloaded from the internet **once** (by whichever device first requests it) and saved to `/music/<playlist>/<title>.mp3`. Subsequent devices requesting the same song are served from this cached file instantly. The **tracking** in `device_downloads` is independent per device.

---

## 6. Platform Integration

### YouTube

- **Auth:** YouTube Data API v3 with API key (no OAuth — playlists are public)
- **Sync:** Fetch all playlists for `YOUTUBE_CHANNEL_ID`, then fetch all videos in each playlist
- **Download:** yt-dlp with `format: bestaudio/best` + ffmpeg re-encode to MP3 320kbps
- **Metadata:** title + thumbnail from YouTube Data API response

### SoundCloud

- **Auth:** None — yt-dlp extracts public playlist metadata without API key
- **Sync:** yt-dlp `--flat-playlist` on `SOUNDCLOUD_PROFILE_URL` to get all playlists + tracks
- **Download:** yt-dlp with same options as YouTube
- **Metadata:** title + thumbnail from yt-dlp extraction

### TikTok

- **Sync:** None — manual link only, not saved to `songs.json`
- **Download:** User pastes TikTok URL, server downloads on-demand, streams to browser
- **No tracking** — TikTok downloads are ephemeral

---

## 7. Audio Quality Policy

All downloads use:

```python
ydl_opts = {
    "format": "bestaudio/best",
    "writethumbnail": True,
    "postprocessors": [
        {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "320"},
        {"key": "FFmpegMetadata", "add_metadata": True},
        {"key": "EmbedThumbnail"},
    ],
    "nooverwrites": True,
}
```

- `bestaudio/best` fetches the highest quality audio stream from the source
- ffmpeg re-encodes to MP3 320kbps — consistent format across all platforms
- `nooverwrites: True` — if file already exists on disk, skip re-download
- Thumbnail embedded in MP3 metadata

---

## 8. API Endpoints

All endpoints except `/api/auth/verify` and `/api/devices/register` require a valid `device_id` (UUID stored in localStorage, sent as query param or header).

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/auth/verify` | Verify access code. Returns `{ ok: true }` or 401 |
| `POST` | `/api/devices/register` | Register device name, receive UUID. Body: `{ name: string }` |
| `GET` | `/api/songs?device_id=` | All songs with per-device download status |
| `POST` | `/api/sync` | Pull YouTube + SoundCloud playlists, add new songs to songs.json |
| `GET` | `/api/sync/status` | Current sync job status (running / done / error + counts) |
| `GET` | `/api/download/{song_id}?device_id=` | Stream MP3 to browser, mark downloaded |
| `POST` | `/api/download/tiktok?device_id=` | On-demand TikTok. Body: `{ url: string }` |
| `DELETE` | `/api/songs/{song_id}` | Remove song from list (does not delete file on disk) |
| `DELETE` | `/api/devices/{device_id}/history` | Clear download history for a device (with confirmation in UI) |

### Response conventions

```
200 OK           — success
201 Created      — new resource created
400 Bad Request  — missing/invalid parameters
401 Unauthorized — wrong access code or missing device_id
404 Not Found    — song/device not found
409 Conflict     — duplicate URL on POST /api/songs
500 Server Error — yt-dlp failure, API error, etc.
```

### Download flow detail

```
GET /api/download/{song_id}?device_id=abc
  │
  ├─ Resolve file path: /music/<playlist>/<title>.mp3
  │
  ├─ File exists? ──Yes──► StreamingResponse(file) → mark downloaded
  │
  └─ No ──► yt-dlp download → save to /music/ → StreamingResponse → mark downloaded
                │
                └─ On error → return 500, do NOT mark downloaded
```

### Sync flow detail

```
POST /api/sync
  │
  ├─ Start background task (FastAPI BackgroundTasks)
  │
  ├─ Fetch YouTube: all playlists → all videos per playlist
  │
  ├─ Fetch SoundCloud: yt-dlp flat extract on profile URL
  │
  ├─ For each discovered song:
  │    └─ Check url in existing songs.json
  │         ├─ Exists → skip
  │         └─ New → append with downloaded: false for all devices
  │
  └─ Write updated songs.json
     └─ Return { added: N, total: M }
```

---

## 9. Auth & Device Identity

### Access code

- Single code stored in `.env` as `ACCESS_CODE`
- Verified via `POST /api/auth/verify`
- On success: device registration screen shown
- No JWT, no sessions — device UUID in localStorage is the persistent identity

### Device registration flow (first visit)

```
1. Visit the app → localStorage has no device UUID
2. Show access code screen
3. Enter correct code → show device naming screen
4. User types device name (e.g. "iPhone Main")
5. POST /api/devices/register → server returns UUID
6. UUID + device name stored in localStorage
7. Main app loads
```

### Subsequent visits

```
LocalStorage has UUID → skip auth → load main app directly
```

### Edge case: localStorage cleared

User gets a new UUID on next visit → appears as new device with zero download history. This is acceptable and expected.

---

## 10. Download History Management

Users can clear their download history from the device settings panel:

- Shows a confirmation dialog: "This will mark all songs as undownloaded for [device name]. The MP3 files are not deleted."
- On confirm: server sets `device_downloads[deviceId].downloaded = false` for all songs
- Use case: when re-downloading everything on a new iPhone after factory reset, or after moving the Documents app library

---

## 11. UI / UX Specification

### Design read

> "Reading this as: personal utility PWA for a single technical user, with a dark tech / premium minimalist language, leaning toward Tailwind v4 + shadcn/ui customized (never default state) + Motion for subtle state transitions, mobile-first."

### Dial settings

- **DESIGN_VARIANCE: 5** — clean, structured, functional. Not artsy. A tool.
- **MOTION_INTENSITY: 4** — subtle. Download progress, state transitions, skeleton loaders. No spectacle.
- **VISUAL_DENSITY: 6** — medium-high density. This is a song list — many items, compact rows.

### Color palette (dark mode only)

```
Background:       #0a0a0a   (zinc-950 near-black)
Surface:          #141414   (cards, panels)
Surface elevated: #1c1c1c   (hover states, modals)
Border:           #262626   (zinc-800)
Text primary:     #fafafa   (zinc-50)
Text secondary:   #71717a   (zinc-500)
Text muted:       #3f3f46   (zinc-700)
Accent:           #10b981   (emerald-500) — downloaded state, CTAs
Accent muted:     #064e3b   (emerald-950) — accent backgrounds
Pending:          #71717a   (neutral gray)
Error:            #ef4444   (red-500)
```

Platform badge colors:
- YouTube: `#ef4444` (red)
- SoundCloud: `#f97316` (orange)
- TikTok: `#06b6d4` (cyan)

### Typography

- **Primary font:** Geist Sans (self-hosted)
- **Mono font:** Geist Mono (for metadata, counts, badges)
- No serif fonts

### Screen layout

```
┌─────────────────────────────────────────┐
│  HEADER (sticky)                         │
│  Music Assistant          [⚙] [↻ Sync]  │
│                              (3 pending) │
├─────────────────────────────────────────┤
│  ADD SONG                                │
│  [Paste YouTube, SoundCloud, TikTok URL] │
│  [Select playlist ▾]          [+ Add]   │
├─────────────────────────────────────────┤
│  FILTER BAR                              │
│  [All] [Chill] [Workout] [Lo-fi]        │
│  [🔍 Search songs...]                   │
├─────────────────────────────────────────┤
│  SONG LIST                               │
│  ┌─────────────────────────────────┐    │
│  │ [thumb] Title           ↓  [×]  │    │
│  │         youtube · Chill  ✓ Done │    │
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │ [thumb] Title 2         ↓  [×]  │    │
│  │         soundcloud · Workout    │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

### Component details

**Header**
- App name (left)
- Settings gear icon (right, opens settings sheet)
- Sync button (right, badge shows pending count for current device)
- Sticky top, `backdrop-blur` on scroll

**Add song form**
- Single URL input (full width)
- Playlist selector: dropdown of existing playlists + "New playlist..." option
- If "New playlist..." selected: inline text input appears
- Submit button — disabled during loading, shows spinner
- On success: clear input, show toast "Added: [title]"
- On duplicate: toast "Already in your list"

**Filter bar**
- Playlist pills: "All" + one per playlist in `playlists` array
- Search input: client-side filter on title
- Both filters apply simultaneously (AND)

**Song row**
- Thumbnail (40x40, rounded-sm, fallback = platform icon)
- Title (truncated, clickable → opens original URL in new tab)
- Platform badge (small colored pill)
- Playlist tag (muted text)
- Download status: emerald checkmark + "Done" if downloaded, gray circle if not
- Download button (↓ icon): triggers download for current device
  - Shows progress state: spinner while downloading
  - Disabled + checkmark when already downloaded
- Delete button (× icon): removes song from list entirely (confirmation toast with undo option, 5s)

**TikTok quick download** (bottom of add form, or separate tab)
- Labeled "TikTok Quick Download"
- URL input + Download button
- File downloads immediately to browser
- Not saved to song list

**Settings sheet** (slide in from right)
- Device name (editable)
- "Clear my download history" with confirmation dialog
- Manage devices: list all registered devices, option to remove
- YouTube API key + Channel ID (editable)
- SoundCloud Profile URL (editable)
- Ngrok URL info (read-only reminder)

### States

**Empty state** (no songs yet):
```
[music note icon]
No songs yet.
Paste a YouTube or SoundCloud link above to get started.
```

**No search results:**
```
No songs match "[query]"
```

**Download progress:**
- Song row shows inline progress: spinner + "Downloading..."
- For long downloads, subtle progress bar (indeterminate) within the row

**Sync running:**
- Sync button shows spinner, disabled
- Toast: "Syncing playlists..."
- On complete: toast "Added N new songs"

**Error states:**
- Failed download: inline error in song row "Download failed — retry"
- Failed sync: toast "Sync failed: [reason]"

### PWA

- `manifest.json` with `display: standalone`, dark `theme_color: #0a0a0a`
- `apple-mobile-web-app-capable` meta tag
- App icon 192x192 and 512x512 (to be generated)
- Works when added to iPhone Home Screen via Documents app or Safari

---

## 12. Project Structure

```
music-assistant/
├── docker-compose.yml
├── .env.example
├── api/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py                  # FastAPI app entry point
│   ├── routers/
│   │   ├── auth.py              # /api/auth/verify
│   │   ├── devices.py           # /api/devices/*
│   │   ├── songs.py             # /api/songs
│   │   ├── sync.py              # /api/sync
│   │   └── download.py          # /api/download/*
│   ├── services/
│   │   ├── songs_store.py       # read/write songs.json
│   │   ├── youtube.py           # YouTube Data API v3 client
│   │   ├── soundcloud.py        # yt-dlp SoundCloud extractor
│   │   └── downloader.py        # yt-dlp download + ffmpeg
│   └── models.py                # Pydantic models
└── web/
    ├── Dockerfile
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    ├── public/
    │   ├── manifest.json
    │   └── icons/
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── components/
        │   ├── Header.tsx
        │   ├── AddSongForm.tsx
        │   ├── FilterBar.tsx
        │   ├── SongList.tsx
        │   ├── SongRow.tsx
        │   ├── TikTokDownload.tsx
        │   └── SettingsSheet.tsx
        ├── hooks/
        │   ├── useDevice.ts      # device UUID + name from localStorage
        │   ├── useSongs.ts       # fetch + cache songs
        │   └── useSync.ts        # trigger sync, poll status
        ├── lib/
        │   ├── api.ts            # typed API client
        │   └── utils.ts
        └── styles/
            └── globals.css
```

---

## 13. Docker Compose

FastAPI serves both the API and the built React static files on a single port. This means one Ngrok tunnel works for both the UI and API calls — React uses relative URLs (`/api/...`) so it works identically on localhost and via Ngrok.

```yaml
services:
  app:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - ./data:/data
      - ~/Music/MusicManager:/music
    env_file: .env
    restart: unless-stopped
```

Single `Dockerfile` at root:
1. Build React (`npm run build` → `web/dist/`)
2. FastAPI serves `web/dist/` via `StaticFiles` on `/`, API routes on `/api/`

User runs `docker compose up` once. Ngrok is run separately:
```bash
ngrok http 8000
```

On iPhone, the Ngrok URL is opened in Documents app browser. The URL changes each Ngrok restart — user updates it manually (acceptable for personal use).

**Development mode** (without Docker):
- `uvicorn main:app` on port 8000
- `vite` dev server on port 5173 with `/api` proxy to `http://localhost:8000`

---

## 14. Non-Goals (intentionally excluded)

- No Spotify (DRM)
- No audio streaming / playback within the app
- No multi-user accounts
- No song editing (title, playlist reassignment)
- No drag-and-drop reordering
- No statistics or analytics
- No dark/light toggle (dark only)
- No rate-limiting on the access code endpoint
- No automatic Ngrok management (user runs it manually)
- No file deletion when a song is removed (metadata only)

---

## 15. Open Questions (resolved)

| Question | Decision |
|---|---|
| Spotify? | Removed — DRM |
| Cloud hosting? | Local only via Docker + Ngrok |
| Download mechanism? | yt-dlp → MP3 320kbps → stream to browser |
| Device identity? | UUID in localStorage + user-assigned name |
| Playlist sync auth (YouTube)? | API key + channel ID (public playlists) |
| SoundCloud API? | yt-dlp flat extraction (no API key needed) |
| Audio quality? | Always MP3 320kbps via ffmpeg re-encode |
| File caching? | Yes — downloaded once to /music/, served to all devices |
| TikTok tracking? | No — ephemeral on-demand only |
