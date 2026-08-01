import asyncio
import pytest
from pathlib import Path
from unittest.mock import patch


@pytest.mark.asyncio
async def test_fetch_youtube_playlists_returns_structured_data():
    playlists_response = {
        "items": [{"id": "PLabc", "snippet": {"title": "Chill"}}]
    }
    videos_response = {
        "items": [{
            "snippet": {
                "title": "Song One",
                "resourceId": {"videoId": "vid123"},
                "thumbnails": {"high": {"url": "https://img.com/thumb.jpg"}},
            }
        }]
    }

    async def mock_get(self_or_url, url_or_none=None, **kwargs):
        # When patching an instance method, `self` is passed as first arg
        url = url_or_none if url_or_none is not None else self_or_url

        class R:
            def raise_for_status(self): pass
            def json(self):
                if "playlistItems" in url:
                    return videos_response
                return playlists_response
        return R()

    with patch("httpx.AsyncClient.get", new=mock_get):
        from services.youtube import fetch_youtube_playlists
        result = await fetch_youtube_playlists("key123", "UCchannel")

    assert len(result) == 1
    assert result[0]["title"] == "Chill"
    assert result[0]["songs"][0]["title"] == "Song One"
    assert "youtube.com" in result[0]["songs"][0]["url"]


@pytest.mark.asyncio
async def test_fetch_youtube_playlists_stops_when_page_token_does_not_advance():
    """Regression test: a real YouTube playlist returned the same nextPageToken
    forever, causing an infinite request loop that never terminated."""
    playlists_response = {"items": [{"id": "PLabc", "snippet": {"title": "Chill"}}]}
    call_count = {"n": 0}

    async def mock_get(self_or_url, url_or_none=None, **kwargs):
        url = url_or_none if url_or_none is not None else self_or_url

        if "playlistItems" in url:
            call_count["n"] += 1
            if call_count["n"] > 5:
                raise AssertionError("pagination loop did not terminate")

            class R:
                def raise_for_status(self): pass
                def json(self):
                    return {
                        "items": [{
                            "snippet": {"title": "Song One", "resourceId": {"videoId": "vid1"}, "thumbnails": {}},
                        }],
                        "nextPageToken": "STUCK_TOKEN",
                    }
            return R()

        class R:
            def raise_for_status(self): pass
            def json(self):
                return playlists_response
        return R()

    with patch("httpx.AsyncClient.get", new=mock_get):
        from services.youtube import fetch_youtube_playlists
        result = await fetch_youtube_playlists("key123", "UCchannel")

    # Terminates after 2 requests (proves the loop stops) instead of hanging forever.
    # The stuck page's items get fetched once before the repeat is detected, so the
    # result includes that page's item twice — harmless, sync dedupes songs by URL.
    assert call_count["n"] == 2
    assert len(result[0]["songs"]) == 2


@pytest.mark.asyncio
async def test_get_playlists_stops_when_page_token_does_not_advance():
    """Same non-advancing-pageToken protection, for the playlist-list pagination."""
    call_count = {"n": 0}

    async def mock_get(self_or_url, url_or_none=None, **kwargs):
        call_count["n"] += 1
        if call_count["n"] > 5:
            raise AssertionError("pagination loop did not terminate")

        class R:
            def raise_for_status(self): pass
            def json(self):
                return {
                    "items": [{"id": "PLabc", "snippet": {"title": "Chill"}}],
                    "nextPageToken": "STUCK_TOKEN",
                }
        return R()

    with patch("httpx.AsyncClient.get", new=mock_get):
        import httpx
        from services.youtube import _get_playlists
        async with httpx.AsyncClient() as client:
            result = await _get_playlists(client, "key123", "UCchannel")

    # Terminates after 2 requests (proves the loop stops); the stuck page's playlist
    # gets fetched once before the repeat is detected, so it appears twice — harmless.
    assert call_count["n"] == 2
    assert len(result) == 2


@pytest.mark.asyncio
async def test_fetch_youtube_playlists_fetches_playlist_items_concurrently():
    playlists_response = {
        "items": [
            {"id": "PLabc", "snippet": {"title": "Chill"}},
            {"id": "PLdef", "snippet": {"title": "Workout"}},
        ]
    }
    items_by_playlist = {
        "PLabc": {"items": [{
            "snippet": {"title": "Song One", "resourceId": {"videoId": "vid1"}, "thumbnails": {}},
        }]},
        "PLdef": {"items": [{
            "snippet": {"title": "Song Two", "resourceId": {"videoId": "vid2"}, "thumbnails": {}},
        }]},
    }
    state = {"current": 0, "max": 0}

    async def mock_get(self_or_url, url_or_none=None, **kwargs):
        url = url_or_none if url_or_none is not None else self_or_url
        params = kwargs.get("params", {})

        class R:
            def raise_for_status(self): pass
            def json(self):
                if "playlistItems" in url:
                    return items_by_playlist[params["playlistId"]]
                return playlists_response

        if "playlistItems" in url:
            state["current"] += 1
            state["max"] = max(state["max"], state["current"])
            await asyncio.sleep(0.05)
            state["current"] -= 1
        return R()

    with patch("httpx.AsyncClient.get", new=mock_get):
        from services.youtube import fetch_youtube_playlists
        result = await fetch_youtube_playlists("key123", "UCchannel")

    assert state["max"] == 2
    songs_by_title = {pl["title"]: pl["songs"][0]["title"] for pl in result}
    assert songs_by_title["Chill"] == "Song One"
    assert songs_by_title["Workout"] == "Song Two"


@pytest.mark.asyncio
async def test_startup_sync_triggers_when_no_songs_file(data_dir):
    from config import Settings
    settings = Settings(access_code="secret", data_dir=data_dir)

    with patch("main.asyncio.create_task") as mock_create_task:
        mock_create_task.return_value = None
        import main
        did_sync = await main._maybe_auto_sync(settings)
        mock_create_task.assert_called_once()
        assert did_sync is True


@pytest.mark.asyncio
async def test_startup_sync_skips_when_songs_file_exists(data_dir):
    from config import Settings
    settings = Settings(access_code="secret", data_dir=data_dir)
    (Path(data_dir) / "songs.json").write_text(
        '{"songs": [], "playlists": [], "playlist_sources": {}}'
    )

    with patch("main.asyncio.create_task") as mock_create_task:
        import main
        did_sync = await main._maybe_auto_sync(settings)
        mock_create_task.assert_not_called()
        assert did_sync is False


@pytest.mark.asyncio
async def test_lifespan_only_creates_one_task_on_cold_boot(monkeypatch, data_dir, tmp_path):
    from config import get_settings
    monkeypatch.setenv("ACCESS_CODE", "secret")
    monkeypatch.setenv("DATA_DIR", data_dir)
    monkeypatch.setenv("MUSIC_DIR", str(tmp_path / "music"))
    monkeypatch.setenv("AUTO_PREPARE", "true")
    get_settings.cache_clear()

    with patch("main.asyncio.create_task") as mock_create_task:
        mock_create_task.return_value = None
        import main
        async with main.lifespan(main.app):
            pass

    assert mock_create_task.call_count == 1


@pytest.mark.asyncio
async def test_lifespan_creates_auto_prepare_task_on_warm_restart(monkeypatch, data_dir, tmp_path):
    from config import get_settings
    (Path(data_dir) / "songs.json").write_text(
        '{"songs": [], "playlists": [], "playlist_sources": {}}'
    )
    monkeypatch.setenv("ACCESS_CODE", "secret")
    monkeypatch.setenv("DATA_DIR", data_dir)
    monkeypatch.setenv("MUSIC_DIR", str(tmp_path / "music"))
    monkeypatch.setenv("AUTO_PREPARE", "true")
    get_settings.cache_clear()

    with patch("main.asyncio.create_task") as mock_create_task:
        mock_create_task.return_value = None
        import main
        async with main.lifespan(main.app):
            pass

    assert mock_create_task.call_count == 1


@pytest.mark.asyncio
async def test_run_sync_fetches_youtube_and_soundcloud_concurrently(data_dir, tmp_path):
    import time
    from config import Settings
    from routers.sync import _run_sync
    from store import read_songs

    settings = Settings(
        access_code="secret",
        data_dir=data_dir,
        music_dir=str(tmp_path / "music"),
        youtube_api_key="key",
        youtube_channel_id="chan",
        soundcloud_profile_url="https://soundcloud.com/someone",
        auto_prepare=False,
    )

    async def fake_youtube(*args, **kwargs):
        await asyncio.sleep(0.1)
        return [{"title": "YT Playlist", "platform": "youtube",
                  "songs": [{"title": "YT Song", "url": "https://youtube.com/watch?v=yt1", "thumbnail": ""}]}]

    def fake_soundcloud(*args, **kwargs):
        time.sleep(0.1)
        return [{"title": "SC Playlist", "platform": "soundcloud",
                  "songs": [{"title": "SC Song", "url": "https://soundcloud.com/track1", "thumbnail": ""}]}]

    with patch("routers.sync.fetch_youtube_playlists", side_effect=fake_youtube), \
         patch("routers.sync.fetch_soundcloud_playlists", side_effect=fake_soundcloud):
        start = time.monotonic()
        await _run_sync(settings)
        elapsed = time.monotonic() - start

    assert elapsed < 0.18  # sequential (0.1s + 0.1s) would take >= 0.2s; concurrent takes ~0.1s
    data = read_songs(data_dir)
    urls = {s.url for s in data.songs}
    assert "https://youtube.com/watch?v=yt1" in urls
    assert "https://soundcloud.com/track1" in urls


@pytest.mark.asyncio
async def test_auto_prepare_all_downloads_missing_songs_within_concurrency_limit(data_dir, tmp_path, monkeypatch):
    import threading
    import time
    from config import Settings
    from routers.sync import _auto_prepare_all
    from models import Song, SongsFile
    from store import write_songs

    music_dir = tmp_path / "music"
    settings = Settings(access_code="secret", data_dir=data_dir, music_dir=str(music_dir),
                         max_concurrent_downloads=3, auto_prepare=False)

    songs = [Song(title=f"Song {i}", url=f"https://youtube.com/watch?v=song{i}",
                  platform="youtube", playlist="Pop") for i in range(6)]
    write_songs(SongsFile(songs=songs, playlists=["Pop"], devices=[]), data_dir)

    lock = threading.Lock()
    state = {"current": 0, "max": 0}

    def fake_download_song(url, playlist, music_dir_arg):
        with lock:
            state["current"] += 1
            state["max"] = max(state["max"], state["current"])
        time.sleep(0.05)
        folder = Path(music_dir_arg) / playlist
        folder.mkdir(parents=True, exist_ok=True)
        mp3 = folder / f"{url[-1]}.mp3"
        mp3.write_bytes(b"fake")
        with lock:
            state["current"] -= 1
        return str(mp3)

    monkeypatch.setattr("routers.sync.download_song", fake_download_song)

    await _auto_prepare_all(settings)

    assert state["max"] == 3


@pytest.mark.asyncio
async def test_auto_prepare_all_continues_after_one_download_failure(data_dir, tmp_path):
    from config import Settings
    from routers.sync import _auto_prepare_all
    from models import Song, SongsFile
    from store import write_songs, read_songs

    music_dir = tmp_path / "music"
    settings = Settings(access_code="secret", data_dir=data_dir, music_dir=str(music_dir), auto_prepare=False)

    good = Song(title="Good", url="https://youtube.com/watch?v=good", platform="youtube", playlist="Pop")
    bad = Song(title="Bad", url="https://youtube.com/watch?v=bad", platform="youtube", playlist="Pop")
    write_songs(SongsFile(songs=[good, bad], playlists=["Pop"], devices=[]), data_dir)

    def fake_download_song(url, playlist, music_dir_arg):
        if "bad" in url:
            raise Exception("boom")
        folder = Path(music_dir_arg) / playlist
        folder.mkdir(parents=True, exist_ok=True)
        mp3 = folder / "good.mp3"
        mp3.write_bytes(b"fake")
        return str(mp3)

    with patch("routers.sync.download_song", side_effect=fake_download_song):
        await _auto_prepare_all(settings)

    data = read_songs(data_dir)
    good_updated = next(s for s in data.songs if s.id == good.id)
    bad_updated = next(s for s in data.songs if s.id == bad.id)
    assert good_updated.prepared is True
    assert bad_updated.prepared is False
