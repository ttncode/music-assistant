from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    access_code: str
    youtube_api_key: str = ""
    youtube_channel_id: str = ""
    soundcloud_profile_url: str = ""
    music_dir: str = "/music"
    data_dir: str = "/data"

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()
