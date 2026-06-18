import { getDevice } from './device'

function headers(): HeadersInit {
  const device = getDevice()
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (device) h['X-Device-ID'] = device.id
  return h
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: headers(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Request failed')
  }
  return res.json()
}

export interface SongResponse {
  id: string
  title: string
  url: string
  platform: 'youtube' | 'soundcloud' | 'tiktok' | 'other'
  playlist: string
  thumbnail: string
  added_at: string
  downloaded: boolean
}

export interface SongsListResponse {
  songs: SongResponse[]
  playlists: string[]
}

export interface ProviderStatusItem {
  configured: boolean
  reachable: boolean
  error: string | null
}

export interface ProvidersStatusResponse {
  youtube: ProviderStatusItem
  soundcloud: ProviderStatusItem
}

export const api = {
  auth: {
    verify: (code: string) => req<{ ok: boolean }>('POST', '/api/auth/verify', { code }),
  },
  devices: {
    register: (name: string) => req<{ id: string; name: string }>('POST', '/api/devices/register', { name }),
    clearHistory: (deviceId: string) => req<{ ok: boolean }>('DELETE', `/api/devices/${deviceId}/history`),
  },
  songs: {
    list: () => req<SongsListResponse>('GET', '/api/songs'),
    add: (url: string, playlist?: string) => req<SongResponse>('POST', '/api/songs', { url, playlist }),
    delete: (id: string) => req<{ ok: boolean }>('DELETE', `/api/songs/${id}`),
  },
  sync: {
    trigger: () => req<{ message: string }>('POST', '/api/sync'),
    status: () => req<{ running: boolean; added: number; total: number; error: string | null }>('GET', '/api/sync/status'),
  },
  download: {
    prepare: (songId: string) => req<{ status: 'downloading' | 'ready' }>('POST', `/api/download/${songId}/prepare`),
    url: (songId: string) => {
      const device = getDevice()
      return `/api/download/${songId}?device_id=${device?.id ?? ''}`
    },
  },
  providers: {
    status: () => req<ProvidersStatusResponse>('GET', '/api/status/providers'),
  },
}
