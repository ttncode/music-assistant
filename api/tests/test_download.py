import pytest
from unittest.mock import patch
from pathlib import Path
from fastapi.testclient import TestClient
from models import SongsFile, Song
from store import write_songs, read_songs


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


# --- Route tests ---

DEV = "device-test"


@pytest.fixture
def music_dir(tmp_path):
    d = tmp_path / "music"
    d.mkdir()
    return d


@pytest.fixture
def client(monkeypatch, data_dir, music_dir):
    monkeypatch.setenv("ACCESS_CODE", "x")
    monkeypatch.setenv("DATA_DIR", data_dir)
    monkeypatch.setenv("MUSIC_DIR", str(music_dir))
    from config import get_settings
    get_settings.cache_clear()
    from main import app
    return TestClient(app)


def _seed(data_dir, songs):
    write_songs(SongsFile(songs=songs, playlists=["Pop"], devices=[]), data_dir)


def _make_mp3(music_dir, playlist, filename):
    p = music_dir / playlist / filename
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(b"fake")
    return p


def test_prepare_calls_download_and_returns_ready(client, data_dir, music_dir):
    song = Song(title="New Song", url="https://youtube.com/watch?v=new",
                platform="youtube", playlist="Pop")
    _seed(data_dir, [song])
    mp3 = _make_mp3(music_dir, "Pop", "New Song.mp3")

    with patch("routers.download.get_file_path", return_value=None) as mock_path, \
         patch("routers.download.download_song", return_value=str(mp3)) as mock_dl:
        mock_path.side_effect = [None, None, str(mp3)]
        res = client.post(f"/api/download/{song.id}/prepare",
                          headers={"X-Device-ID": DEV})

    assert res.status_code == 200
    assert res.json() == {"status": "ready"}
    mock_dl.assert_called_once()


def test_prepare_skips_download_when_file_exists(client, data_dir, music_dir):
    song = Song(title="Cached Song", url="https://youtube.com/watch?v=cached",
                platform="youtube", playlist="Pop")
    _seed(data_dir, [song])
    mp3 = _make_mp3(music_dir, "Pop", "Cached Song.mp3")

    with patch("routers.download.get_file_path", return_value=str(mp3)), \
         patch("routers.download.download_song") as mock_dl:
        res = client.post(f"/api/download/{song.id}/prepare",
                          headers={"X-Device-ID": DEV})

    assert res.status_code == 200
    assert res.json() == {"status": "ready"}
    mock_dl.assert_not_called()


def test_serve_download_non_ascii_filename_succeeds(client, data_dir, music_dir):
    """Filenames with non-latin-1 chars (e.g. en dash) must use RFC 5987 encoding."""
    song = Song(title="Song – Dash", url="https://youtube.com/watch?v=dash",
                platform="youtube", playlist="Pop")
    _seed(data_dir, [song])
    mp3 = _make_mp3(music_dir, "Pop", "Song – Dash.mp3")

    with patch("routers.download.get_file_path", return_value=str(mp3)):
        res = client.get(f"/api/download/{song.id}?device_id={DEV}")

    assert res.status_code == 200
    assert "filename*=UTF-8''" in res.headers["content-disposition"]
    assert "%E2%80%93" in res.headers["content-disposition"]


def test_serve_download_ascii_filename_succeeds(client, data_dir, music_dir):
    song = Song(title="Normal Song", url="https://youtube.com/watch?v=normal",
                platform="youtube", playlist="Pop")
    _seed(data_dir, [song])
    mp3 = _make_mp3(music_dir, "Pop", "Normal Song.mp3")

    with patch("routers.download.get_file_path", return_value=str(mp3)):
        res = client.get(f"/api/download/{song.id}?device_id={DEV}")

    assert res.status_code == 200
    assert "filename*=UTF-8''" in res.headers["content-disposition"]


def test_serve_download_marks_downloaded_on_success(client, data_dir, music_dir):
    song = Song(title="Good Song", url="https://youtube.com/watch?v=good",
                platform="youtube", playlist="Pop")
    _seed(data_dir, [song])
    mp3 = _make_mp3(music_dir, "Pop", "Good Song.mp3")

    with patch("routers.download.get_file_path", return_value=str(mp3)):
        res = client.get(f"/api/download/{song.id}?device_id={DEV}")

    assert res.status_code == 200
    updated = next(s for s in read_songs(data_dir).songs if s.id == song.id)
    assert updated.device_downloads[DEV].downloaded is True


def test_serve_download_not_marked_on_download_failure(client, data_dir):
    song = Song(title="Fail Song", url="https://youtube.com/watch?v=fail",
                platform="youtube", playlist="Pop")
    _seed(data_dir, [song])

    with patch("routers.download.get_file_path", return_value=None), \
         patch("routers.download.download_song", side_effect=Exception("yt-dlp error")):
        res = client.get(f"/api/download/{song.id}?device_id={DEV}")

    assert res.status_code == 500
    updated = next(s for s in read_songs(data_dir).songs if s.id == song.id)
    assert DEV not in updated.device_downloads


def test_tiktok_download_adds_song_to_library(client, data_dir, music_dir):
    mp3 = _make_mp3(music_dir, "TikTok", "Cool Song.mp3")

    with patch("routers.download.download_song", return_value=str(mp3)):
        res = client.post(
            "/api/download/tiktok",
            json={"url": "https://www.tiktok.com/@user/video/123"},
            headers={"X-Device-ID": DEV},
        )

    assert res.status_code == 200
    data = read_songs(data_dir)
    assert len(data.songs) == 1
    song = data.songs[0]
    assert song.platform == "tiktok"
    assert song.playlist == "TikTok"
    assert song.url == "https://www.tiktok.com/@user/video/123"
    assert "TikTok" in data.playlists
    assert data.playlist_sources["TikTok"] == "tiktok"
    assert song.device_downloads[DEV].downloaded is True


def test_tiktok_download_deduplicates_by_url(client, data_dir, music_dir):
    url = "https://www.tiktok.com/@user/video/456"
    existing = Song(title="Old", url=url, platform="tiktok", playlist="TikTok")
    write_songs(SongsFile(songs=[existing], playlists=["TikTok"], devices=[]), data_dir)
    mp3 = _make_mp3(music_dir, "TikTok", "Old.mp3")

    with patch("routers.download.get_file_path", return_value=str(mp3)), \
         patch("routers.download.download_song") as mock_dl:
        res = client.post(
            "/api/download/tiktok",
            json={"url": url},
            headers={"X-Device-ID": DEV},
        )

    assert res.status_code == 200
    assert mock_dl.call_count == 0
    data = read_songs(data_dir)
    assert len(data.songs) == 1
    assert data.songs[0].device_downloads[DEV].downloaded is True
    assert data.playlist_sources.get("TikTok") == "tiktok"
