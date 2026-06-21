from pathlib import Path
from filelock import FileLock
from models import SongsFile

def _path(data_dir: str) -> Path:
    return Path(data_dir) / "songs.json"


def read_songs(data_dir: str) -> SongsFile:
    p = _path(data_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    lock = FileLock(str(p) + ".lock")
    with lock:
        if not p.exists():
            return SongsFile()
        return SongsFile.model_validate_json(p.read_text())


def write_songs(data: SongsFile, data_dir: str) -> None:
    p = _path(data_dir)
    p.parent.mkdir(parents=True, exist_ok=True)
    lock = FileLock(str(p) + ".lock")
    with lock:
        p.write_text(data.model_dump_json(indent=2))
