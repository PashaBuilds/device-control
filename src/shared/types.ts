export type DeviceKind = 'cpx400dp' | 'smartlynq'
export type DeviceCategory = 'power-supply' | 'debug-probe'

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
  },
  {
    kind: 'smartlynq',
    category: 'debug-probe',
    label: 'Xilinx SmartLynq (hw_server)',
    channelCount: 0,
    maxVoltage: 0,
    maxCurrent: 0,
    maxOvp: 0,
    maxOcp: 0,
    defaultPort: 3121
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
  /**
   * Yazılımsal ayar kilidi (cihazın fiziksel LOCK anahtarının karşılığı):
   * true iken gerilim/akım/OVP/OCP ve izleme modu değiştirilemez;
   * çıkış aç/kapat ve trip sıfırlama etkilenmez.
   */
  locked?: boolean
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

/** Debug probu (TCF/hw_server) bağlantısında toplanan bilgiler. */
export interface ProbeInfo {
  /** Karşı tarafın Hello ile bildirdiği TCF servisleri */
  services: string[]
  /** Locator getAgentID yanıtı (destekleniyorsa) */
  agentId: string | null
  /** Jtag servisi üzerinden sıralanabilen hedefler (destekleniyorsa) */
  jtagTargets: string[]
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
  /** Yalnızca debug-probe kategorisindeki cihazlarda dolu */
  probe: ProbeInfo | null
  timestamp: number
}

/** Trafiğin kaynağı: kullanıcı eylemi mi, arka plan yoklaması mı. */
export type LogSource = 'user' | 'poll'

export interface ScpiLogEntry {
  deviceId: string
  dir: 'tx' | 'rx'
  line: string
  source: LogSource
  timestamp: number
}
