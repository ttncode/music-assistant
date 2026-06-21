# Music Assistant

A self-hosted personal music manager that syncs YouTube and SoundCloud playlists and delivers MP3s to any device.

## Features

- **Playlist sync** — mirrors your YouTube channel playlists and SoundCloud profile, keeping additions, edits, deletions, and song order in sync
- **MP3 downloads** — 320 kbps via yt-dlp + ffmpeg, stored on your machine
- **Per-device tracking** — each device tracks its own download history independently
- **Batch download** — select multiple songs and download them all at once with progress tracking
- **TikTok on-demand** — paste a TikTok link for an instant one-off MP3 download
- **Platform filtering** — filter your library by YouTube, SoundCloud, or TikTok
- **Mobile-ready** — works on iPhone, Android, tablet, and desktop
- **Access code auth** — simple shared code keeps the app private
- **Dark UI** — React 19 + Tailwind v4, Phosphor icons, Geist font

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- A [YouTube Data API v3](https://console.cloud.google.com/apis/library/youtube.googleapis.com) key + your channel ID _(optional — skip if you only use SoundCloud)_
- Your SoundCloud profile URL _(optional — skip if you only use YouTube)_

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/ttncode/music-assistant.git
cd music-assistant

# 2. Create your environment file
cp .env.example .env
# Edit .env and fill in your values (see Environment Variables below)

# 3. Start the app
docker compose up -d --build

# 4. Open in browser
open http://localhost:8000
```

On first launch you will be prompted for the access code and a name for your device.

## Deploy on a New Machine

### Option A — Pre-built image (recommended)

No git or build toolchain needed — just Docker.

**1. Create a folder and your `.env` file:**

```bash
mkdir music-assistant && cd music-assistant
```

Create a `.env` file with your values (see [Environment Variables](#environment-variables) below).

**2. Create a `docker-compose.yml`:**

```yaml
services:
  app:
    image: ghcr.io/ttncode/music-assistant:latest
    ports:
      - "8000:8000"
    volumes:
      - ./data:/data
      - ${HOME}/music/music-assistant:/music
    env_file: .env
    restart: unless-stopped
```

To pin to a specific version, replace `:latest` with e.g. `:v1.0.0`.

**3. Start:**

```bash
docker compose up -d
```

> **Private image?** If the package is set to private on GHCR, authenticate first:
> ```bash
> echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
> ```

---

### Option B — Build from source

Clone the repo and follow the [Quick Start](#quick-start) steps above.

## Environment Variables

Create a `.env` file in the project root (copy `.env.example` as a starting point).

| Variable                 | Required | Default  | Description                                                        |
| ------------------------ | -------- | -------- | ------------------------------------------------------------------ |
| `ACCESS_CODE`            | Yes      | —        | Shared password (required to access the app)                       |
| `YOUTUBE_API_KEY`        | No       | —        | YouTube Data API v3 key                                            |
| `YOUTUBE_CHANNEL_ID`     | No       | —        | Your YouTube channel ID (e.g. `UCxxxxxxxx`)                        |
| `SOUNDCLOUD_PROFILE_URL` | No       | —        | Full URL of your SoundCloud profile                                |
| `MUSIC_DIR`              | No       | `/music` | Where downloaded MP3s are stored inside the container              |
| `DATA_DIR`               | No       | `/data`  | Where `songs.json` and device data are stored inside the container |

## Docker Volumes

Two directories are mounted outside the container so your data survives image rebuilds:

| Host path                  | Container path | Purpose                                         |
| -------------------------- | -------------- | ----------------------------------------------- |
| `./data`                   | `/data`        | Song database (`songs.json`) and device records |
| `$HOME/Music/MusicManager` | `/music`       | Downloaded MP3 files                            |

Change the host paths in `docker-compose.yml` if you want to store files elsewhere.

## Development

The frontend is baked into the Docker image at build time. For faster iteration during development, mount the local `web/dist` folder instead so a frontend rebuild takes effect immediately without rebuilding the image:

```bash
# Build the frontend
cd web && npm install && npm run build && cd ..

# Start with the dev volume mount
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

After that, any `npm run build` inside `web/` is reflected immediately — just refresh the browser.

To run the backend tests:

```bash
cd api
PYTHONPATH=. venv/bin/pytest tests/ -q
```

## Tech Stack

FastAPI · Python 3.12 · React 19 + Vite 6 · Tailwind v4 · yt-dlp · ffmpeg · Docker
