import { useState, FormEvent } from 'react'
import { TiktokLogo, ArrowCircleDown, ClipboardText } from '@phosphor-icons/react'
import { getDevice } from '../lib/device'

interface Props {
  onDownloaded?: () => void
}

export function TikTokDownload({ onDownloaded }: Props) {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText()
      if (text) setUrl(text.trim())
    } catch { /* permission denied or unavailable */ }
  }

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
      const match5987 = disposition.match(/filename\*=UTF-8''([^\s;]+)/i)
      const matchQuoted = disposition.match(/filename="(.+?)"/)
      const filename = match5987
        ? decodeURIComponent(match5987[1])
        : (matchQuoted?.[1] ?? 'tiktok.mp3')
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = filename
      link.click()
      URL.revokeObjectURL(link.href)
      setUrl('')
      onDownloaded?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)] mb-2 flex items-center gap-1">
        <TiktokLogo size={11} color="var(--color-platform-tiktok)" />
        TikTok quick download
      </p>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <div className="relative flex-1">
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="Paste TikTok link..."
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 pr-9 text-sm outline-none focus:border-[var(--color-platform-tiktok)] transition-colors placeholder:text-[var(--color-text-muted)]"
          />
          <button
            type="button"
            onClick={handlePaste}
            aria-label="Paste from clipboard"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
          >
            <ClipboardText size={15} />
          </button>
        </div>
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
