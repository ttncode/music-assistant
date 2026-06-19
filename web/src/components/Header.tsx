import { ArrowsClockwise, GearSix, MusicNote, YoutubeLogo, SoundcloudLogo } from '@phosphor-icons/react'
import { motion, AnimatePresence } from 'motion/react'
import { ProviderStatusItem, ProvidersStatusResponse } from '../lib/api'

interface Props {
  pendingCount: number
  syncRunning: boolean
  onSync: () => void
  onSettings: () => void
  providerStatus: ProvidersStatusResponse | null
}

function dotColor(item: ProviderStatusItem | undefined): string {
  if (!item || !item.configured) return 'var(--color-text-muted)'
  return item.reachable ? '#10b981' : '#f59e0b'
}

function dotTitle(label: string, item: ProviderStatusItem | undefined): string {
  if (!item || !item.configured) return `${label}: not configured`
  if (item.reachable) return `${label}: connected`
  return `${label}: ${item.error || 'unreachable'}`
}

export function Header({ pendingCount, syncRunning, onSync, onSettings, providerStatus }: Props) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg)]/90 backdrop-blur-sm">
      <div className="flex items-center gap-2">
        <MusicNote size={20} weight="fill" className="text-[var(--color-accent)]" />
        <span className="font-semibold text-sm">Music Assistant</span>
      </div>

      <div className="flex items-center gap-2">
        {/* Provider status dots */}
        <div className="flex items-center gap-1.5">
          <span
            className="relative flex items-center"
            title={dotTitle('YouTube', providerStatus?.youtube)}
          >
            <YoutubeLogo size={14} className="text-[var(--color-text-muted)]" />
            <span
              className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: dotColor(providerStatus?.youtube) }}
            />
          </span>
          <span
            className="relative flex items-center"
            title={dotTitle('SoundCloud', providerStatus?.soundcloud)}
          >
            <SoundcloudLogo size={14} className="text-[var(--color-text-muted)]" />
            <span
              className="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: dotColor(providerStatus?.soundcloud) }}
            />
          </span>
        </div>

        <button
          onClick={onSettings}
          className="p-2 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] transition-colors"
          aria-label="Settings"
        >
          <GearSix size={18} />
        </button>

        <button
          onClick={onSync}
          disabled={syncRunning}
          className="relative flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium transition-colors hover:border-[var(--color-accent)] disabled:opacity-50"
        >
          <motion.span
            animate={syncRunning ? { rotate: 360 } : { rotate: 0 }}
            transition={{ repeat: syncRunning ? Infinity : 0, duration: 1, ease: 'linear' }}
          >
            <ArrowsClockwise size={14} />
          </motion.span>
          Sync
          <AnimatePresence>
            {pendingCount > 0 && (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] rounded-full bg-[var(--color-accent)] text-white text-[10px] font-bold flex items-center justify-center px-1"
              >
                {pendingCount}
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </header>
  )
}
