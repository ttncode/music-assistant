import { useState, FormEvent } from 'react'
import { MusicNote } from '@phosphor-icons/react'
import { useDevice } from '../hooks/useDevice'

interface Props {
  onRegistered: () => void
}

export function DeviceNameScreen({ onRegistered }: Props) {
  const { register } = useDevice()
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await register(name.trim())
      onRegistered()
    } catch {
      setError('Failed to register device. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4">
      <p className="fixed bottom-4 left-0 right-0 text-center text-[10px] text-[var(--color-text-muted)]">v{__APP_VERSION__}</p>
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-1">
          <MusicNote size={40} weight="fill" className="text-[var(--color-accent)]" />
          <span className="text-2xl font-semibold tracking-tight">Music Assistant</span>
        </div>

        <div>
          <h1 className="text-lg font-medium text-[var(--color-text-secondary)]">Name this device</h1>
          <p className="text-[var(--color-text-secondary)] text-sm mt-1">
            Give this device a name so you can track downloads separately. You can change it later.
          </p>
        </div>

        <div className="space-y-2">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. iPhone Main, Work Laptop"
            autoFocus
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)] transition-colors"
          />
          {error && <p className="text-[var(--color-error)] text-sm">{error}</p>}
        </div>

        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="w-full rounded-lg bg-[var(--color-accent)] px-4 py-3 text-sm font-medium text-white disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          {loading ? 'Saving...' : 'Save and continue'}
        </button>
      </form>
    </div>
  )
}
