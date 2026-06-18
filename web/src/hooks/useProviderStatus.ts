import { useState, useEffect } from 'react'
import { api, ProvidersStatusResponse } from '../lib/api'

export function useProviderStatus(syncVersion: number) {
  const [status, setStatus] = useState<ProvidersStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.providers
      .status()
      .then(setStatus)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [syncVersion])

  return { status, loading }
}
