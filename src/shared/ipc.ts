import type { DeviceConfig, DeviceSnapshot, ScpiLogEntry } from './types'

/** Renderer'a preload üzerinden açılan köprünün tam sözleşmesi. */
export interface DeviceApi {
  listDevices(): Promise<DeviceConfig[]>
  addDevice(cfg: Omit<DeviceConfig, 'id'>): Promise<DeviceConfig>
  updateDevice(cfg: DeviceConfig): Promise<void>
  removeDevice(id: string): Promise<void>
  connect(id: string): Promise<void>
  disconnect(id: string): Promise<void>
  setVoltage(id: string, ch: number, volts: number): Promise<void>
  setCurrent(id: string, ch: number, amps: number): Promise<void>
  setOvp(id: string, ch: number, volts: number): Promise<void>
  setOcp(id: string, ch: number, amps: number): Promise<void>
  setOutput(id: string, ch: number, on: boolean): Promise<void>
  setAllOutputs(id: string, on: boolean): Promise<void>
  setTracking(id: string, on: boolean): Promise<void>
  tripReset(id: string): Promise<void>
  sendRaw(id: string, command: string): Promise<string | null>
  onSnapshot(cb: (s: DeviceSnapshot) => void): () => void
  onLog(cb: (e: ScpiLogEntry) => void): () => void
}

/** invoke kanalları: `dc:<metod>`; event kanalları aşağıda. */
export const IPC_INVOKE_METHODS = [
  'listDevices',
  'addDevice',
  'updateDevice',
  'removeDevice',
  'connect',
  'disconnect',
  'setVoltage',
  'setCurrent',
  'setOvp',
  'setOcp',
  'setOutput',
  'setAllOutputs',
  'setTracking',
  'tripReset',
  'sendRaw'
] as const

export type IpcInvokeMethod = (typeof IPC_INVOKE_METHODS)[number]

export const IPC_CHANNEL = {
  invoke: (m: IpcInvokeMethod): string => `dc:${m}`,
  snapshot: 'dc:snapshot',
  log: 'dc:log'
} as const
