import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("ACCESS_CODE", "secret123")
    monkeypatch.setenv("DATA_DIR", "/tmp/test_data")
    # Clear lru_cache so monkeypatched env is picked up
    from config import get_settings
    get_settings.cache_clear()
    from main import app
    return TestClient(app)


def test_verify_correct_code(client):
    res = client.post("/api/auth/verify", json={"code": "secret123"})
    assert res.status_code == 200
    assert res.json() == {"ok": True}


def test_verify_wrong_code(client):
    res = client.post("/api/auth/verify", json={"code": "wrong"})
    assert res.status_code == 401


def test_protected_route_requires_device_id(client):
    from fastapi import Depends
    from routers.auth import get_device_id
    from main import app

    @app.get("/api/test-device-gate")
    async def _gate(_: str = Depends(get_device_id)):
        return {"ok": True}

    res = client.get("/api/test-device-gate")
    assert res.status_code == 422
