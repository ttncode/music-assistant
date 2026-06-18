import { useState, useCallback } from 'react'
import { getDevice, setDevice as storeDevice, clearDevice } from '../lib/device'
import { api } from '../lib/api'

export function useDevice() {
  const [device, setDeviceState] = useState(getDevice)

  const register = useCallback(async (name: string) => {
    const result = await api.devices.register(name)
    storeDevice(result.id, result.name)
    setDeviceState({ id: result.id, name: result.name })
    return result
  }, [])

  const clear = useCallback(() => {
    clearDevice()
    setDeviceState(null)
  }, [])

  return {
    deviceId: device?.id ?? null,
    deviceName: device?.name ?? null,
    isRegistered: device !== null,
    register,
    clear,
  }
}
