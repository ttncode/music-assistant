import pytest
from pathlib import Path


@pytest.fixture
def data_dir(tmp_path: Path) -> str:
    d = tmp_path / "data"
    d.mkdir()
    return str(d)
