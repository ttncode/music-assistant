import { useState, FormEvent } from 'react'
import { TiktokLogo, ArrowCircleDown } from '@phosphor-icons/react'
import { getDevice } from '../lib/device'

export function TikTokDownload() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setError('')
    setLoading(true)
    try {
      const device = getDevice()
      const res = await fetch('/api/download/tiktok', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-ID': device?.id ?? '',
        },
        body: JSON.stringify({ url: url.trim() }),
      })
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const disposition = res.headers.get('content-disposition') ?? ''
      const filename = disposition.match(/filename="(.+)"/)?.[1] ?? 'tiktok.mp3'
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = filename
      link.click()
      URL.revokeObjectURL(link.href)
      setUrl('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="px-4 py-3 border-b border-[var(--color-border)]">
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 flex items-center gap-1">
        <TiktokLogo size={11} color="var(--color-platform-tiktok)" />
        TikTok quick download
      </p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder="Paste TikTok link..."
          className="flex-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-platform-tiktok)] transition-colors placeholder:text-[var(--color-text-muted)]"
        />
        <button
          type="submit"
          disabled={loading || !url.trim()}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--color-platform-tiktok)] px-3 py-2 text-xs font-medium text-[var(--color-platform-tiktok)] disabled:opacity-40 active:scale-[0.98] transition-transform shrink-0"
        >
          <ArrowCircleDown size={14} className={loading ? 'animate-spin' : ''} />
          {loading ? 'Downloading...' : 'Download'}
        </button>
      </form>
      {error && <p className="text-[var(--color-error)] text-xs mt-1">{error}</p>}
    </div>
  )
}
