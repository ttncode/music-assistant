import asyncio
import re
from pathlib import Path
import yt_dlp

_download_locks: dict[str, asyncio.Lock] = {}


def _get_lock(song_id: str) -> asyncio.Lock:
    if song_id not in _download_locks:
        _download_locks[song_id] = asyncio.Lock()
    return _download_locks[song_id]


def _sanitize(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip()


def _url_hash(url: str) -> str:
    import hashlib
    return hashlib.md5(url.encode()).hexdigest()[:12]


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


def download_song(url: str, playlist: str, music_dir: str) -> str:
    """Download url as MP3 320kbps to music_dir/playlist/. Returns path to MP3."""
    safe_playlist = _sanitize(playlist)
    folder = Path(music_dir) / safe_playlist
    folder.mkdir(parents=True, exist_ok=True)
    out_tmpl = str(folder / "%(title)s.%(ext)s")

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": out_tmpl,
        "postprocessors": [
            {"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "320"},
            {"key": "FFmpegMetadata", "add_metadata": True},
        ],
        "quiet": True,
        "socket_timeout": 60,
        "retries": 10,
        "fragment_retries": 10,
        "extractor_args": {
            "youtube": {"player_client": ["android", "web", "ios"]},
        },
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)
        title = info.get("title", "unknown")
        mp3_path = str(folder / f"{yt_dlp.utils.sanitize_filename(title)}.mp3")

    # Write sidecar so get_file_path can find this file later
    sidecar = folder / f".{_url_hash(url)}.done"
    sidecar.write_text(mp3_path)

    return mp3_path


def remove_song_files(url: str, playlist: str, music_dir: str) -> None:
    """Delete the MP3 and its sidecar for this URL, if they exist."""
    safe_playlist = _sanitize(playlist)
    folder = Path(music_dir) / safe_playlist
    sidecar = folder / f".{_url_hash(url)}.done"
    if sidecar.exists():
        mp3_path = sidecar.read_text().strip()
        Path(mp3_path).unlink(missing_ok=True)
        sidecar.unlink(missing_ok=True)
