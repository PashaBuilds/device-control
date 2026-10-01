export type DeviceKind = 'cpx400dp' | 'e36233a' | 'n5745a' | 'smartlynq'
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
  /** Cihaz kanal izleme (tracking) modunu destekliyor mu (ör. CPX CONFIG 0) */
  hasTracking: boolean
  /**
   * Ayrı bir OCP (aşırı akım koruması) seviyesi girişi var mı. Bazı cihazlarda
   * (ör. Keysight E36200) OCP ayrı seviye değil, akım limitinde tetiklenir —
   * bu durumda ayrı OCP alanı gösterilmez.
   */
  hasOcpLevel: boolean
  /** Ölçüm yoklama aralığı (ms). */
  pollIntervalMs: number
  /**
   * Komut kuyruğu her boşaldığında bir kez gönderilecek komut (yanıt beklenmez).
   * Ön paneli uzaktan kilitleyen cihazlarda paneli serbest bırakmak için
   * (ör. CPX400DP `LOCAL`). Tanımsızsa hiçbir şey gönderilmez.
   */
  idleCommand?: string
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
    defaultPort: 9221,
    hasTracking: true,
    hasOcpLevel: true,
    // Her sorgu ön paneli kilitler: seyrek yokla, kuyruk boşalınca LOCAL gönder
    pollIntervalMs: 10000,
    idleCommand: 'LOCAL'
  },
  {
    kind: 'e36233a',
    category: 'power-supply',
    label: 'Keysight E36233A',
    channelCount: 2,
    maxVoltage: 30,
    maxCurrent: 10,
    maxOvp: 33,
    maxOcp: 11,
    defaultPort: 5025,
    hasTracking: false,
    // E36200 serisinde OCP ayrı seviye değil; akım limitinde tetiklenir
    hasOcpLevel: false,
    pollIntervalMs: 500
  },
  {
    kind: 'n5745a',
    category: 'power-supply',
    label: 'Keysight N5745A',
    channelCount: 1,
    maxVoltage: 30,
    maxCurrent: 25,
    maxOvp: 36,
    maxOcp: 0,
    defaultPort: 5025,
    hasTracking: false,
    // N5700'de OCP ayrı seviye değil, aç/kapat; arayüzde gizli
    hasOcpLevel: false,
    // REMOTE modda ön panel açık kalır (kilit yalnızca RLST RWLock): canlı yokla
    pollIntervalMs: 500
  },
  {
    kind: 'smartlynq',
    category: 'debug-probe',
    label: 'Xilinx Hardware Server',
    channelCount: 0,
    maxVoltage: 0,
    maxCurrent: 0,
    maxOvp: 0,
    maxOcp: 0,
    defaultPort: 3121,
    hasTracking: false,
    hasOcpLevel: false,
    pollIntervalMs: 500
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

/** JTAG zincirindeki tek bir hedef (cihaz). */
export interface JtagTarget {
  name: string
  /** IDCODE (destekleniyorsa), ör. "0x23731093" */
  idCode: string | null
  /** Instruction Register uzunluğu (destekleniyorsa) */
  irLen: number | null
}

/** Debug probu (TCF/hw_server) bağlantısında toplanan bilgiler. */
export interface ProbeInfo {
  /** Karşı tarafın Hello ile bildirdiği TCF servisleri */
  services: string[]
  /** Locator getAgentID yanıtı (destekleniyorsa) */
  agentId: string | null
  /** Jtag servisi üzerinden sıralanabilen hedefler (destekleniyorsa) */
  jtagTargets: JtagTarget[]
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
