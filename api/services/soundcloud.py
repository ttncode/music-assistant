import yt_dlp


def _sets_url(profile_url: str) -> str:
    url = profile_url.rstrip('/')
    return url if url.endswith('/sets') else url + '/sets'


def fetch_soundcloud_playlists(profile_url: str) -> list[dict]:
    """Extract all playlists and tracks from a SoundCloud profile using yt-dlp.

    Two-step: flat-fetch the /sets page to get playlist URLs, then fully extract
    each playlist to get track titles, thumbnails, and permalink URLs.
    """
    flat_opts = {"quiet": True, "extract_flat": True, "ignoreerrors": True}
    full_opts = {"quiet": True, "ignoreerrors": True}
    playlists = []

    with yt_dlp.YoutubeDL(flat_opts) as ydl:
        info = ydl.extract_info(_sets_url(profile_url), download=False)
        if not info:
            return []
        set_entries = [e for e in (info.get("entries") or []) if e and e.get("url")]

    with yt_dlp.YoutubeDL(full_opts) as ydl:
        for set_entry in set_entries:
            set_info = ydl.extract_info(set_entry["url"], download=False)
            if not set_info:
                continue
            songs = []
            for track in set_info.get("entries", []) or []:
                if not track:
                    continue
                songs.append({
                    "title": track.get("title", ""),
                    "url": track.get("webpage_url") or track.get("url", ""),
                    "thumbnail": track.get("thumbnail", ""),
                })
            playlists.append({
                "title": set_info.get("title", set_entry.get("title", "")),
                "platform": "soundcloud",
                "songs": songs,
            })
    return playlists
