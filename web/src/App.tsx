import { useState, useCallback } from 'react'
import { useDevice } from './hooks/useDevice'
import { useSongs } from './hooks/useSongs'
import { useSync } from './hooks/useSync'
import { AuthScreen } from './components/AuthScreen'
import { DeviceNameScreen } from './components/DeviceNameScreen'
import { Header } from './components/Header'
import { AddSongForm } from './components/AddSongForm'
import { FilterBar } from './components/FilterBar'
import { SongList } from './components/SongList'
import { TikTokDownload } from './components/TikTokDownload'
import { SettingsSheet } from './components/SettingsSheet'

type AuthState = 'checking' | 'needs_code' | 'needs_name' | 'ready'

export default function App() {
  const { isRegistered } = useDevice()
  const [authState, setAuthState] = useState<AuthState>(isRegistered ? 'ready' : 'needs_code')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activePlaylist, setActivePlaylist] = useState('All')
  const [search, setSearch] = useState('')

  const { songs, playlists, pendingCount, refetch, removeSong, addSong } = useSongs()
  const { trigger: triggerSync, running: syncRunning } = useSync(refetch)

  const handleVerified = useCallback(() => setAuthState('needs_name'), [])
  const handleRegistered = useCallback(() => setAuthState('ready'), [])
  const handleAdd = useCallback(async (url: string, playlist: string): Promise<void> => {
    await addSong(url, playlist)
  }, [addSong])

  if (authState === 'needs_code') return <AuthScreen onVerified={handleVerified} />
  if (authState === 'needs_name') return <DeviceNameScreen onRegistered={handleRegistered} />

  return (
    <div className="min-h-[100dvh] flex flex-col max-w-2xl mx-auto">
      <Header
        pendingCount={pendingCount}
        syncRunning={syncRunning}
        onSync={triggerSync}
        onSettings={() => setSettingsOpen(true)}
      />

      <AddSongForm playlists={playlists} onAdd={handleAdd} />
      <FilterBar
        playlists={playlists}
        activePlaylist={activePlaylist}
        search={search}
        onPlaylistChange={setActivePlaylist}
        onSearchChange={setSearch}
      />

      <main className="flex-1">
        <SongList
          songs={songs}
          activePlaylist={activePlaylist}
          search={search}
          onDelete={removeSong}
          onDownloaded={refetch}
        />
      </main>

      <TikTokDownload />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onHistoryCleared={refetch}
      />
    </div>
  )
}
