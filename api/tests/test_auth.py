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
    body = res.json()
    assert body["ok"] is True
    assert isinstance(body["ticket"], str)
    assert len(body["ticket"]) > 20


def test_verify_wrong_code(client):
    res = client.post("/api/auth/verify", json={"code": "wrong"})
    assert res.status_code == 401


def test_verify_non_string_code_returns_401_not_500(client):
    res = client.post("/api/auth/verify", json={"code": 12345})
    assert res.status_code == 401


def test_verify_non_ascii_code_does_not_crash(client):
    res = client.post("/api/auth/verify", json={"code": "café"})
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


def test_ticket_is_single_use():
    from routers.auth import consume_ticket, issue_ticket
    ticket = issue_ticket()
    assert consume_ticket(ticket) is True
    assert consume_ticket(ticket) is False


def test_consume_unknown_ticket_returns_false():
    from routers.auth import consume_ticket
    assert consume_ticket("not-a-real-ticket") is False


def test_verify_rate_limited_after_too_many_attempts(client):
    for _ in range(10):
        client.post("/api/auth/verify", json={"code": "wrong"})
    res = client.post("/api/auth/verify", json={"code": "wrong"})
    assert res.status_code == 429
    assert "Retry-After" in res.headers


def test_verify_rate_limit_resets_after_success(client):
    for _ in range(5):
        client.post("/api/auth/verify", json={"code": "wrong"})
    res = client.post("/api/auth/verify", json={"code": "secret123"})
    assert res.status_code == 200
    # counter was reset by the success above, so a fresh run of attempts starts from zero
    for _ in range(9):
        res = client.post("/api/auth/verify", json={"code": "wrong"})
        assert res.status_code == 401
