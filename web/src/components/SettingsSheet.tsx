import { useState, useEffect, useRef } from 'react'
import { X, Trash, SignOut, UserSwitch, CircleNotch, PencilSimple } from '@phosphor-icons/react'
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
  const [unregistering, setUnregistering] = useState(false)
  const [unregisterError, setUnregisterError] = useState('')
  const [editingName, setEditingName] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [renaming, setRenaming] = useState(false)

  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    if (!open) {
      setConfirmText('')
      setConfirmUnregister('')
      setUnregisterError('')
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

  async function handleUnregister() {
    if (!deviceId || confirmUnregister !== UNREGISTER_PHRASE) return
    setUnregistering(true)
    setUnregisterError('')
    try {
      await api.devices.unregister(deviceId)
      clear()
      onUnregistered()
    } catch (e) {
      setUnregisterError(e instanceof Error ? e.message : 'Failed to unregister device')
    } finally {
      setUnregistering(false)
    }
  }

  function handleLogout() {
    clear()
    onUnregistered()
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={e => { if (e.target === dialogRef.current) dialogRef.current?.close() }}
      className="settings-dialog fixed inset-0 z-50 m-0 flex h-full max-h-none w-full max-w-none justify-end border-0 bg-transparent p-0"
    >
      <div className="relative w-full max-w-sm bg-[var(--color-surface)] h-full overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between px-4 py-4 border-b border-[var(--color-border)]">
          <h2 className="font-semibold text-sm">Settings</h2>
          <button onClick={() => dialogRef.current?.close()} className="cursor-pointer p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">
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
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 cursor-pointer rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors w-full mt-3"
            >
              <UserSwitch size={14} />
              Log out
            </button>
            <p className="text-[11px] text-[var(--color-text-muted)] mt-1.5">
              Switch to a different device. This device stays registered — log back in with the same name to pick up where you left off.
            </p>
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
              This will permanently remove this device and delete its download history from the library. You'll need to re-enter your access code to use it again.
            </p>
            <input
              value={confirmUnregister}
              onChange={e => setConfirmUnregister(e.target.value)}
              disabled={unregistering}
              placeholder={`Type "${UNREGISTER_PHRASE}" to confirm`}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-error)]/60 transition-colors placeholder:text-[var(--color-text-muted)] mb-2 disabled:opacity-50"
            />
            <button
              onClick={handleUnregister}
              disabled={unregistering || confirmUnregister !== UNREGISTER_PHRASE}
              className="flex items-center gap-2 cursor-pointer rounded-lg border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors w-full disabled:opacity-40"
            >
              {unregistering ? <CircleNotch size={14} className="animate-spin" /> : <SignOut size={14} />}
              {unregistering ? 'Unregistering...' : 'Unregister this device'}
            </button>
            {unregisterError && (
              <p className="text-[11px] text-[var(--color-error)] mt-1.5">{unregisterError}</p>
            )}
          </section>
        </div>
      </div>
    </dialog>
  )
}
