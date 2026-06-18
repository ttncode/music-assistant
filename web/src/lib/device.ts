const KEY = 'ma_device'

export interface DeviceInfo {
  id: string
  name: string
}

export function getDevice(): DeviceInfo | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function setDevice(id: string, name: string): void {
  localStorage.setItem(KEY, JSON.stringify({ id, name }))
}

export function clearDevice(): void {
  localStorage.removeItem(KEY)
}
