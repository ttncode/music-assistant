from unittest.mock import patch, MagicMock
from services.soundcloud import fetch_soundcloud_playlists, _sets_url


def test_sets_url_appends_sets():
    assert _sets_url('https://soundcloud.com/ttn-music') == 'https://soundcloud.com/ttn-music/sets'


def test_sets_url_preserves_existing_sets():
    assert _sets_url('https://soundcloud.com/ttn-music/sets') == 'https://soundcloud.com/ttn-music/sets'


def test_sets_url_strips_trailing_slash():
    assert _sets_url('https://soundcloud.com/ttn-music/') == 'https://soundcloud.com/ttn-music/sets'


def test_fetch_soundcloud_playlists_calls_sets_url():
    mock_info = {
        "entries": [
            {
                "_type": "playlist",
                "title": "My Mix",
                "entries": [
                    {"title": "Track 1", "url": "https://soundcloud.com/ttn-music/track-1", "thumbnail": ""},
                    {"title": "Track 2", "url": "https://soundcloud.com/ttn-music/track-2", "thumbnail": ""},
                ],
            }
        ]
    }
    with patch("services.soundcloud.yt_dlp.YoutubeDL") as mock_cls:
        mock_ydl = MagicMock()
        mock_ydl.extract_info.return_value = mock_info
        mock_cls.return_value.__enter__.return_value = mock_ydl

        result = fetch_soundcloud_playlists("https://soundcloud.com/ttn-music")

    mock_ydl.extract_info.assert_called_once_with(
        "https://soundcloud.com/ttn-music/sets", download=False
    )
    assert len(result) == 1
    assert result[0]["title"] == "My Mix"
    assert result[0]["platform"] == "soundcloud"
    assert len(result[0]["songs"]) == 2
    assert result[0]["songs"][0]["title"] == "Track 1"
    assert result[0]["songs"][1]["url"] == "https://soundcloud.com/ttn-music/track-2"


def test_fetch_soundcloud_playlists_skips_non_playlist_entries():
    mock_info = {
        "entries": [
            {"_type": "url", "title": "Loose Track", "url": "https://soundcloud.com/track"},
            {
                "_type": "playlist",
                "title": "Good Set",
                "entries": [
                    {"title": "T1", "url": "https://soundcloud.com/t1", "thumbnail": ""},
                ],
            },
        ]
    }
    with patch("services.soundcloud.yt_dlp.YoutubeDL") as mock_cls:
        mock_ydl = MagicMock()
        mock_ydl.extract_info.return_value = mock_info
        mock_cls.return_value.__enter__.return_value = mock_ydl

        result = fetch_soundcloud_playlists("https://soundcloud.com/ttn-music")

    assert len(result) == 1
    assert result[0]["title"] == "Good Set"


def test_fetch_soundcloud_playlists_returns_empty_on_no_info():
    with patch("services.soundcloud.yt_dlp.YoutubeDL") as mock_cls:
        mock_ydl = MagicMock()
        mock_ydl.extract_info.return_value = None
        mock_cls.return_value.__enter__.return_value = mock_ydl

        result = fetch_soundcloud_playlists("https://soundcloud.com/ttn-music")

    assert result == []
