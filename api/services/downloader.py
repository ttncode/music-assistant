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


def build_sidecar_index(music_dir: str) -> dict[str, Path]:
    """Map url_hash -> sidecar path for every sidecar under music_dir, built with one directory walk."""
    index: dict[str, Path] = {}
    root = Path(music_dir)
    if not root.exists():
        return index
    for folder in root.iterdir():
        if not folder.is_dir():
            continue
        for sidecar in folder.glob(".*.done"):
            h = sidecar.name[1:-5]  # strip leading "." and trailing ".done"
            index[h] = sidecar
    return index


def _relocate(other_sidecar: Path, sidecar: Path, folder: Path) -> str | None:
    """Move the MP3 recorded by other_sidecar into folder, rewrite the sidecar there.

    Returns the new path, or None if other_sidecar doesn't exist, or (deleting
    it) if the recorded MP3 no longer exists.
    """
    if not other_sidecar.exists():
        return None
    old_mp3 = Path(other_sidecar.read_text().strip())
    if not old_mp3.exists():
        other_sidecar.unlink(missing_ok=True)
        return None
    folder.mkdir(parents=True, exist_ok=True)
    new_mp3 = folder / old_mp3.name
    old_mp3.rename(new_mp3)
    other_sidecar.unlink()
    sidecar.write_text(str(new_mp3))
    return str(new_mp3)


def get_file_path(url: str, playlist: str, music_dir: str, index: dict[str, Path] | None = None) -> str | None:
    """Return path to existing MP3 for this URL if already downloaded, else None.

    Self-heals across playlist moves: if the song was downloaded while it
    belonged to a different playlist, the file is found under that old
    playlist's folder and relocated into the current one here, so the song
    is never redownloaded just because its playlist changed.

    If `index` is provided (a hash -> sidecar path map from
    build_sidecar_index), the fallback lookup uses it instead of scanning
    music_dir directly — for batch callers that already built one index for
    the whole run.
    """
    url_hash = _url_hash(url)
    hash_name = f".{url_hash}.done"
    safe_playlist = _sanitize(playlist)
    folder = Path(music_dir) / safe_playlist

    sidecar = folder / hash_name
    if sidecar.exists():
        return sidecar.read_text().strip()

    if index is not None:
        other_sidecar = index.get(url_hash)
        if other_sidecar is None or other_sidecar.parent == folder:
            return None
        return _relocate(other_sidecar, sidecar, folder)

    root = Path(music_dir)
    if not root.exists():
        return None

    for other in root.iterdir():
        if not other.is_dir() or other == folder:
            continue
        other_sidecar = other / hash_name
        if not other_sidecar.exists():
            continue
        result = _relocate(other_sidecar, sidecar, folder)
        if result is not None:
            return result
        continue

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
