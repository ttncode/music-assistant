import asyncio
import logging
import httpx

logger = logging.getLogger(__name__)

_BASE = "https://www.googleapis.com/youtube/v3"


async def fetch_youtube_playlists(api_key: str, channel_id: str) -> list[dict]:
    async with httpx.AsyncClient() as client:
        playlists = await _get_playlists(client, api_key, channel_id)
        songs_lists = await asyncio.gather(
            *(_get_playlist_items(client, api_key, pl["id"]) for pl in playlists)
        )
        return [
            {"title": pl["snippet"]["title"], "playlist_id": pl["id"], "platform": "youtube", "songs": songs}
            for pl, songs in zip(playlists, songs_lists)
        ]


async def _get_playlists(client: httpx.AsyncClient, api_key: str, channel_id: str) -> list:
    items, page_token = [], None
    while True:
        params = {"part": "snippet", "channelId": channel_id, "maxResults": 50, "key": api_key}
        if page_token:
            params["pageToken"] = page_token
        r = await client.get(f"{_BASE}/playlists", params=params)
        r.raise_for_status()
        data = r.json()
        items.extend(data.get("items", []))
        next_token = data.get("nextPageToken")
        if not next_token:
            break
        if next_token == page_token:
            logger.warning(f"YouTube API returned a non-advancing pageToken for channel {channel_id} — stopping pagination early")
            break
        page_token = next_token
    return items


async def _get_playlist_items(client: httpx.AsyncClient, api_key: str, playlist_id: str) -> list[dict]:
    songs, page_token = [], None
    while True:
        params = {"part": "snippet", "playlistId": playlist_id, "maxResults": 50, "key": api_key}
        if page_token:
            params["pageToken"] = page_token
        r = await client.get(f"{_BASE}/playlistItems", params=params)
        r.raise_for_status()
        data = r.json()
        for item in data.get("items", []):
            s = item["snippet"]
            vid_id = s.get("resourceId", {}).get("videoId", "")
            if not vid_id or s.get("title") in ("Private video", "Deleted video"):
                continue
            thumb = s.get("thumbnails", {}).get("high", {}).get("url", "")
            songs.append({
                "title": s["title"],
                "url": f"https://www.youtube.com/watch?v={vid_id}",
                "thumbnail": thumb,
            })
        next_token = data.get("nextPageToken")
        if not next_token:
            break
        if next_token == page_token:
            logger.warning(f"YouTube API returned a non-advancing pageToken for playlist {playlist_id} — stopping pagination early")
            break
        page_token = next_token
    return songs
