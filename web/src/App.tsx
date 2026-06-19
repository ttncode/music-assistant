import { useState, useCallback } from 'react'
import { useDevice } from './hooks/useDevice'
import { useSongs } from './hooks/useSongs'
import { useSync } from './hooks/useSync'
import { useSelection } from './hooks/useSelection'
import { useBatchDownload } from './hooks/useBatchDownload'
import { useProviderStatus } from './hooks/useProviderStatus'
import { AuthScreen } from './components/AuthScreen'
import { DeviceNameScreen } from './components/DeviceNameScreen'
import { Header } from './components/Header'
import { AddSongForm } from './components/AddSongForm'
import { FilterBar } from './components/FilterBar'
import { SongList } from './components/SongList'
import { SelectionBar } from './components/SelectionBar'
import { TikTokDownload } from './components/TikTokDownload'
import { SettingsSheet } from './components/SettingsSheet'

type AuthState = 'checking' | 'needs_code' | 'needs_name' | 'ready'

export default function App() {
  const { isRegistered } = useDevice()
  const [authState, setAuthState] = useState<AuthState>(isRegistered ? 'ready' : 'needs_code')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activePlaylist, setActivePlaylist] = useState('All')
  const [search, setSearch] = useState('')
  const [syncVersion, setSyncVersion] = useState(0)

  const { songs, playlists, pendingCount, refetch, removeSong, addSong } = useSongs()

  const handleSyncComplete = useCallback(() => {
    refetch()
    setSyncVersion(v => v + 1)
  }, [refetch])

  const { trigger: triggerSync, running: syncRunning } = useSync(handleSyncComplete)
  const { status: providerStatus } = useProviderStatus(syncVersion)
  const { selected, isSelectMode, toggle, selectAll, clearAll, enterSelectMode, exitSelectMode } =
    useSelection()
  const { downloadBatch, progress, isRunning } = useBatchDownload(() => {
    refetch()
    exitSelectMode()
  })

  // Mirror the filter logic from SongList to compute what's visible and undownloaded
  const filteredUndownloadedIds = songs
    .filter(s => {
      const matchPlaylist = activePlaylist === 'All' || s.playlist === activePlaylist
      const matchSearch = !search || s.title.toLowerCase().includes(search.toLowerCase())
      return matchPlaylist && matchSearch && !s.downloaded
    })
    .map(s => s.id)

  const handleDownloadSelected = useCallback(() => {
    downloadBatch(Array.from(selected))
  }, [downloadBatch, selected])

  const handleSelectAllUndownloaded = useCallback(() => {
    selectAll(filteredUndownloadedIds)
  }, [selectAll, filteredUndownloadedIds])

  const handleAdd = useCallback(
    async (url: string, playlist: string): Promise<void> => {
      await addSong(url, playlist)
    },
    [addSong],
  )

  const handleVerified = useCallback(() => setAuthState('needs_name'), [])
  const handleRegistered = useCallback(() => setAuthState('ready'), [])

  if (authState === 'needs_code') return <AuthScreen onVerified={handleVerified} />
  if (authState === 'needs_name') return <DeviceNameScreen onRegistered={handleRegistered} />

  return (
    <div className="min-h-[100dvh] flex flex-col max-w-2xl mx-auto">
      <Header
        pendingCount={pendingCount}
        syncRunning={syncRunning}
        onSync={triggerSync}
        onSettings={() => setSettingsOpen(true)}
        providerStatus={providerStatus}
      />

      <AddSongForm playlists={playlists} onAdd={handleAdd} />
      <FilterBar
        playlists={playlists}
        activePlaylist={activePlaylist}
        search={search}
        onPlaylistChange={setActivePlaylist}
        onSearchChange={setSearch}
        onEnterSelectMode={enterSelectMode}
      />

      <main className="flex-1 pb-20">
        <SongList
          songs={songs}
          activePlaylist={activePlaylist}
          search={search}
          onDelete={removeSong}
          onDownloaded={refetch}
          isSelectMode={isSelectMode}
          selected={selected}
          onToggle={toggle}
        />
      </main>

      <TikTokDownload />

      <SelectionBar
        selected={selected}
        isSelectMode={isSelectMode}
        isRunning={isRunning}
        progress={progress}
        filteredUndownloadedIds={filteredUndownloadedIds}
        onDownloadSelected={handleDownloadSelected}
        onSelectAllUndownloaded={handleSelectAllUndownloaded}
        onClearAll={clearAll}
        onCancel={exitSelectMode}
      />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onHistoryCleared={refetch}
      />
    </div>
  )
}
