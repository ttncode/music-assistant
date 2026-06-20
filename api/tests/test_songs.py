import pytest
from fastapi.testclient import TestClient
from models import SongsFile, Song, DeviceDownload
from store import write_songs


@pytest.fixture
def client(monkeypatch, data_dir):
    monkeypatch.setenv("ACCESS_CODE", "x")
    monkeypatch.setenv("DATA_DIR", data_dir)
    from config import get_settings
    get_settings.cache_clear()
    from main import app
    return TestClient(app)


DEV = "device-123"
HEADERS = {"X-Device-ID": DEV}


def seed(data_dir, songs):
    write_songs(SongsFile(songs=songs, playlists=["Chill"], devices=[]), data_dir)


def test_get_songs_empty(client):
    res = client.get("/api/songs", headers=HEADERS)
    assert res.status_code == 200
    assert res.json()["songs"] == []


def test_get_songs_includes_downloaded_flag(client, data_dir):
    song = Song(title="T", url="https://youtube.com/watch?v=abc", platform="youtube",
                device_downloads={DEV: DeviceDownload(name="Dev", downloaded=True)})
    seed(data_dir, [song])
    res = client.get("/api/songs", headers=HEADERS)
    s = res.json()["songs"][0]
    assert s["downloaded"] is True


def test_get_songs_false_for_unknown_device(client, data_dir):
    song = Song(title="T", url="https://youtube.com/watch?v=xyz", platform="youtube")
    seed(data_dir, [song])
    res = client.get("/api/songs", headers=HEADERS)
    assert res.json()["songs"][0]["downloaded"] is False


def test_post_song_adds_to_list(client):
    res = client.post("/api/songs",
                      json={"url": "https://soundcloud.com/artist/track"},
                      headers=HEADERS)
    assert res.status_code == 201
    assert res.json()["platform"] == "soundcloud"


def test_post_song_duplicate_returns_409(client, data_dir):
    url = "https://youtube.com/watch?v=dup"
    song = Song(title="T", url=url, platform="youtube")
    seed(data_dir, [song])
    res = client.post("/api/songs", json={"url": url}, headers=HEADERS)
    assert res.status_code == 409


def test_delete_song(client, data_dir):
    song = Song(title="T", url="https://youtube.com/watch?v=del", platform="youtube")
    seed(data_dir, [song])
    res = client.delete(f"/api/songs/{song.id}", headers=HEADERS)
    assert res.status_code == 200
    from store import read_songs
    assert len(read_songs(data_dir).songs) == 0


def test_delete_song_not_found_returns_ok(client):
    res = client.delete("/api/songs/nonexistent-id", headers=HEADERS)
    assert res.status_code == 200
    assert res.json() == {"ok": True}


def test_get_songs_always_includes_tiktok_playlist(client):
    res = client.get("/api/songs", headers=HEADERS)
    assert res.status_code == 200
    data = res.json()
    assert "TikTok" in data["playlists"]
    assert data["playlist_sources"]["TikTok"] == "tiktok"
