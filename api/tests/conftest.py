import pytest
from pathlib import Path


@pytest.fixture
def data_dir(tmp_path: Path) -> str:
    d = tmp_path / "data"
    d.mkdir()
    return str(d)


@pytest.fixture(autouse=True)
def _reset_auth_module_state():
    from routers.auth import _pending_tickets, _attempts
    _pending_tickets.clear()
    _attempts.clear()
    yield
    _pending_tickets.clear()
    _attempts.clear()
