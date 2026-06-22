import { useState, useCallback, useRef } from 'react'
import { api } from '../lib/api'

interface Progress {
  current: number
  total: number
}

export interface UseBatchDownloadReturn {
  downloadBatch: (songIds: string[]) => Promise<void>
  downloadNext: () => void
  cancel: () => void
  progress: Progress | null
  isRunning: boolean
  awaitingGesture: boolean
}

interface Options {
  onSongDownloaded?: (id: string) => void
  onComplete?: (downloaded: number, failed: number) => void
  manual?: boolean
}

export function useBatchDownload({ onSongDownloaded, onComplete, manual }: Options): UseBatchDownloadReturn {
  const [progress, setProgress] = useState<Progress | null>(null)
  const [awaitingGesture, setAwaitingGesture] = useState(false)

  const runningRef = useRef(false)
  const cancelledRef = useRef(false)
  const awaitingGestureRef = useRef(false)
  const pendingIdsRef = useRef<string[]>([])
  const downloadedCountRef = useRef(0)
  const currentIndexRef = useRef(0)

  const cancel = useCallback(() => {
    cancelledRef.current = true
    if (awaitingGestureRef.current) {
      // Manual mode: no loop is running, reset immediately without calling onComplete
      runningRef.current = false
      cancelledRef.current = false
      awaitingGestureRef.current = false
      pendingIdsRef.current = []
      downloadedCountRef.current = 0
      currentIndexRef.current = 0
      setProgress(null)
      setAwaitingGesture(false)
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
      runningRef.current = false
      cancelledRef.current = false
      awaitingGestureRef.current = false
      pendingIdsRef.current = []
      downloadedCountRef.current = 0
      currentIndexRef.current = 0
      setProgress(null)
      setAwaitingGesture(false)
      onComplete?.(downloaded, 0)
    }
  }, [onSongDownloaded, onComplete])

  const downloadBatch = useCallback(
    async (songIds: string[]) => {
      if (songIds.length === 0 || runningRef.current) return
      runningRef.current = true
      cancelledRef.current = false
      downloadedCountRef.current = 0
      currentIndexRef.current = 0
      setProgress({ current: 0, total: songIds.length })

      // Prepare all songs on the server in parallel
      await Promise.allSettled(songIds.map(id => api.download.prepare(id)))

      if (cancelledRef.current) {
        runningRef.current = false
        cancelledRef.current = false
        setProgress(null)
        return
      }

      if (manual) {
        // iOS: pause here and let the user tap once per song
        pendingIdsRef.current = songIds
        awaitingGestureRef.current = true
        setAwaitingGesture(true)
        return
      }

      // Desktop: auto-download all songs sequentially
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
      runningRef.current = false
      cancelledRef.current = false
      setProgress(null)
      if (!wasCancelled) onComplete?.(downloaded, failed)
    },
    [onSongDownloaded, onComplete, manual],
  )

  return { downloadBatch, downloadNext, cancel, progress, isRunning: progress !== null, awaitingGesture }
}
