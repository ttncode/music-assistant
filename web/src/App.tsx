import { useState, useCallback } from 'react'
import { useDevice } from './hooks/useDevice'
import { useSongs } from './hooks/useSongs'
import { useSync } from './hooks/useSync'
import { useSelection } from './hooks/useSelection'
import { useBatchDownload } from './hooks/useBatchDownload'
import { useProviderStatus } from './hooks/useProviderStatus'
import { useToast } from './hooks/useToast'
import { AuthScreen } from './components/AuthScreen'
import { DeviceNameScreen } from './components/DeviceNameScreen'
import { Header } from './components/Header'
import { AddSongForm } from './components/AddSongForm'
import { FilterBar } from './components/FilterBar'
import { SongList } from './components/SongList'
import { SelectionBar } from './components/SelectionBar'
import { TikTokDownload } from './components/TikTokDownload'
import { SettingsSheet } from './components/SettingsSheet'
import { Toaster } from './components/Toaster'

type AuthState = 'checking' | 'needs_code' | 'needs_name' | 'ready'

export default function App() {
  const { isRegistered } = useDevice()
  const [authState, setAuthState] = useState<AuthState>(isRegistered ? 'ready' : 'needs_code')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activePlaylist, setActivePlaylist] = useState('All')
  const [search, setSearch] = useState('')
  const [syncVersion, setSyncVersion] = useState(0)
  const [justDownloaded, setJustDownloaded] = useState<Set<string>>(new Set())
  const [historyVersion, setHistoryVersion] = useState(0)

  const { songs, playlists, playlistSources, pendingCount, refetch, removeSong, addSong } = useSongs()
  const { toasts, toast, removeToast } = useToast()

  const handleSyncComplete = useCallback(({ added, error }: { added: number; error: string | null }) => {
    refetch()
    setSyncVersion(v => v + 1)
    if (error) {
      toast.error('Sync failed')
    } else if (added > 0) {
      toast.success(`Synced: ${added} new song${added !== 1 ? 's' : ''} added`)
    } else {
      toast.info('Already up to date')
    }
  }, [refetch, toast])

  const { trigger: triggerSync, running: syncRunning } = useSync(handleSyncComplete)
  const { status: providerStatus } = useProviderStatus(syncVersion)
  const { selected, isSelectMode, toggle, selectAll, clearAll, enterSelectMode, exitSelectMode } = useSelection()

  const { downloadBatch, cancel: cancelDownload, progress, isRunning } = useBatchDownload({
    onSongDownloaded: (id) => setJustDownloaded(prev => new Set([...prev, id])),
    onComplete: (downloaded, failed) => {
      refetch()
      exitSelectMode()
      setJustDownloaded(new Set())
      if (downloaded > 0) toast.success(`Downloaded ${downloaded} song${downloaded !== 1 ? 's' : ''}`)
      if (failed > 0) toast.error(`${failed} song${failed !== 1 ? 's' : ''} failed to download`)
    },
  })

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
    selectAll([...new Set([...selected, ...filteredUndownloadedIds])])
  }, [selectAll, filteredUndownloadedIds, selected])

  const handleDelete = useCallback(async (id: string) => {
    await removeSong(id)
    toast.success('Song removed')
  }, [removeSong, toast])

  const handleAdd = useCallback(async (url: string, playlist: string): Promise<void> => {
    await addSong(url, playlist)
    toast.success('Song added to library')
  }, [addSong, toast])

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

      <TikTokDownload />

      <AddSongForm playlists={playlists} onAdd={handleAdd} />

      <FilterBar
        playlists={playlists}
        activePlaylist={activePlaylist}
        search={search}
        playlistSources={playlistSources}
        onPlaylistChange={setActivePlaylist}
        onSearchChange={setSearch}
        onEnterSelectMode={enterSelectMode}
      />

      <main className="flex-1 pb-20">
        <SongList
          songs={songs}
          activePlaylist={activePlaylist}
          search={search}
          onDelete={handleDelete}
          onDownloaded={refetch}
          onError={(msg) => toast.error(msg)}
          isSelectMode={isSelectMode}
          selected={selected}
          onToggle={toggle}
          justDownloaded={justDownloaded}
          historyVersion={historyVersion}
        />
      </main>

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
        onCancelDownload={cancelDownload}
      />

      <Toaster toasts={toasts} onRemove={removeToast} />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onHistoryCleared={() => {
          refetch()
          setJustDownloaded(new Set())
          setHistoryVersion(v => v + 1)
          toast.success('Download history cleared')
        }}
      />
    </div>
  )
}
