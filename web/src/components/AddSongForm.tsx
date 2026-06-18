import { useState, FormEvent } from 'react'
import { Plus } from '@phosphor-icons/react'

interface Props {
  playlists: string[]
  onAdd: (url: string, playlist: string) => Promise<void>
}

export function AddSongForm({ playlists, onAdd }: Props) {
  const [url, setUrl] = useState('')
  const [playlist, setPlaylist] = useState('')
  const [newPlaylist, setNewPlaylist] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const effectivePlaylist = newPlaylist.trim() || playlist || 'Default'

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setError('')
    setLoading(true)
    try {
      await onAdd(url.trim(), effectivePlaylist)
      setUrl('')
      setNewPlaylist('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add song')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="px-4 py-3 border-b border-[var(--color-border)] space-y-2">
      <input
        value={url}
        onChange={e => setUrl(e.target.value)}
        placeholder="Paste YouTube or SoundCloud URL..."
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-sm outline-none focus:border-[var(--color-accent)] transition-colors placeholder:text-[var(--color-text-muted)]"
      />

      <div className="flex gap-2">
        <select
          value={playlist}
          onChange={e => setPlaylist(e.target.value)}
          className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition-colors text-[var(--color-text-secondary)]"
        >
          <option value="">Select playlist...</option>
          {playlists.map(p => <option key={p} value={p}>{p}</option>)}
          <option value="__new__">+ New playlist</option>
        </select>

        {playlist === '__new__' && (
          <input
            value={newPlaylist}
            onChange={e => setNewPlaylist(e.target.value)}
            placeholder="Playlist name"
            autoFocus
            className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition-colors"
          />
        )}

        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white disabled:opacity-40 active:scale-[0.98] transition-transform shrink-0"
        >
          <Plus size={14} weight="bold" />
          {loading ? 'Adding...' : 'Add'}
        </button>
      </div>

      {error && <p className="text-[var(--color-error)] text-xs">{error}</p>}
    </form>
  )
}
