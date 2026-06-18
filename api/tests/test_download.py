import pytest
from unittest.mock import patch, MagicMock
from pathlib import Path


def test_get_file_path_returns_none_when_not_downloaded(tmp_path):
    from services.downloader import get_file_path
    result = get_file_path("https://youtube.com/watch?v=abc", "Chill", str(tmp_path))
    assert result is None


def test_get_file_path_returns_path_when_sidecar_exists(tmp_path):
    from services.downloader import get_file_path, _url_hash, _sanitize
    url = "https://youtube.com/watch?v=abc"
    playlist = "Chill"
    folder = tmp_path / _sanitize(playlist)
    folder.mkdir()
    mp3 = str(folder / "Song Title.mp3")
    sidecar = folder / f".{_url_hash(url)}.done"
    sidecar.write_text(mp3)
    assert get_file_path(url, playlist, str(tmp_path)) == mp3


def test_download_song_calls_yt_dlp(tmp_path):
    from services.downloader import download_song
    mock_info = {"title": "Test Song"}
    with patch("yt_dlp.YoutubeDL") as MockYDL:
        instance = MockYDL.return_value.__enter__.return_value
        instance.extract_info.return_value = mock_info
        # Create the expected MP3 so the function can write the sidecar
        folder = tmp_path / "Chill"
        folder.mkdir()
        mp3 = folder / "Test Song.mp3"
        mp3.write_text("fake")
        result = download_song("https://youtube.com/watch?v=x", "Chill", str(tmp_path))
    assert "Test Song.mp3" in result
