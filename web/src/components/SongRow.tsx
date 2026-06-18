import { useState } from 'react'
import { ArrowCircleDown, CheckCircle, X, SoundcloudLogo, YoutubeLogo, TiktokLogo, MusicNote } from '@phosphor-icons/react'
import { clsx } from 'clsx'
import { SongResponse } from '../lib/api'
import { api } from '../lib/api'

interface Props {
  song: SongResponse
  onDelete: (id: string) => void
  onDownloaded: () => void
}

const PLATFORM_ICONS = {
  youtube: YoutubeLogo,
  soundcloud: SoundcloudLogo,
  tiktok: TiktokLogo,
  other: MusicNote,
}

const PLATFORM_COLORS = {
  youtube: 'var(--color-platform-youtube)',
  soundcloud: 'var(--color-platform-soundcloud)',
  tiktok: 'var(--color-platform-tiktok)',
  other: 'var(--color-text-secondary)',
}

export function SongRow({ song, onDelete, onDownloaded }: Props) {
  const [downloading, setDownloading] = useState(false)
  const PlatformIcon = PLATFORM_ICONS[song.platform]

  async function handleDownload() {
    setDownloading(true)
    try {
      await api.download.prepare(song.id)
      // Trigger browser download
      const link = document.createElement('a')
      link.href = api.download.url(song.id)
      link.download = ''
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      setTimeout(onDownloaded, 3000) // refetch after a delay
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-surface)] transition-colors group">
      {/* Thumbnail */}
      <div className="shrink-0 w-10 h-10 rounded-md bg-[var(--color-surface-elevated)] overflow-hidden flex items-center justify-center">
        {song.thumbnail
          ? <img src={song.thumbnail} alt="" className="w-full h-full object-cover" />
          : <PlatformIcon size={18} color={PLATFORM_COLORS[song.platform]} />
        }
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <a
          href={song.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block truncate text-sm font-medium hover:text-[var(--color-accent)] transition-colors"
        >
          {song.title}
        </a>
        <div className="flex items-center gap-1.5 mt-0.5">
          <PlatformIcon size={11} color={PLATFORM_COLORS[song.platform]} />
          <span className="text-[11px] text-[var(--color-text-muted)]">{song.playlist}</span>
        </div>
      </div>

      {/* Status + actions */}
      <div className="flex items-center gap-2 shrink-0">
        {song.downloaded ? (
          <span className="flex items-center gap-1 text-[11px] text-[var(--color-accent)] font-medium">
            <CheckCircle size={14} weight="fill" />
            Done
          </span>
        ) : (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className={clsx(
              'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              downloading
                ? 'text-[var(--color-text-muted)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)]'
            )}
          >
            <ArrowCircleDown size={14} className={downloading ? 'animate-spin' : ''} />
            {downloading ? 'Preparing...' : 'Download'}
          </button>
        )}

        <button
          onClick={() => onDelete(song.id)}
          className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-all"
          aria-label="Remove song"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
