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


def test_rename_device(client, data_dir):
    reg = client.post("/api/devices/register", json={"name": "Old Name"})
    dev_id = reg.json()["id"]
    res = client.patch(f"/api/devices/{dev_id}", json={"name": "New Name"},
                       headers={"X-Device-ID": dev_id})
    assert res.status_code == 200
    assert res.json()["name"] == "New Name"
    from store import read_songs
    data = read_songs(data_dir)
    assert any(d.name == "New Name" for d in data.devices)


def test_rename_device_forbidden(client):
    reg = client.post("/api/devices/register", json={"name": "Device A"})
    dev_id = reg.json()["id"]
    res = client.patch(f"/api/devices/{dev_id}", json={"name": "Hacked"},
                       headers={"X-Device-ID": "some-other-device"})
    assert res.status_code == 403


def test_rename_device_not_found(client):
    client.post("/api/devices/register", json={"name": "Device"})
    res = client.patch("/api/devices/nonexistent-id", json={"name": "X"},
                       headers={"X-Device-ID": "nonexistent-id"})
    assert res.status_code == 404


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


def test_register_returns_existing_device_for_same_name(client):
    res1 = client.post("/api/devices/register", json={"name": "My Phone"})
    res2 = client.post("/api/devices/register", json={"name": "My Phone"})
    assert res1.status_code == 201
    assert res2.status_code == 200
    assert res1.json()["id"] == res2.json()["id"]


def test_register_case_insensitive(client):
    res1 = client.post("/api/devices/register", json={"name": "My Phone"})
    res2 = client.post("/api/devices/register", json={"name": "my phone"})
    assert res1.status_code == 201
    assert res2.status_code == 200
    assert res1.json()["id"] == res2.json()["id"]


def test_register_trims_whitespace(client):
    res1 = client.post("/api/devices/register", json={"name": " My Phone "})
    res2 = client.post("/api/devices/register", json={"name": "My Phone"})
    assert res1.status_code == 201
    assert res2.status_code == 200
    assert res1.json()["id"] == res2.json()["id"]


def test_register_creates_new_for_different_name(client):
    res1 = client.post("/api/devices/register", json={"name": "My Phone"})
    res2 = client.post("/api/devices/register", json={"name": "Other Device"})
    assert res1.status_code == 201
    assert res2.status_code == 201
    assert res1.json()["id"] != res2.json()["id"]


def test_dedup_devices_removes_duplicates(client, data_dir):
    from store import read_songs, write_songs
    from models import SongsFile, Device
    d1 = Device(name="TTN iPhone")
    d2 = Device(name="TTN iPhone")
    write_songs(SongsFile(songs=[], playlists=[], devices=[d1, d2]), data_dir)
    # Trigger register with same name — dedup runs inside register
    client.post("/api/devices/register", json={"name": "TTN iPhone"})
    data = read_songs(data_dir)
    iphone_devices = [d for d in data.devices if d.name.strip().lower() == "ttn iphone"]
    assert len(iphone_devices) == 1
