import { MagnifyingGlass, YoutubeLogo, SoundcloudLogo } from '@phosphor-icons/react'
import { clsx } from 'clsx'

interface Props {
  playlists: string[]
  playlistSources: Record<string, string>
  activePlaylist: string
  search: string
  onPlaylistChange: (p: string) => void
  onSearchChange: (s: string) => void
  onEnterSelectMode: () => void
}

function PlaylistIcon({ platform }: { platform?: string }) {
  if (platform === 'youtube') return <YoutubeLogo size={10} color="var(--color-platform-youtube)" />
  if (platform === 'soundcloud') return <SoundcloudLogo size={10} color="var(--color-platform-soundcloud)" />
  return null
}

export function FilterBar({
  playlists,
  playlistSources,
  activePlaylist,
  search,
  onPlaylistChange,
  onSearchChange,
  onEnterSelectMode,
}: Props) {
  return (
    <div className="space-y-3 px-4 py-3 border-b border-[var(--color-border)]">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {['All', ...playlists].map(pl => (
          <button
            key={pl}
            onClick={() => onPlaylistChange(pl)}
            className={clsx(
              'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors flex items-center gap-1',
              activePlaylist === pl
                ? 'bg-[var(--color-accent)] text-white'
                : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
            )}
          >
            {pl !== 'All' && <PlaylistIcon platform={playlistSources[pl]} />}
            {pl}
          </button>
        ))}

        {/* Mobile-only: enter select mode */}
        <button
          onClick={onEnterSelectMode}
          className="md:hidden shrink-0 rounded-full px-3 py-1 text-xs font-medium bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
        >
          Select
        </button>
      </div>

      <div className="relative">
        <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search songs..."
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-8 pr-4 py-2 text-sm outline-none focus:border-[var(--color-accent)] transition-colors placeholder:text-[var(--color-text-muted)]"
        />
      </div>
    </div>
  )
}
