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


@pytest.fixture
def get_ticket(client):
    def _get_ticket():
        res = client.post("/api/auth/verify", json={"code": "x"})
        return res.json()["ticket"]
    return _get_ticket


def test_register_device(client, get_ticket):
    res = client.post("/api/devices/register", json={"name": "iPhone Main", "ticket": get_ticket()})
    assert res.status_code == 201
    body = res.json()
    assert body["name"] == "iPhone Main"
    assert "id" in body


def test_register_persists_to_file(client, data_dir, get_ticket):
    client.post("/api/devices/register", json={"name": "Laptop", "ticket": get_ticket()})
    from store import read_songs
    data = read_songs(data_dir)
    assert any(d.name == "Laptop" for d in data.devices)


def test_rename_device(client, data_dir, get_ticket):
    reg = client.post("/api/devices/register", json={"name": "Old Name", "ticket": get_ticket()})
    dev_id = reg.json()["id"]
    res = client.patch(f"/api/devices/{dev_id}", json={"name": "New Name"},
                       headers={"X-Device-ID": dev_id})
    assert res.status_code == 200
    assert res.json()["name"] == "New Name"
    from store import read_songs
    data = read_songs(data_dir)
    assert any(d.name == "New Name" for d in data.devices)


def test_rename_device_forbidden(client, get_ticket):
    reg = client.post("/api/devices/register", json={"name": "Device A", "ticket": get_ticket()})
    dev_id = reg.json()["id"]
    res = client.patch(f"/api/devices/{dev_id}", json={"name": "Hacked"},
                       headers={"X-Device-ID": "some-other-device"})
    assert res.status_code == 403


def test_rename_device_not_found(client, get_ticket):
    client.post("/api/devices/register", json={"name": "Device", "ticket": get_ticket()})
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


def test_register_returns_existing_device_for_same_name(client, get_ticket):
    res1 = client.post("/api/devices/register", json={"name": "My Phone", "ticket": get_ticket()})
    res2 = client.post("/api/devices/register", json={"name": "My Phone", "ticket": get_ticket()})
    assert res1.status_code == 201
    assert res2.status_code == 200
    assert res1.json()["id"] == res2.json()["id"]


def test_register_case_insensitive(client, get_ticket):
    res1 = client.post("/api/devices/register", json={"name": "My Phone", "ticket": get_ticket()})
    res2 = client.post("/api/devices/register", json={"name": "my phone", "ticket": get_ticket()})
    assert res1.status_code == 201
    assert res2.status_code == 200
    assert res1.json()["id"] == res2.json()["id"]


def test_register_trims_whitespace(client, get_ticket):
    res1 = client.post("/api/devices/register", json={"name": " My Phone ", "ticket": get_ticket()})
    res2 = client.post("/api/devices/register", json={"name": "My Phone", "ticket": get_ticket()})
    assert res1.status_code == 201
    assert res2.status_code == 200
    assert res1.json()["id"] == res2.json()["id"]


def test_register_creates_new_for_different_name(client, get_ticket):
    res1 = client.post("/api/devices/register", json={"name": "My Phone", "ticket": get_ticket()})
    res2 = client.post("/api/devices/register", json={"name": "Other Device", "ticket": get_ticket()})
    assert res1.status_code == 201
    assert res2.status_code == 201
    assert res1.json()["id"] != res2.json()["id"]


def test_dedup_devices_removes_duplicates(client, data_dir, get_ticket):
    from store import read_songs, write_songs
    from models import SongsFile, Device
    d1 = Device(name="TTN iPhone")
    d2 = Device(name="TTN iPhone")
    write_songs(SongsFile(songs=[], playlists=[], devices=[d1, d2]), data_dir)
    # Trigger register with same name — dedup runs inside register
    client.post("/api/devices/register", json={"name": "TTN iPhone", "ticket": get_ticket()})
    data = read_songs(data_dir)
    iphone_devices = [d for d in data.devices if d.name.strip().lower() == "ttn iphone"]
    assert len(iphone_devices) == 1


def test_unregister_device(client, data_dir, get_ticket):
    reg = client.post("/api/devices/register", json={"name": "To Remove", "ticket": get_ticket()})
    dev_id = reg.json()["id"]
    res = client.delete(f"/api/devices/{dev_id}", headers={"X-Device-ID": dev_id})
    assert res.status_code == 200
    from store import read_songs
    data = read_songs(data_dir)
    assert all(d.id != dev_id for d in data.devices)


def test_unregister_device_forbidden(client, get_ticket):
    reg = client.post("/api/devices/register", json={"name": "Device A", "ticket": get_ticket()})
    dev_id = reg.json()["id"]
    res = client.delete(f"/api/devices/{dev_id}", headers={"X-Device-ID": "some-other-device"})
    assert res.status_code == 403


def test_unregister_device_not_found(client):
    res = client.delete("/api/devices/nonexistent-id", headers={"X-Device-ID": "nonexistent-id"})
    assert res.status_code == 404


def test_unregister_device_removes_its_device_downloads_entries(client, data_dir):
    from store import read_songs, write_songs
    from models import SongsFile, Song, DeviceDownload, Device
    dev_id = "dev-to-remove"
    song = Song(title="T", url="https://youtube.com/watch?v=x", platform="youtube",
                device_downloads={dev_id: DeviceDownload(name="Old Phone", downloaded=True, ignored=True)})
    device = Device(id=dev_id, name="Old Phone")
    write_songs(SongsFile(songs=[song], playlists=[], devices=[device]), data_dir)

    res = client.delete(f"/api/devices/{dev_id}", headers={"X-Device-ID": dev_id})
    assert res.status_code == 200
    data = read_songs(data_dir)
    assert dev_id not in data.songs[0].device_downloads


def test_register_requires_ticket(client):
    res = client.post("/api/devices/register", json={"name": "No Ticket"})
    assert res.status_code == 422


def test_register_rejects_invalid_ticket(client):
    res = client.post("/api/devices/register", json={"name": "Bad Ticket", "ticket": "not-a-real-ticket"})
    assert res.status_code == 401


def test_register_rejects_reused_ticket(client, get_ticket):
    ticket = get_ticket()
    res1 = client.post("/api/devices/register", json={"name": "First", "ticket": ticket})
    assert res1.status_code == 201
    res2 = client.post("/api/devices/register", json={"name": "Second", "ticket": ticket})
    assert res2.status_code == 401
