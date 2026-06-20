import { useState, useEffect } from 'react'
import {
  ArrowCircleDown,
  Check,
  CheckCircle,
  X,
  SoundcloudLogo,
  YoutubeLogo,
  TiktokLogo,
  MusicNote,
} from '@phosphor-icons/react'
import { clsx } from 'clsx'
import { SongResponse, api } from '../lib/api'

interface Props {
  song: SongResponse
  onDelete: (id: string) => void
  onDownloaded: () => void
  onError: (message: string) => void
  isSelectMode: boolean
  selected: boolean
  onToggle: (id: string) => void
  isJustDownloaded?: boolean
  historyVersion: number
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

export function SongRow({ song, onDelete, onDownloaded, onError, isSelectMode, selected, onToggle, isJustDownloaded, historyVersion }: Props) {
  const [downloading, setDownloading] = useState(false)
  const [localDownloaded, setLocalDownloaded] = useState(false)

  useEffect(() => {
    setLocalDownloaded(false)
  }, [historyVersion])
  const PlatformIcon = PLATFORM_ICONS[song.platform]

  const isDownloaded = song.downloaded || isJustDownloaded || localDownloaded

  async function handleDownload() {
    setDownloading(true)
    try {
      await api.download.prepare(song.id)
      await api.download.file(song.id)
      setLocalDownloaded(true)
      onDownloaded()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border)] hover:bg-[var(--color-surface)] transition-colors group">
      {/* Checkbox */}
      <button
        onClick={() => onToggle(song.id)}
        aria-label={selected ? 'Deselect song' : 'Select song'}
        className={clsx(
          'shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors',
          isSelectMode ? 'flex' : 'hidden md:flex',
          selected
            ? 'border-[var(--color-accent)] bg-[var(--color-accent)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-accent)]',
        )}
      >
        {selected && <Check size={10} weight="bold" className="text-white" />}
      </button>

      {/* Thumbnail with downloaded badge */}
      <div className="relative shrink-0 w-10 h-10 rounded-md bg-[var(--color-surface-elevated)] overflow-visible flex items-center justify-center">
        <div className="w-10 h-10 rounded-md overflow-hidden flex items-center justify-center">
          {song.thumbnail ? (
            <img src={song.thumbnail} alt="" className="w-full h-full object-cover" />
          ) : (
            <PlatformIcon size={18} color={PLATFORM_COLORS[song.platform]} />
          )}
        </div>
        {isDownloaded && (
          <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-[var(--color-bg)] flex items-center justify-center">
            <CheckCircle size={13} weight="fill" className="text-[var(--color-accent)]" />
          </span>
        )}
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

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {!isDownloaded && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            className={clsx(
              'flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              downloading
                ? 'text-[var(--color-text-muted)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)]',
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
