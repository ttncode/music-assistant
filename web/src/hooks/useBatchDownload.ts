import { useState, useCallback, useRef } from 'react'
import { api } from '../lib/api'

interface Progress {
  current: number
  total: number
}

export interface UseBatchDownloadReturn {
  downloadBatch: (songIds: string[]) => Promise<void>
  progress: Progress | null
  isRunning: boolean
}

export function useBatchDownload(onComplete: () => void): UseBatchDownloadReturn {
  const [progress, setProgress] = useState<Progress | null>(null)
  const runningRef = useRef(false)

  const downloadBatch = useCallback(
    async (songIds: string[]) => {
      if (songIds.length === 0 || runningRef.current) return
      runningRef.current = true
      setProgress({ current: 0, total: songIds.length })

      // Kick off all server-side downloads in parallel so yt-dlp starts fetching all songs at once
      await Promise.allSettled(songIds.map(id => api.download.prepare(id)))

      // Trigger browser file-save dialogs sequentially with 800ms gaps to avoid pop-up blocking
      for (let i = 0; i < songIds.length; i++) {
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

      runningRef.current = false
      setProgress(null)
      onComplete()
    },
    [onComplete],
  )

  return { downloadBatch, progress, isRunning: progress !== null }
}
