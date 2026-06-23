import { useState, useCallback, useRef } from 'react'
import { api } from '../lib/api'

interface Progress {
  current: number
  total: number
}

export interface UseBatchDownloadReturn {
  downloadBatch: (songIds: string[]) => Promise<void>
  downloadNext: () => void
  shareAll: () => void
  cancel: () => void
  progress: Progress | null
  isRunning: boolean
  awaitingGesture: boolean
  awaitingShare: boolean
}

interface Options {
  onSongDownloaded?: (id: string) => void
  onComplete?: (downloaded: number, failed: number) => void
  mode?: 'auto' | 'tap-per-song' | 'share'
}

async function fetchBlob(songId: string): Promise<{ id: string; blob: Blob; filename: string }> {
  const url = api.download.url(songId)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const blob = await response.blob()
  const disposition = response.headers.get('content-disposition') ?? ''
  const match5987 = disposition.match(/filename\*=UTF-8''([^\s;]+)/i)
  const matchQuoted = disposition.match(/filename="(.+?)"/)
  const filename = match5987
    ? decodeURIComponent(match5987[1])
    : (matchQuoted?.[1] ?? `song-${songId}.mp3`)
  return { id: songId, blob, filename }
}

export function useBatchDownload({ onSongDownloaded, onComplete, mode = 'auto' }: Options): UseBatchDownloadReturn {
  const [progress, setProgress] = useState<Progress | null>(null)
  const [awaitingGesture, setAwaitingGesture] = useState(false)
  const [awaitingShare, setAwaitingShare] = useState(false)

  const runningRef = useRef(false)
  const cancelledRef = useRef(false)
  const awaitingGestureRef = useRef(false)
  const awaitingShareRef = useRef(false)
  const pendingIdsRef = useRef<string[]>([])
  const pendingFilesRef = useRef<{ id: string; blob: Blob; filename: string }[]>([])
  const failedCountRef = useRef(0)
  const downloadedCountRef = useRef(0)
  const currentIndexRef = useRef(0)

  // Only uses refs and stable state setters — safe to call from any memoized callback
  function resetState() {
    runningRef.current = false
    cancelledRef.current = false
    awaitingGestureRef.current = false
    awaitingShareRef.current = false
    pendingIdsRef.current = []
    pendingFilesRef.current = []
    failedCountRef.current = 0
    downloadedCountRef.current = 0
    currentIndexRef.current = 0
    setProgress(null)
    setAwaitingGesture(false)
    setAwaitingShare(false)
  }

  const cancel = useCallback(() => {
    cancelledRef.current = true
    if (awaitingGestureRef.current || awaitingShareRef.current) {
      // Not in an async loop — reset immediately without calling onComplete
      resetState()
    }
    // Auto mode: the running loop checks cancelledRef and resets itself
  }, [])

  const downloadNext = useCallback(() => {
    if (!awaitingGestureRef.current || cancelledRef.current) return
    const ids = pendingIdsRef.current
    const index = currentIndexRef.current
    if (index >= ids.length) return

    // Synchronous — no await between user tap and file() call, preserving iOS gesture chain
    api.download.file(ids[index])
    downloadedCountRef.current++
    onSongDownloaded?.(ids[index])

    const next = index + 1
    currentIndexRef.current = next
    setProgress({ current: next, total: ids.length })

    if (next >= ids.length) {
      const downloaded = downloadedCountRef.current
      resetState()
      onComplete?.(downloaded, 0)
    }
  }, [onSongDownloaded, onComplete])

  const shareAll = useCallback(() => {
    if (!awaitingShareRef.current || cancelledRef.current) return
    const files = pendingFilesRef.current.map(
      ({ blob, filename }) => new File([blob], filename, { type: 'audio/mpeg' }),
    )
    const downloaded = files.length
    const failed = failedCountRef.current
    const ids = pendingFilesRef.current.map(f => f.id)

    // Synchronous call — no await before navigator.share(), preserving iOS gesture chain
    navigator
      .share({ files })
      .then(() => {
        ids.forEach(id => onSongDownloaded?.(id))
        resetState()
        onComplete?.(downloaded, failed)
      })
      .catch((err: unknown) => {
        // AbortError = user dismissed the share sheet — stay in awaitingShare so they can retry
        if (err instanceof Error && err.name === 'AbortError') return
        resetState()
        onComplete?.(0, downloaded + failed)
      })
  }, [onSongDownloaded, onComplete])

  const downloadBatch = useCallback(
    async (songIds: string[]) => {
      if (songIds.length === 0 || runningRef.current) return
      runningRef.current = true
      cancelledRef.current = false
      downloadedCountRef.current = 0
      currentIndexRef.current = 0
      failedCountRef.current = 0
      setProgress({ current: 0, total: songIds.length })

      // Prepare all songs on the server in parallel
      await Promise.allSettled(songIds.map(id => api.download.prepare(id)))

      if (cancelledRef.current) {
        resetState()
        return
      }

      if (mode === 'share') {
        // iOS Web Share API: fetch all MP3 bytes to browser memory, then share all at once
        const results = await Promise.allSettled(songIds.map(id => fetchBlob(id)))
        if (cancelledRef.current) {
          resetState()
          return
        }
        const successful = results
          .filter((r): r is PromiseFulfilledResult<{ id: string; blob: Blob; filename: string }> => r.status === 'fulfilled')
          .map(r => r.value)
        failedCountRef.current = results.length - successful.length
        if (successful.length === 0) {
          resetState()
          onComplete?.(0, songIds.length)
          return
        }
        pendingFilesRef.current = successful
        setProgress({ current: 0, total: successful.length })
        awaitingShareRef.current = true
        setAwaitingShare(true)
        return
      }

      if (mode === 'tap-per-song') {
        // iOS fallback: pause and let the user tap once per song
        pendingIdsRef.current = songIds
        awaitingGestureRef.current = true
        setAwaitingGesture(true)
        return
      }

      // Desktop auto mode: download all songs sequentially
      let downloaded = 0
      let failed = 0

      for (let i = 0; i < songIds.length; i++) {
        if (cancelledRef.current) break
        try {
          api.download.file(songIds[i])
          downloaded++
          onSongDownloaded?.(songIds[i])
        } catch {
          failed++
        }
        setProgress({ current: i + 1, total: songIds.length })
        if (i < songIds.length - 1) {
          await new Promise<void>(resolve => setTimeout(resolve, 800))
        }
      }

      const wasCancelled = cancelledRef.current
      resetState()
      if (!wasCancelled) onComplete?.(downloaded, failed)
    },
    [onSongDownloaded, onComplete, mode],
  )

  return {
    downloadBatch,
    downloadNext,
    shareAll,
    cancel,
    progress,
    isRunning: progress !== null,
    awaitingGesture,
    awaitingShare,
  }
}
