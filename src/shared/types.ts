export type DeviceKind = 'cpx400dp'
export type DeviceCategory = 'power-supply'

export interface DeviceTypeInfo {
  kind: DeviceKind
  category: DeviceCategory
  label: string
  channelCount: number
  maxVoltage: number
  maxCurrent: number
  maxOvp: number
  maxOcp: number
  defaultPort: number
}

export const DEVICE_TYPES: DeviceTypeInfo[] = [
  {
    kind: 'cpx400dp',
    category: 'power-supply',
    label: 'Aim-TTi CPX400DP',
    channelCount: 2,
    maxVoltage: 60,
    maxCurrent: 20,
    maxOvp: 66,
    maxOcp: 22,
    defaultPort: 9221
  }
]

export function deviceTypeInfo(kind: DeviceKind): DeviceTypeInfo {
  const info = DEVICE_TYPES.find((t) => t.kind === kind)
  if (!info) throw new Error(`Bilinmeyen cihaz türü: ${kind}`)
  return info
}

export interface DeviceConfig {
  id: string
  name: string
  kind: DeviceKind
  host: string
  port: number
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export type RegulationMode = 'cv' | 'cc' | 'off'

export interface ChannelMeasurement {
  voltage: number
  current: number
  power: number
  outputOn: boolean
  mode: RegulationMode
}

export interface ChannelSetpoints {
  voltage: number
  current: number
  ovp: number
  ocp: number
}

export interface TripInfo {
  channel: number
  kind: 'ovp' | 'ocp' | 'other'
}

export interface DeviceSnapshot {
  id: string
  state: ConnectionState
  identity: string | null
  error: string | null
  channels: ChannelMeasurement[]
  setpoints: ChannelSetpoints[]
  tracking: boolean
  trips: TripInfo[]
  timestamp: number
}

export interface ScpiLogEntry {
  deviceId: string
  dir: 'tx' | 'rx'
  line: string
  timestamp: number
}
