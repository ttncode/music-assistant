import { useState, FormEvent } from 'react'
import { Plus, CircleNotch, YoutubeLogo, SoundcloudLogo, ClipboardText } from '@phosphor-icons/react'

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

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setUrl(text.trim())
    } catch { /* permission denied or unavailable */ }
  }

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
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] flex items-center gap-1">
        <YoutubeLogo size={11} color="var(--color-platform-youtube)" />
        <SoundcloudLogo size={11} color="var(--color-platform-soundcloud)" />
        Add to library
      </p>
      <div className="relative">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="Paste YouTube or SoundCloud URL..."
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 pr-9 text-sm outline-none focus:border-[var(--color-accent)] transition-colors placeholder:text-[var(--color-text-muted)]"
        />
        <button
          type="button"
          onClick={handlePaste}
          aria-label="Paste from clipboard"
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
        >
          <ClipboardText size={15} />
        </button>
      </div>

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
          {loading
            ? <CircleNotch size={14} className="animate-spin" />
            : <Plus size={14} weight="bold" />}
          {loading ? 'Adding...' : 'Add'}
        </button>
      </div>

      {error && <p className="text-[var(--color-error)] text-xs">{error}</p>}
    </form>
  )
}
