import { useState, FormEvent } from 'react'
import { api } from '../lib/api'

interface Props {
  onVerified: () => void
}

export function AuthScreen({ onVerified }: Props) {
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.auth.verify(code)
      onVerified()
    } catch {
      setError('Wrong code. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Music Assistant</h1>
        <div className="space-y-1">
          <p className="text-[var(--color-text-secondary)] text-sm">Enter your access code to continue.</p>
          <p className="text-[var(--color-text-secondary)] text-sm">
            Don't have an access code? Contact the admin at{' '}
            <a
              href="mailto:ttn.dev.fullstack@gmail.com"
              className="text-[var(--color-accent)] underline-offset-2 hover:underline"
            >
              ttn.dev.fullstack@gmail.com
            </a>
            {' '}to request one.
          </p>
        </div>

        <div className="space-y-2">
          <input
            type="password"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="Access code"
            autoFocus
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 text-sm outline-none focus:border-[var(--color-accent)] transition-colors"
          />
          {error && <p className="text-[var(--color-error)] text-sm">{error}</p>}
        </div>

        <button
          type="submit"
          disabled={loading || !code}
          className="w-full rounded-lg bg-[var(--color-accent)] px-4 py-3 text-sm font-medium text-white disabled:opacity-40 active:scale-[0.98] transition-transform"
        >
          {loading ? 'Checking...' : 'Continue'}
        </button>
      </form>
    </div>
  )
}
