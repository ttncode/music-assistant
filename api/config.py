from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Music Assistant"
    app_env: str = "local"
    app_version: str = "0.1.0"
    access_code: str
    youtube_api_key: str = ""
    youtube_channel_id: str = ""
    soundcloud_profile_url: str = ""
    music_dir: str = "/music"
    data_dir: str = "/data"
    auto_prepare: bool = True
    max_concurrent_downloads: int = 3

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()
