import { useState } from 'react'
import { MagnifyingGlass, YoutubeLogo, SoundcloudLogo, TiktokLogo } from '@phosphor-icons/react'
import { clsx } from 'clsx'

type Platform = 'all' | 'youtube' | 'soundcloud' | 'tiktok'

const PLATFORM_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  tiktok: 'TikTok',
}

const PLATFORM_IDS: Platform[] = ['all', 'youtube', 'soundcloud', 'tiktok']

const PLATFORM_UI_LABELS: Record<Platform, string> = {
  all: 'All',
  youtube: 'YouTube',
  soundcloud: 'SoundCloud',
  tiktok: 'TikTok',
}

function onWheelHorizontal(e: React.WheelEvent<HTMLDivElement>) {
  const el = e.currentTarget
  const canScrollLeft = el.scrollLeft > 0
  const canScrollRight = el.scrollLeft < el.scrollWidth - el.clientWidth
  if (e.deltaY !== 0 && (canScrollLeft || canScrollRight)) {
    e.preventDefault()
    el.scrollLeft += e.deltaY
  }
}

function PlatformIcon({ id, active }: { id: Platform; active: boolean }) {
  const size = 12
  if (id === 'youtube') return <YoutubeLogo size={size} color={active ? 'currentColor' : 'var(--color-platform-youtube)'} />
  if (id === 'soundcloud') return <SoundcloudLogo size={size} color={active ? 'currentColor' : 'var(--color-platform-soundcloud)'} />
  if (id === 'tiktok') return <TiktokLogo size={size} color={active ? 'currentColor' : 'var(--color-platform-tiktok)'} />
  return null
}

interface Props {
  playlists: string[]
  activePlaylist: string
  search: string
  playlistSources: Record<string, string>
  activePlatform: Platform
  onPlaylistChange: (p: string) => void
  onSearchChange: (s: string) => void
  onPlatformChange: (p: Platform) => void
  onEnterSelectMode: () => void
}

export function FilterBar({
  playlists,
  activePlaylist,
  search,
  playlistSources,
  activePlatform,
  onPlaylistChange,
  onSearchChange,
  onPlatformChange,
  onEnterSelectMode,
}: Props) {
  const [tooltipInfo, setTooltipInfo] = useState<{ label: string; x: number; y: number } | null>(null)

  return (
    <>
      <div className="space-y-3 px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" onWheel={onWheelHorizontal}>
          {PLATFORM_IDS.map(id => {
            const isActive = activePlatform === id
            return (
              <button
                key={id}
                onClick={() => onPlatformChange(id)}
                className={clsx(
                  'shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors flex items-center gap-1.5',
                  isActive
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
                )}
              >
                <PlatformIcon id={id} active={isActive} />
                {PLATFORM_UI_LABELS[id]}
              </button>
            )
          })}
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" onWheel={onWheelHorizontal}>
          {['All', ...playlists].map(pl => {
            const platformLabel = pl !== 'All' ? PLATFORM_LABELS[playlistSources[pl]] : undefined
            return (
              <button
                key={pl}
                onClick={() => onPlaylistChange(pl)}
                onMouseEnter={platformLabel ? (e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setTooltipInfo({ label: platformLabel, x: rect.left + rect.width / 2, y: rect.top })
                } : undefined}
                onMouseLeave={platformLabel ? () => setTooltipInfo(null) : undefined}
                className={clsx(
                  'shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs font-medium transition-colors',
                  activePlaylist === pl
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)]',
                )}
              >
                {pl}
              </button>
            )
          })}

          <button
            onClick={onEnterSelectMode}
            className="md:hidden shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs font-medium bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors"
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

      {tooltipInfo && (
        <div
          className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full px-2 py-1 rounded text-[10px] bg-[var(--color-surface-elevated)] text-[var(--color-text-secondary)] whitespace-nowrap"
          style={{ left: tooltipInfo.x, top: tooltipInfo.y - 6 }}
        >
          {tooltipInfo.label}
        </div>
      )}
    </>
  )
}
