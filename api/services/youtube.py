import httpx

_BASE = "https://www.googleapis.com/youtube/v3"


async def fetch_youtube_playlists(api_key: str, channel_id: str) -> list[dict]:
    async with httpx.AsyncClient() as client:
        playlists = await _get_playlists(client, api_key, channel_id)
        result = []
        for pl in playlists:
            songs = await _get_playlist_items(client, api_key, pl["id"])
            result.append({"title": pl["snippet"]["title"], "playlist_id": pl["id"], "songs": songs})
        return result


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
        page_token = data.get("nextPageToken")
        if not page_token:
            break
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
            if not vid_id:
                continue
            thumb = s.get("thumbnails", {}).get("high", {}).get("url", "")
            songs.append({
                "title": s["title"],
                "url": f"https://www.youtube.com/watch?v={vid_id}",
                "thumbnail": thumb,
            })
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return songs
