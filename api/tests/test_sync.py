import pytest
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
