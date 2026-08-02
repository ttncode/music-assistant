import { useState, useEffect, useCallback, useRef } from 'react'
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

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!enabled) return

    function startPolling() {
      if (intervalRef.current) return
      intervalRef.current = setInterval(fetch, 10_000)
    }

    function stopPolling() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        stopPolling()
      } else {
        fetch()
        startPolling()
      }
    }

    fetch()
    startPolling()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stopPolling()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
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
