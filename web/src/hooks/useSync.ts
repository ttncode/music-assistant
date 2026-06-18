import { useState, useCallback } from 'react'
import { api } from '../lib/api'

export function useSync(onComplete: () => void) {
  const [running, setRunning] = useState(false)
  const [lastResult, setLastResult] = useState<{ added: number } | null>(null)

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
          setLastResult({ added: status.added })
          onComplete()
        }
      }, 2000)
    } catch {
      setRunning(false)
    }
  }, [running, onComplete])

  return { trigger, running, lastResult }
}
