import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch, data_dir):
    monkeypatch.setenv("ACCESS_CODE", "x")
    monkeypatch.setenv("DATA_DIR", data_dir)
    from config import get_settings
    get_settings.cache_clear()
    from main import app
    return TestClient(app)


def test_register_device(client):
    res = client.post("/api/devices/register", json={"name": "iPhone Main"})
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "iPhone Main"
    assert "id" in body


def test_register_persists_to_file(client, data_dir):
    client.post("/api/devices/register", json={"name": "Laptop"})
    from store import read_songs
    data = read_songs(data_dir)
    assert any(d.name == "Laptop" for d in data.devices)


def test_clear_history(client, data_dir):
    from store import read_songs, write_songs
    from models import SongsFile, Song, DeviceDownload
    dev_id = "dev-abc"
    song = Song(title="T", url="https://youtube.com/watch?v=x", platform="youtube",
                device_downloads={dev_id: DeviceDownload(name="Laptop", downloaded=True)})
    write_songs(SongsFile(songs=[song], playlists=[], devices=[]), data_dir)

    res = client.delete(f"/api/devices/{dev_id}/history",
                        headers={"X-Device-ID": dev_id})
    assert res.status_code == 200
    data = read_songs(data_dir)
    assert data.songs[0].device_downloads[dev_id].downloaded is False
