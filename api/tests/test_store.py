from models import SongsFile, Song, Device
from store import read_songs, write_songs


def test_read_returns_empty_when_file_missing(data_dir):
    result = read_songs(data_dir)
    assert result == SongsFile()


def test_write_then_read_roundtrip(data_dir):
    original = SongsFile(
        songs=[Song(title="Test", url="https://youtube.com/watch?v=abc", platform="youtube")],
        playlists=["Default"],
        devices=[],
    )
    write_songs(original, data_dir)
    result = read_songs(data_dir)
    assert len(result.songs) == 1
    assert result.songs[0].title == "Test"
    assert result.playlists == ["Default"]


def test_write_creates_parent_dirs(tmp_path):
    nested = str(tmp_path / "a" / "b" / "c")
    data = SongsFile()
    write_songs(data, nested)
    result = read_songs(nested)
    assert result == SongsFile()
