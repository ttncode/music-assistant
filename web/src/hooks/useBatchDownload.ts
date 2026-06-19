import { useState, useCallback, useRef } from 'react'
import { api } from '../lib/api'

interface Progress {
  current: number
  total: number
}

export interface UseBatchDownloadReturn {
  downloadBatch: (songIds: string[]) => Promise<void>
  cancel: () => void
  progress: Progress | null
  isRunning: boolean
}

interface Options {
  onSongDownloaded?: (id: string) => void
  onComplete?: (downloaded: number, failed: number) => void
}

export function useBatchDownload({ onSongDownloaded, onComplete }: Options): UseBatchDownloadReturn {
  const [progress, setProgress] = useState<Progress | null>(null)
  const runningRef = useRef(false)
  const cancelledRef = useRef(false)

  const cancel = useCallback(() => {
    cancelledRef.current = true
  }, [])

  const downloadBatch = useCallback(
    async (songIds: string[]) => {
      if (songIds.length === 0 || runningRef.current) return
      runningRef.current = true
      cancelledRef.current = false
      setProgress({ current: 0, total: songIds.length })

      // Start server-side prepare for all songs in parallel
      await Promise.allSettled(songIds.map(id => api.download.prepare(id)))

      let downloaded = 0
      let failed = 0

      for (let i = 0; i < songIds.length; i++) {
        if (cancelledRef.current) break
        try {
          await api.download.file(songIds[i])
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
    [onSongDownloaded, onComplete],
  )

  return { downloadBatch, cancel, progress, isRunning: progress !== null }
}
