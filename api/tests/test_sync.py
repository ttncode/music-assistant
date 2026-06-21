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
