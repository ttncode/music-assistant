def test_settings_default_max_concurrent_downloads():
    from config import Settings
    settings = Settings(access_code="secret")
    assert settings.max_concurrent_downloads == 3


def test_settings_max_concurrent_downloads_overridable(monkeypatch):
    from config import Settings
    monkeypatch.setenv("MAX_CONCURRENT_DOWNLOADS", "7")
    settings = Settings(access_code="secret")
    assert settings.max_concurrent_downloads == 7
