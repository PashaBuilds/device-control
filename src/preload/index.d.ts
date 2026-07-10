import type { DeviceApi } from '@shared/ipc'
import type { DeviceSnapshot } from '@shared/types'

declare global {
  interface Window {
    deviceApi: DeviceApi & { listSnapshots(): Promise<DeviceSnapshot[]> }
  }
}

export {}
