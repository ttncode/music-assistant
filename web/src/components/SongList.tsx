import { MusicNote } from '@phosphor-icons/react'
import { SongResponse } from '../lib/api'
import { SongRow } from './SongRow'

interface Props {
  songs: SongResponse[]
  activePlaylist: string
  search: string
  onDelete: (id: string) => void
  onDownloaded: () => void
}

export function SongList({ songs, activePlaylist, search, onDelete, onDownloaded }: Props) {
  const filtered = songs.filter(s => {
    const matchPlaylist = activePlaylist === 'All' || s.playlist === activePlaylist
    const matchSearch = !search || s.title.toLowerCase().includes(search.toLowerCase())
    return matchPlaylist && matchSearch
  })

  if (songs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-4 text-center">
        <MusicNote size={40} className="text-[var(--color-text-muted)] mb-4" />
        <p className="text-sm text-[var(--color-text-secondary)]">No songs yet.</p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">Paste a YouTube or SoundCloud link above to get started.</p>
      </div>
    )
  }

  if (filtered.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-sm text-[var(--color-text-secondary)]">No songs match your filter.</p>
      </div>
    )
  }

  return (
    <div>
      {filtered.map(song => (
        <SongRow key={song.id} song={song} onDelete={onDelete} onDownloaded={onDownloaded} />
      ))}
    </div>
  )
}
