import { useState, useEffect, useRef } from 'react'
import {
  ArrowCircleDown,
  Check,
  CheckCircle,
  Trash,
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
  onEnterSelectMode: () => void
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

const DELETE_WIDTH = 64
const SNAP_THRESHOLD = 40
const MOVE_SLOP = 8

export function SongRow({ song, onDelete, onDownloaded, onError, isSelectMode, selected, onToggle, onEnterSelectMode, isJustDownloaded, historyVersion }: Props) {
  const [downloading, setDownloading] = useState(false)
  const [localDownloaded, setLocalDownloaded] = useState(false)
  const [swipeX, setSwipeXState] = useState(0)
  const [snapping, setSnapping] = useState(false)

  const swipeXRef = useRef(0)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStart = useRef<{ x: number; y: number; baseSwipeX: number } | null>(null)
  const swipeDragging = useRef(false)
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLocalDownloaded(false)
  }, [historyVersion])

  function setSwipeX(x: number) {
    swipeXRef.current = x
    setSwipeXState(x)
  }

  // Non-passive touchmove listener so e.preventDefault() can block page scroll
  // during a confirmed horizontal swipe. JSX onTouchMove is passive and cannot
  // call preventDefault().
  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    function onTouchMove(e: TouchEvent) {
      if (!touchStart.current) return
      const touch = e.touches[0]
      const dx = touch.clientX - touchStart.current.x
      const dy = touch.clientY - touchStart.current.y
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)
      if (absDx > MOVE_SLOP || absDy > MOVE_SLOP) {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current)
          longPressTimer.current = null
        }
      }
      if (!swipeDragging.current && absDx > absDy && absDx > MOVE_SLOP && !isSelectMode) {
        swipeDragging.current = true
      }
      if (swipeDragging.current) {
        e.preventDefault()
        const newX = Math.max(Math.min(touchStart.current.baseSwipeX + dx, 0), -DELETE_WIDTH)
        swipeXRef.current = newX
        setSwipeXState(newX)
      }
    }
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => el.removeEventListener('touchmove', onTouchMove)
  }, [isSelectMode])

  const PlatformIcon = PLATFORM_ICONS[song.platform]
  const isDownloaded = song.downloaded || isJustDownloaded || localDownloaded

  function handleTouchStart(e: React.TouchEvent) {
    const touch = e.touches[0]
    touchStart.current = { x: touch.clientX, y: touch.clientY, baseSwipeX: swipeXRef.current }
    swipeDragging.current = false
    setSnapping(false)
    if (!isSelectMode) {
      longPressTimer.current = setTimeout(() => {
        navigator.vibrate?.(30)
        onEnterSelectMode()
        onToggle(song.id)
      }, 300)
    }
  }

  function handleTouchEnd() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
    if (!swipeDragging.current) return
    swipeDragging.current = false
    setSnapping(true)
    const target = swipeXRef.current < -SNAP_THRESHOLD ? -DELETE_WIDTH : 0
    swipeXRef.current = target
    setSwipeXState(target)
  }

  async function handleDownload() {
    setDownloading(true)
    try {
      await api.download.prepare(song.id)
      api.download.file(song.id)
      setLocalDownloaded(true)
      onDownloaded()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="relative overflow-hidden border-b border-[var(--color-border)]">
      {/* Mobile delete button — sits behind row content, revealed by swiping left */}
      <button
        onClick={() => onDelete(song.id)}
        aria-label="Remove song"
        className="absolute right-0 top-0 bottom-0 w-16 md:hidden flex items-center justify-center bg-[var(--color-error)]/90 text-white"
      >
        <Trash size={18} />
      </button>

      {/* Invisible overlay covering the row content area when swipe is open.
          Captures taps to close the swipe without triggering row actions. */}
      {swipeX < 0 && (
        <div
          className="absolute inset-y-0 left-0 z-10"
          style={{ right: DELETE_WIDTH }}
          onClick={() => setSwipeX(0)}
        />
      )}

      {/* Row content — translates left on swipe */}
      <div
        ref={rowRef}
        className="flex items-center gap-3 px-4 py-3 bg-[var(--color-bg)] hover:bg-[var(--color-surface)] group"
        style={{
          transform: `translateX(${swipeX}px)`,
          transition: snapping
            ? 'transform 150ms ease-out, background-color 150ms'
            : 'background-color 150ms',
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/* Checkbox */}
        <button
          onClick={() => onToggle(song.id)}
          aria-label={selected ? 'Deselect song' : 'Select song'}
          className={clsx(
            'shrink-0 cursor-pointer w-4 h-4 rounded border flex items-center justify-center transition-colors',
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
                'flex items-center gap-1 cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                downloading
                  ? 'text-[var(--color-text-muted)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-accent)] hover:bg-[var(--color-accent-muted)]',
              )}
            >
              <ArrowCircleDown size={14} className={downloading ? 'animate-spin' : ''} />
              {downloading ? 'Preparing...' : 'Download'}
            </button>
          )}

          {/* Desktop-only — hidden on mobile (swipe-to-delete handles it there) */}
          <button
            onClick={() => onDelete(song.id)}
            className="opacity-0 group-hover:opacity-100 cursor-pointer p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-error)] transition-all hidden md:flex"
            aria-label="Remove song"
          >
            <X size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
