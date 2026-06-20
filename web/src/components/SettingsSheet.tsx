import { useState, useEffect } from 'react'
import { X, Trash, SignOut, CircleNotch, PencilSimple } from '@phosphor-icons/react'
import { useDevice } from '../hooks/useDevice'
import { api } from '../lib/api'

interface Props {
  open: boolean
  onClose: () => void
  onHistoryCleared: () => void
  onUnregistered: () => void
}

const CONFIRM_PHRASE = 'clear history'
const UNREGISTER_PHRASE = 'unregister'

export function SettingsSheet({ open, onClose, onHistoryCleared, onUnregistered }: Props) {
  const { deviceId, deviceName, rename, clear } = useDevice()
  const [confirmText, setConfirmText] = useState('')
  const [clearing, setClearing] = useState(false)
  const [confirmUnregister, setConfirmUnregister] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [renaming, setRenaming] = useState(false)

  useEffect(() => {
    if (!open) {
      setConfirmText('')
      setConfirmUnregister('')
      setEditingName(false)
      setDraftName('')
    }
  }, [open])

  async function handleRename() {
    const trimmed = draftName.trim()
    if (!trimmed || trimmed === deviceName) { setEditingName(false); return }
    setRenaming(true)
    try {
      await rename(trimmed)
      setEditingName(false)
    } finally {
      setRenaming(false)
    }
  }

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

  function handleUnregister() {
    if (confirmUnregister !== UNREGISTER_PHRASE) return
    clear()
    onUnregistered()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-[var(--color-surface)] h-full overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--color-border)]">
          <h2 className="font-semibold text-sm">Settings</h2>
          <button onClick={onClose} className="cursor-pointer p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-6">
          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-[var(--color-text-muted)] mb-3">This device</h3>
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  value={draftName}
                  onChange={e => setDraftName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleRename()
                    if (e.key === 'Escape') setEditingName(false)
                  }}
                  disabled={renaming}
                  autoFocus
                  className="flex-1 rounded-lg border border-[var(--color-accent)] bg-[var(--color-bg)] px-2 py-1 text-sm outline-none transition-colors disabled:opacity-50"
                />
                <button
                  onClick={handleRename}
                  disabled={renaming || !draftName.trim()}
                  className="cursor-pointer px-2 py-1 rounded text-xs text-[var(--color-accent)] font-medium hover:bg-[var(--color-surface-elevated)] transition-colors disabled:opacity-40"
                >
                  {renaming ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={() => setEditingName(false)}
                  disabled={renaming}
                  className="cursor-pointer p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group/rename">
                <p className="text-sm font-medium">{deviceName}</p>
                <button
                  onClick={() => { setDraftName(deviceName ?? ''); setEditingName(true) }}
                  className="cursor-pointer opacity-0 group-hover/rename:opacity-100 p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-all"
                  aria-label="Rename device"
                >
                  <PencilSimple size={13} />
                </button>
              </div>
            )}
            <p className="text-xs text-[var(--color-text-secondary)] mt-1 font-mono">{deviceId}</p>
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
              className="flex items-center gap-2 cursor-pointer rounded-lg border border-[var(--color-error)]/30 px-3 py-2 text-xs text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors w-full disabled:opacity-40"
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
            <p className="text-[11px] text-[var(--color-text-muted)] mb-2">
              This will remove this device. You'll need to re-enter your access code to use it again.
            </p>
            <input
              value={confirmUnregister}
              onChange={e => setConfirmUnregister(e.target.value)}
              placeholder={`Type "${UNREGISTER_PHRASE}" to confirm`}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-error)]/60 transition-colors placeholder:text-[var(--color-text-muted)] mb-2"
            />
            <button
              onClick={handleUnregister}
              disabled={confirmUnregister !== UNREGISTER_PHRASE}
              className="flex items-center gap-2 cursor-pointer rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors w-full disabled:opacity-40"
            >
              <SignOut size={14} />
              Unregister this device
            </button>
          </section>

          <p className="text-[11px] text-[var(--color-text-muted)] pt-2">v{__APP_VERSION__}</p>
        </div>
      </div>
    </div>
  )
}
