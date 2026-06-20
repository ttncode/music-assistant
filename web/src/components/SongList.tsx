import { useState, useEffect } from 'react'
import { CaretLeft, CaretRight, MusicNote } from '@phosphor-icons/react'
import { SongResponse } from '../lib/api'
import { SongRow } from './SongRow'

const PAGE_SIZE = 25

interface Props {
  songs: SongResponse[]
  activePlaylist: string
  search: string
  loading: boolean
  onDelete: (id: string) => void
  onDownloaded: () => void
  onError: (message: string) => void
  isSelectMode: boolean
  selected: Set<string>
  onToggle: (id: string) => void
  justDownloaded: Set<string>
  historyVersion: number
}

export function SongList({
  songs,
  activePlaylist,
  search,
  loading,
  onDelete,
  onDownloaded,
  onError,
  isSelectMode,
  selected,
  onToggle,
  justDownloaded,
  historyVersion,
}: Props) {
  const [page, setPage] = useState(1)

  useEffect(() => {
    setPage(1)
  }, [activePlaylist, search])

  if (loading) {
    return (
      <div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] animate-pulse">
            <div className="shrink-0 w-10 h-10 rounded-md bg-[var(--color-surface-elevated)]" />
            <div className="flex-1 space-y-2">
              <div className="h-3 rounded bg-[var(--color-surface-elevated)] w-3/4" />
              <div className="h-2.5 rounded bg-[var(--color-surface-elevated)] w-1/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

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
        <p className="text-xs text-[var(--color-text-muted)] mt-1">
          Paste a YouTube or SoundCloud link above to get started.
        </p>
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

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const safePage = Math.min(page, totalPages)
  const start = (safePage - 1) * PAGE_SIZE
  const pageItems = filtered.slice(start, start + PAGE_SIZE)

  return (
    <div>
      {pageItems.map(song => (
        <SongRow
          key={song.id}
          song={song}
          onDelete={onDelete}
          onDownloaded={onDownloaded}
          onError={onError}
          isSelectMode={isSelectMode}
          selected={selected.has(song.id)}
          onToggle={onToggle}
          isJustDownloaded={justDownloaded.has(song.id)}
          historyVersion={historyVersion}
        />
      ))}

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
          <span className="text-xs text-[var(--color-text-muted)]">
            {start + 1}-{Math.min(start + PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={safePage === 1}
              className="cursor-pointer p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-colors"
              aria-label="Previous page"
            >
              <CaretLeft size={14} />
            </button>
            <span className="text-xs text-[var(--color-text-secondary)] px-1">
              {safePage} / {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={safePage === totalPages}
              className="cursor-pointer p-1.5 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-30 transition-colors"
              aria-label="Next page"
            >
              <CaretRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
