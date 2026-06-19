import { useState, useCallback } from 'react'
import { api } from '../lib/api'

export interface SyncResult {
  added: number
  error: string | null
}

export function useSync(onComplete: (result: SyncResult) => void) {
  const [running, setRunning] = useState(false)

  const trigger = useCallback(async () => {
    if (running) return
    setRunning(true)
    try {
      await api.sync.trigger()
      const poll = setInterval(async () => {
        const status = await api.sync.status()
        if (!status.running) {
          clearInterval(poll)
          setRunning(false)
          onComplete({ added: status.added, error: status.error })
        }
      }, 2000)
    } catch {
      setRunning(false)
      onComplete({ added: 0, error: 'Failed to start sync' })
    }
  }, [running, onComplete])

  return { trigger, running }
}
