from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field
import uuid


def new_id() -> str:
    return str(uuid.uuid4())


class DeviceDownload(BaseModel):
    name: str
    downloaded: bool = False
    downloaded_at: datetime | None = None


class Song(BaseModel):
    id: str = Field(default_factory=new_id)
    title: str
    url: str
    platform: Literal["youtube", "soundcloud", "tiktok", "other"]
    playlist: str = "Default"
    thumbnail: str = ""
    added_at: datetime = Field(default_factory=datetime.utcnow)
    device_downloads: dict[str, DeviceDownload] = Field(default_factory=dict)


class Device(BaseModel):
    id: str = Field(default_factory=new_id)
    name: str
    last_seen: datetime = Field(default_factory=datetime.utcnow)


class SongsFile(BaseModel):
    songs: list[Song] = Field(default_factory=list)
    playlists: list[str] = Field(default_factory=list)
    devices: list[Device] = Field(default_factory=list)
