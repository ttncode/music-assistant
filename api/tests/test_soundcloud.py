from unittest.mock import patch, MagicMock
from services.soundcloud import fetch_soundcloud_playlists, _sets_url


def test_sets_url_appends_sets():
    assert _sets_url('https://soundcloud.com/ttn-music') == 'https://soundcloud.com/ttn-music/sets'


def test_sets_url_preserves_existing_sets():
    assert _sets_url('https://soundcloud.com/ttn-music/sets') == 'https://soundcloud.com/ttn-music/sets'


def test_sets_url_strips_trailing_slash():
    assert _sets_url('https://soundcloud.com/ttn-music/') == 'https://soundcloud.com/ttn-music/sets'


def _ctx(return_value):
    """Build a mock YoutubeDL context manager returning the given extract_info value."""
    ydl = MagicMock()
    ydl.extract_info.return_value = return_value
    cm = MagicMock()
    cm.__enter__.return_value = ydl
    cm.__exit__.return_value = False
    return cm, ydl


def test_fetch_soundcloud_playlists_two_step_extraction():
    sets_page = {
        "entries": [
            {"_type": "url", "title": "My Mix", "url": "https://soundcloud.com/ttn-music/sets/my-mix"},
        ]
    }
    set_detail = {
        "title": "My Mix",
        "entries": [
            {"title": "Track 1", "webpage_url": "https://soundcloud.com/artist/track-1", "thumbnail": "https://thumb1.jpg"},
            {"title": "Track 2", "webpage_url": "https://soundcloud.com/artist/track-2", "thumbnail": "https://thumb2.jpg"},
        ],
    }
    cm1, ydl1 = _ctx(sets_page)
    cm2, ydl2 = _ctx(set_detail)

    with patch("services.soundcloud.yt_dlp.YoutubeDL", side_effect=[cm1, cm2]):
        result = fetch_soundcloud_playlists("https://soundcloud.com/ttn-music")

    ydl1.extract_info.assert_called_once_with("https://soundcloud.com/ttn-music/sets", download=False)
    ydl2.extract_info.assert_called_once_with("https://soundcloud.com/ttn-music/sets/my-mix", download=False)
    assert len(result) == 1
    assert result[0]["title"] == "My Mix"
    assert result[0]["platform"] == "soundcloud"
    assert len(result[0]["songs"]) == 2
    assert result[0]["songs"][0]["title"] == "Track 1"
    assert result[0]["songs"][0]["url"] == "https://soundcloud.com/artist/track-1"
    assert result[0]["songs"][1]["url"] == "https://soundcloud.com/artist/track-2"


def test_fetch_soundcloud_playlists_uses_webpage_url_not_cdn_url():
    """Song URL must be the SoundCloud permalink (webpage_url), not the expiring CDN stream URL."""
    sets_page = {"entries": [{"_type": "url", "url": "https://soundcloud.com/user/sets/mix"}]}
    set_detail = {
        "title": "Mix",
        "entries": [
            {
                "title": "Track",
                "url": "https://cdn.soundcloud.com/streams/expiring-signed-url",
                "webpage_url": "https://soundcloud.com/artist/track",
                "thumbnail": "",
            }
        ],
    }
    cm1, _ = _ctx(sets_page)
    cm2, _ = _ctx(set_detail)

    with patch("services.soundcloud.yt_dlp.YoutubeDL", side_effect=[cm1, cm2]):
        result = fetch_soundcloud_playlists("https://soundcloud.com/user")

    assert result[0]["songs"][0]["url"] == "https://soundcloud.com/artist/track"


def test_fetch_soundcloud_playlists_skips_entries_without_url():
    sets_page = {
        "entries": [
            {"_type": "url"},  # no url — should be skipped
            {"_type": "url", "url": "https://soundcloud.com/user/sets/valid"},
        ]
    }
    set_detail = {"title": "Valid", "entries": []}
    cm1, ydl1 = _ctx(sets_page)
    cm2, ydl2 = _ctx(set_detail)

    with patch("services.soundcloud.yt_dlp.YoutubeDL", side_effect=[cm1, cm2]):
        result = fetch_soundcloud_playlists("https://soundcloud.com/user")

    ydl2.extract_info.assert_called_once_with("https://soundcloud.com/user/sets/valid", download=False)
    assert len(result) == 1


def test_fetch_soundcloud_playlists_returns_empty_on_no_info():
    cm1, _ = _ctx(None)

    with patch("services.soundcloud.yt_dlp.YoutubeDL", side_effect=[cm1]):
        result = fetch_soundcloud_playlists("https://soundcloud.com/user")

    assert result == []
