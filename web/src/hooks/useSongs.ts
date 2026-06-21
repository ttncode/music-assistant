import { useState, useEffect, useCallback } from 'react'
import { api, SongResponse } from '../lib/api'

export function useSongs(enabled = true) {
  const [songs, setSongs] = useState<SongResponse[]>([])
  const [playlists, setPlaylists] = useState<string[]>([])
  const [playlistSources, setPlaylistSources] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    try {
      const data = await api.songs.list()
      setSongs(data.songs)
      setPlaylists(data.playlists)
      setPlaylistSources(data.playlist_sources ?? {})
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load songs')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    fetch()
    const id = setInterval(fetch, 10_000)
    return () => clearInterval(id)
  }, [fetch, enabled])

  const removeSong = useCallback(async (id: string) => {
    setSongs(prev => prev.filter(s => s.id !== id))
    await api.songs.delete(id)
  }, [])

  const addSong = useCallback(async (url: string, playlist?: string) => {
    const song = await api.songs.add(url, playlist)
    setSongs(prev => [{ ...song, downloaded: false }, ...prev])
    return song
  }, [])

  const pendingCount = songs.filter(s => !s.downloaded).length

  return { songs, playlists, playlistSources, loading, error, pendingCount, refetch: fetch, removeSong, addSong }
}
