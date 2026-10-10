export type DeviceKind = 'cpx400dp' | 'e36233a' | 'n5745a' | 'smartlynq' | 'ssg6000rc' | 'ssg15grc'
export type DeviceCategory = 'power-supply' | 'debug-probe' | 'signal-generator'
/** Cihaza erişim yolu: ağ (IP:port) veya USB (HID). */
export type DeviceTransport = 'tcp' | 'usb'

/** Sinyal üretecinin ayarlanabilir aralıkları (cihaz veri sayfasından). */
export interface RfLimits {
  minFreqHz: number
  maxFreqHz: number
  minPowerDbm: number
  maxPowerDbm: number
  /** Adım düğmeleri / ok tuşları için güç adımı (dB) */
  powerStepDb: number
  /** Cihazın model adı öneki (`:MN?` yanıtı bununla başlar), ör. "SSG-6000" */
  modelPrefix: string
}

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
  /** Erişim yolu; tanımsızsa 'tcp'. */
  transport?: DeviceTransport
  /** Yalnızca signal-generator kategorisinde dolu */
  rf?: RfLimits
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
  },
  {
    kind: 'ssg6000rc',
    category: 'signal-generator',
    label: 'Mini-Circuits SSG-6000RC',
    channelCount: 0,
    maxVoltage: 0,
    maxCurrent: 0,
    maxOvp: 0,
    maxOcp: 0,
    defaultPort: 0,
    hasTracking: false,
    hasOcpLevel: false,
    // Ön paneli olmayan USB cihazı: okuma yalnızca durum doğrulaması ve kopma tespiti için
    pollIntervalMs: 1000,
    transport: 'usb',
    rf: {
      minFreqHz: 25e6,
      maxFreqHz: 6000e6,
      minPowerDbm: -65,
      maxPowerDbm: 14,
      powerStepDb: 0.25,
      modelPrefix: 'SSG-6000'
    }
  },
  {
    kind: 'ssg15grc',
    category: 'signal-generator',
    label: 'Mini-Circuits SSG-15G-RC',
    channelCount: 0,
    maxVoltage: 0,
    maxCurrent: 0,
    maxOvp: 0,
    maxOcp: 0,
    defaultPort: 0,
    hasTracking: false,
    hasOcpLevel: false,
    pollIntervalMs: 1000,
    transport: 'usb',
    rf: {
      minFreqHz: 10e6,
      maxFreqHz: 15000e6,
      minPowerDbm: -45,
      maxPowerDbm: 10,
      powerStepDb: 0.25,
      modelPrefix: 'SSG-15G'
    }
  }
]

export function deviceTypeInfo(kind: DeviceKind): DeviceTypeInfo {
  const info = DEVICE_TYPES.find((t) => t.kind === kind)
  if (!info) throw new Error(`Bilinmeyen cihaz türü: ${kind}`)
  return info
}

export function transportOf(kind: DeviceKind): DeviceTransport {
  return deviceTypeInfo(kind).transport ?? 'tcp'
}

export interface DeviceConfig {
  id: string
  name: string
  kind: DeviceKind
  /** USB cihazlarında kullanılmaz (boş) */
  host: string
  /** USB cihazlarında kullanılmaz (0) */
  port: number
  /**
   * USB cihazının seri numarası (`:SN?`). Boş/tanımsızsa bu türün ilk bulunan
   * cihazına bağlanılır. Yalnızca USB türlerinde anlamlı.
   */
  usbSerial?: string
  /**
   * Yazılımsal ayar kilidi (cihazın fiziksel LOCK anahtarının karşılığı):
   * true iken gerilim/akım/OVP/OCP ve izleme modu değiştirilemez;
   * çıkış aç/kapat ve trip sıfırlama etkilenmez.
   */
  locked?: boolean
}

/** Kenar çubuğu / başlıkta gösterilen adres: "IP:port" veya "USB · SN …". */
export function deviceAddress(cfg: Pick<DeviceConfig, 'kind' | 'host' | 'port' | 'usbSerial'>): string {
  if (transportOf(cfg.kind) === 'usb') {
    return cfg.usbSerial ? `USB · SN ${cfg.usbSerial}` : 'USB · ilk bulunan'
  }
  return `${cfg.host}:${cfg.port}`
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

/** Sinyal üretecinin cihazdan okunan durumu. */
export interface RfState {
  frequencyHz: number
  powerDbm: number
  outputOn: boolean
}

/** Bilgisayara USB ile takılı, tanınan bir Mini-Circuits cihazı. */
export interface UsbDeviceInfo {
  /** İşletim sistemi HID yolu (oturum boyunca geçerli) */
  path: string
  /** USB ürün kimliği (PID) — tanılama için */
  productId: number
  /** `:MN?` yanıtı, ör. "SSG-6000RC"; cihaz SCPI'ye yanıt vermediyse boş */
  model: string
  /** `:SN?` yanıtı */
  serial: string
  /** Modele uyan cihaz türü (tanınmıyorsa null) */
  kind: DeviceKind | null
  /** Bu uygulamada şu an bağlı bir cihaz tarafından kullanılıyor mu */
  inUse: boolean
  /** Tanınamadıysa nedeni (açılamadı / zaman aşımı …) — tanılama için */
  error?: string
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
  /** Yalnızca signal-generator kategorisindeki cihazlarda dolu */
  rf: RfState | null
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
