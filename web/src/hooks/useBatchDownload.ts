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

export function useBatchDownload(onComplete: () => void): UseBatchDownloadReturn {
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

      // Kick off all server-side downloads in parallel so yt-dlp starts fetching all songs at once
      await Promise.allSettled(songIds.map(id => api.download.prepare(id)))

      // Trigger browser file-save dialogs sequentially with 800ms gaps to avoid pop-up blocking
      for (let i = 0; i < songIds.length; i++) {
        if (cancelledRef.current) break
        const link = document.createElement('a')
        link.href = api.download.url(songIds[i])
        link.download = ''
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        setProgress({ current: i + 1, total: songIds.length })
        if (i < songIds.length - 1) {
          await new Promise<void>(resolve => setTimeout(resolve, 800))
        }
      }

      const wasCancelled = cancelledRef.current
      runningRef.current = false
      cancelledRef.current = false
      setProgress(null)
      if (!wasCancelled) onComplete()
    },
    [onComplete],
  )

  return { downloadBatch, cancel, progress, isRunning: progress !== null }
}
