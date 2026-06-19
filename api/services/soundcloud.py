import yt_dlp
from pathlib import Path


def fetch_soundcloud_playlists(profile_url: str) -> list[dict]:
    """Extract all playlists and tracks from a SoundCloud profile using yt-dlp flat extraction."""
    ydl_opts = {
        "quiet": True,
        "extract_flat": "in_playlist",
        "ignoreerrors": True,
    }
    playlists = []
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(profile_url, download=False)
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
