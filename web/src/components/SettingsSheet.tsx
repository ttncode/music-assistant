import { useState } from 'react'
import { X, Trash, SignOut, CircleNotch } from '@phosphor-icons/react'
import { useDevice } from '../hooks/useDevice'
import { api } from '../lib/api'

interface Props {
  open: boolean
  onClose: () => void
  onHistoryCleared: () => void
}

const CONFIRM_PHRASE = 'clear history'

export function SettingsSheet({ open, onClose, onHistoryCleared }: Props) {
  const { deviceId, deviceName, clear } = useDevice()
  const [confirmText, setConfirmText] = useState('')
  const [clearing, setClearing] = useState(false)

  async function handleClearHistory() {
    if (!deviceId || confirmText !== CONFIRM_PHRASE) return
    setClearing(true)
    try {
      await api.devices.clearHistory(deviceId)
      setConfirmText('')
      onHistoryCleared()
    } finally {
      setClearing(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-[var(--color-surface)] h-full overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--color-border)]">
          <h2 className="font-semibold text-sm">Settings</h2>
          <button onClick={onClose} className="p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-6">
          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-3">This device</h3>
            <p className="text-sm font-medium">{deviceName}</p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-0.5 font-mono">{deviceId}</p>
          </section>

          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-3">Download history</h3>
            <input
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              disabled={clearing}
              placeholder={`Type "${CONFIRM_PHRASE}" to confirm`}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-error)]/60 transition-colors placeholder:text-[var(--color-text-muted)] mb-2 disabled:opacity-50"
            />
            <button
              onClick={handleClearHistory}
              disabled={clearing || confirmText !== CONFIRM_PHRASE}
              className="flex items-center gap-2 rounded-lg border border-[var(--color-error)]/30 px-3 py-2 text-xs text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors w-full disabled:opacity-40"
            >
              {clearing ? <CircleNotch size={14} className="animate-spin" /> : <Trash size={14} />}
              {clearing ? 'Clearing...' : 'Clear download history'}
            </button>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5">
              Marks all songs as undownloaded for this device. MP3 files are not deleted.
            </p>
          </section>

          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-3">Account</h3>
            <button
              onClick={clear}
              className="flex items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors w-full"
            >
              <SignOut size={14} />
              Unregister this device
            </button>
          </section>
        </div>
      </div>
    </div>
  )
}
