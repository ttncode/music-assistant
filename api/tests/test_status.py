from unittest.mock import patch


def _make_client(monkeypatch, yt_key="", yt_channel="", sc_url=""):
    monkeypatch.setenv("ACCESS_CODE", "secret")
    monkeypatch.setenv("YOUTUBE_API_KEY", yt_key)
    monkeypatch.setenv("YOUTUBE_CHANNEL_ID", yt_channel)
    monkeypatch.setenv("SOUNDCLOUD_PROFILE_URL", sc_url)
    from config import get_settings
    get_settings.cache_clear()
    from main import app
    from fastapi.testclient import TestClient
    return TestClient(app)


def test_not_configured(monkeypatch):
    client = _make_client(monkeypatch)
    res = client.get("/api/status/providers")
    assert res.status_code == 200
    data = res.json()
    assert data["youtube"] == {"configured": False, "reachable": False, "error": "Not configured"}
    assert data["soundcloud"] == {"configured": False, "reachable": False, "error": "Not configured"}


def test_reachable(monkeypatch):
    client = _make_client(monkeypatch, "key", "channel", "https://soundcloud.com/test")

    async def mock_get(self_or_url, url_or_none=None, **kwargs):
        url = url_or_none if url_or_none is not None else self_or_url

        class R:
            status_code = 200

            def json(self_r):
                return {"items": [{"id": "channel"}]} if "youtube" in url else {}

        return R()

    with patch("httpx.AsyncClient.get", new=mock_get):
        res = client.get("/api/status/providers")

    assert res.status_code == 200
    data = res.json()
    assert data["youtube"] == {"configured": True, "reachable": True, "error": None}
    assert data["soundcloud"] == {"configured": True, "reachable": True, "error": None}


def test_youtube_unreachable(monkeypatch):
    client = _make_client(monkeypatch, "bad_key", "channel", "")

    async def mock_get(self_or_url, url_or_none=None, **kwargs):
        class R:
            status_code = 400

            def json(self_r):
                return {}

        return R()

    with patch("httpx.AsyncClient.get", new=mock_get):
        res = client.get("/api/status/providers")

    data = res.json()
    assert data["youtube"]["configured"] is True
    assert data["youtube"]["reachable"] is False
    assert "400" in data["youtube"]["error"]
    assert data["soundcloud"]["configured"] is False
