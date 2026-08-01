import asyncio
import pytest
from pathlib import Path
from unittest.mock import patch


@pytest.mark.asyncio
async def test_fetch_youtube_playlists_returns_structured_data():
    playlists_response = {
        "items": [{"id": "PLabc", "snippet": {"title": "Chill"}}]
    }
    videos_response = {
        "items": [{
            "snippet": {
                "title": "Song One",
                "resourceId": {"videoId": "vid123"},
                "thumbnails": {"high": {"url": "https://img.com/thumb.jpg"}},
            }
        }]
    }

    async def mock_get(self_or_url, url_or_none=None, **kwargs):
        # When patching an instance method, `self` is passed as first arg
        url = url_or_none if url_or_none is not None else self_or_url

        class R:
            def raise_for_status(self): pass
            def json(self):
                if "playlistItems" in url:
                    return videos_response
                return playlists_response
        return R()

    with patch("httpx.AsyncClient.get", new=mock_get):
        from services.youtube import fetch_youtube_playlists
        result = await fetch_youtube_playlists("key123", "UCchannel")

    assert len(result) == 1
    assert result[0]["title"] == "Chill"
    assert result[0]["songs"][0]["title"] == "Song One"
    assert "youtube.com" in result[0]["songs"][0]["url"]


@pytest.mark.asyncio
async def test_fetch_youtube_playlists_fetches_playlist_items_concurrently():
    playlists_response = {
        "items": [
            {"id": "PLabc", "snippet": {"title": "Chill"}},
            {"id": "PLdef", "snippet": {"title": "Workout"}},
        ]
    }
    items_by_playlist = {
        "PLabc": {"items": [{
            "snippet": {"title": "Song One", "resourceId": {"videoId": "vid1"}, "thumbnails": {}},
        }]},
        "PLdef": {"items": [{
            "snippet": {"title": "Song Two", "resourceId": {"videoId": "vid2"}, "thumbnails": {}},
        }]},
    }
    state = {"current": 0, "max": 0}

    async def mock_get(self_or_url, url_or_none=None, **kwargs):
        url = url_or_none if url_or_none is not None else self_or_url
        params = kwargs.get("params", {})

        class R:
            def raise_for_status(self): pass
            def json(self):
                if "playlistItems" in url:
                    return items_by_playlist[params["playlistId"]]
                return playlists_response

        if "playlistItems" in url:
            state["current"] += 1
            state["max"] = max(state["max"], state["current"])
            await asyncio.sleep(0.05)
            state["current"] -= 1
        return R()

    with patch("httpx.AsyncClient.get", new=mock_get):
        from services.youtube import fetch_youtube_playlists
        result = await fetch_youtube_playlists("key123", "UCchannel")

    assert state["max"] == 2
    songs_by_title = {pl["title"]: pl["songs"][0]["title"] for pl in result}
    assert songs_by_title["Chill"] == "Song One"
    assert songs_by_title["Workout"] == "Song Two"


@pytest.mark.asyncio
async def test_startup_sync_triggers_when_no_songs_file(data_dir):
    from config import Settings
    settings = Settings(access_code="secret", data_dir=data_dir)

    with patch("main.asyncio.create_task") as mock_create_task:
        mock_create_task.return_value = None
        import main
        await main._maybe_auto_sync(settings)
        mock_create_task.assert_called_once()


@pytest.mark.asyncio
async def test_startup_sync_skips_when_songs_file_exists(data_dir):
    from config import Settings
    settings = Settings(access_code="secret", data_dir=data_dir)
    (Path(data_dir) / "songs.json").write_text(
        '{"songs": [], "playlists": [], "playlist_sources": {}}'
    )

    with patch("main.asyncio.create_task") as mock_create_task:
        import main
        await main._maybe_auto_sync(settings)
        mock_create_task.assert_not_called()


@pytest.mark.asyncio
async def test_run_sync_fetches_youtube_and_soundcloud_concurrently(data_dir, tmp_path):
    import time
    from config import Settings
    from routers.sync import _run_sync
    from store import read_songs

    settings = Settings(
        access_code="secret",
        data_dir=data_dir,
        music_dir=str(tmp_path / "music"),
        youtube_api_key="key",
        youtube_channel_id="chan",
        soundcloud_profile_url="https://soundcloud.com/someone",
        auto_prepare=False,
    )

    async def fake_youtube(*args, **kwargs):
        await asyncio.sleep(0.1)
        return [{"title": "YT Playlist", "platform": "youtube",
                  "songs": [{"title": "YT Song", "url": "https://youtube.com/watch?v=yt1", "thumbnail": ""}]}]

    def fake_soundcloud(*args, **kwargs):
        time.sleep(0.1)
        return [{"title": "SC Playlist", "platform": "soundcloud",
                  "songs": [{"title": "SC Song", "url": "https://soundcloud.com/track1", "thumbnail": ""}]}]

    with patch("routers.sync.fetch_youtube_playlists", side_effect=fake_youtube), \
         patch("routers.sync.fetch_soundcloud_playlists", side_effect=fake_soundcloud):
        start = time.monotonic()
        await _run_sync(settings)
        elapsed = time.monotonic() - start

    assert elapsed < 0.18  # sequential (0.1s + 0.1s) would take >= 0.2s; concurrent takes ~0.1s
    data = read_songs(data_dir)
    urls = {s.url for s in data.songs}
    assert "https://youtube.com/watch?v=yt1" in urls
    assert "https://soundcloud.com/track1" in urls
