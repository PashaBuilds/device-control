import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type {
  ChannelMeasurement,
  ChannelSetpoints,
  ConnectionState,
  DeviceConfig,
  DeviceKind,
  DeviceSnapshot,
  ProbeInfo,
  RfState,
  TripInfo,
  UsbDeviceInfo
} from '@shared/types'
import { deviceTypeInfo } from '@shared/types'
import { ScpiConnection } from './scpi/connection'
import { TcfConnection } from './tcf/connection'
import { createDriver } from './drivers/cpx400dp'
import { SmartLynqDriver } from './drivers/smartlynq'
import type { PsuDriver } from './drivers/types'
import { SsgDriver } from './drivers/ssg'
import { HidMclConnection } from './hid/connection'
import { createNodeHidBackend, discoverMclDevices, type HidBackend } from './hid/mcl'
import { diagnoseMcl } from './hid/diagnostics'
import { Store } from './store'

const LSR_OVP = 0b0100
const LSR_OCP = 0b1000

export interface DeviceManagerOptions {
  dataDir: string
  /** Ölçüm yoklama aralığı (ms). Verilirse tüm türler için cihaz türü değerini geçersiz kılar (testler için). */
  pollIntervalMs?: number
  /** USB (HID) erişimi; verilmezse node-hid kullanılır (testlerde sahte arka uç). */
  hidBackend?: HidBackend
  /** Tanılama raporunda gösterilen uygulama sürümü */
  appVersion?: string
}

/** Yoklama aralığı: geçersiz kılma verilmişse o, yoksa cihaz türünün değeri. */
export function pollIntervalFor(kind: DeviceKind, override?: number): number {
  return override ?? deviceTypeInfo(kind).pollIntervalMs
}

interface ManagedDevice {
  config: DeviceConfig
  conn: ScpiConnection | null
  driver: PsuDriver | null
  /** Yoklama trafiği için 'poll' etiketli sürücü (aynı bağlantı) */
  pollDriver: PsuDriver | null
  tcf: TcfConnection | null
  probeDriver: SmartLynqDriver | null
  /** Sinyal üreteci (USB/HID) bağlantısı ve sürücüleri */
  hid: HidMclConnection | null
  sgDriver: SsgDriver | null
  sgPollDriver: SsgDriver | null
  /** Bağlı USB cihazının tanımı (listUsbDevices'ta "kullanımda" göstermek için) */
  usbInfo: UsbDeviceInfo | null
  rf: RfState | null
  state: ConnectionState
  identity: string | null
  error: string | null
  channels: ChannelMeasurement[]
  setpoints: ChannelSetpoints[]
  tracking: boolean
  trips: TripInfo[]
  probe: ProbeInfo | null
  pollTimer: NodeJS.Timeout | null
  pollBusy: boolean
  pollCount: number
  reconnectTimer: NodeJS.Timeout | null
  reconnectDelayMs: number
  userDisconnected: boolean
}

function emptyChannel(): ChannelMeasurement {
  return { voltage: 0, current: 0, power: 0, outputOn: false, mode: 'off' }
}

function emptyRf(): RfState {
  return { frequencyHz: 0, powerDbm: 0, outputOn: false, locked: null, unleveled: null }
}

function emptySetpoints(): ChannelSetpoints {
  return { voltage: 0, current: 0, ovp: 0, ocp: 0 }
}

/**
 * Tüm cihazların yaşam döngüsünü yönetir: kalıcılık, bağlantı, yoklama,
 * otomatik yeniden bağlanma. Olaylar: 'snapshot' (DeviceSnapshot),
 * 'log' (ScpiLogEntry).
 */
export class DeviceManager extends EventEmitter {
  private readonly store: Store
  private readonly pollIntervalOverride: number | undefined
  private readonly devices = new Map<string, ManagedDevice>()
  private disposed = false
  private hidBackendInstance: HidBackend | null
  private readonly appVersion: string

  constructor(opts: DeviceManagerOptions) {
    super()
    this.store = new Store(opts.dataDir)
    this.pollIntervalOverride = opts.pollIntervalMs
    this.hidBackendInstance = opts.hidBackend ?? null
    this.appVersion = opts.appVersion ?? ''
    for (const config of this.store.load()) {
      this.devices.set(config.id, this.createManaged(config))
    }
  }

  private createManaged(config: DeviceConfig): ManagedDevice {
    const info = deviceTypeInfo(config.kind)
    return {
      config,
      conn: null,
      driver: null,
      pollDriver: null,
      tcf: null,
      probeDriver: null,
      hid: null,
      sgDriver: null,
      sgPollDriver: null,
      usbInfo: null,
      rf: info.category === 'signal-generator' ? emptyRf() : null,
      state: 'disconnected',
      identity: null,
      error: null,
      channels: Array.from({ length: info.channelCount }, emptyChannel),
      setpoints: Array.from({ length: info.channelCount }, emptySetpoints),
      tracking: false,
      trips: [],
      probe: null,
      pollTimer: null,
      pollBusy: false,
      pollCount: 0,
      reconnectTimer: null,
      reconnectDelayMs: 1000,
      userDisconnected: false
    }
  }

  private get(id: string): ManagedDevice {
    const dev = this.devices.get(id)
    if (!dev) throw new Error(`Cihaz bulunamadı: ${id}`)
    return dev
  }

  private isProbe(dev: ManagedDevice): boolean {
    return deviceTypeInfo(dev.config.kind).category === 'debug-probe'
  }

  private isSigGen(dev: ManagedDevice): boolean {
    return deviceTypeInfo(dev.config.kind).category === 'signal-generator'
  }

  private get hidBackend(): HidBackend {
    this.hidBackendInstance ??= createNodeHidBackend()
    return this.hidBackendInstance
  }

  private requireDriver(id: string): { dev: ManagedDevice; driver: PsuDriver } {
    const dev = this.get(id)
    if (deviceTypeInfo(dev.config.kind).category !== 'power-supply') {
      throw new Error('Bu komut bu cihaz türünde desteklenmiyor')
    }
    if (!dev.driver || !dev.conn?.connected) throw new Error('Cihaz bağlı değil')
    return { dev, driver: dev.driver }
  }

  /** Ayar kilidi etkinken setpoint değiştiren komutları engeller. */
  private requireUnlocked(id: string): { dev: ManagedDevice; driver: PsuDriver } {
    const res = this.requireDriver(id)
    if (res.dev.config.locked) {
      throw new Error('Ayar kilidi etkin — değerleri değiştirmek için kilidi açın')
    }
    return res
  }

  /** Sinyal üreteci komutları için; `setting` true ise ayar kilidi de denetlenir. */
  private requireSigGen(id: string, setting: boolean): { dev: ManagedDevice; driver: SsgDriver } {
    const dev = this.get(id)
    if (!this.isSigGen(dev)) throw new Error('Bu komut bu cihaz türünde desteklenmiyor')
    if (!dev.sgDriver || !dev.hid?.connected) throw new Error('Cihaz bağlı değil')
    if (setting && dev.config.locked) {
      throw new Error('Ayar kilidi etkin — değerleri değiştirmek için kilidi açın')
    }
    return { dev, driver: dev.sgDriver }
  }

  private persist(): void {
    this.store.save([...this.devices.values()].map((d) => d.config))
  }

  private snapshot(dev: ManagedDevice): DeviceSnapshot {
    return {
      id: dev.config.id,
      state: dev.state,
      identity: dev.identity,
      error: dev.error,
      channels: dev.channels.map((c) => ({ ...c })),
      setpoints: dev.setpoints.map((s) => ({ ...s })),
      tracking: dev.tracking,
      trips: dev.trips.map((t) => ({ ...t })),
      probe: dev.probe
        ? {
            ...dev.probe,
            services: [...dev.probe.services],
            jtagTargets: dev.probe.jtagTargets.map((t) => ({ ...t }))
          }
        : null,
      rf: dev.rf ? { ...dev.rf } : null,
      timestamp: Date.now()
    }
  }

  private publish(dev: ManagedDevice): void {
    this.emit('snapshot', this.snapshot(dev))
  }

  // ---- DeviceApi yüzeyi ----

  async listDevices(): Promise<DeviceConfig[]> {
    return [...this.devices.values()].map((d) => ({ ...d.config }))
  }

  /** Bağlantı kurmadan mevcut durum görüntülerini döndürür (UI ilk yükleme için). */
  async listSnapshots(): Promise<DeviceSnapshot[]> {
    return [...this.devices.values()].map((d) => this.snapshot(d))
  }

  async addDevice(cfg: Omit<DeviceConfig, 'id'>): Promise<DeviceConfig> {
    deviceTypeInfo(cfg.kind) // tür doğrulaması
    const config: DeviceConfig = { ...cfg, id: randomUUID() }
    this.devices.set(config.id, this.createManaged(config))
    this.persist()
    this.publish(this.get(config.id))
    return { ...config }
  }

  async updateDevice(cfg: DeviceConfig): Promise<void> {
    const dev = this.get(cfg.id)
    const addressChanged =
      dev.config.host !== cfg.host ||
      dev.config.port !== cfg.port ||
      (dev.config.usbSerial ?? '') !== (cfg.usbSerial ?? '')
    dev.config = { ...cfg }
    this.persist()
    if (addressChanged && dev.state !== 'disconnected') {
      await this.disconnect(cfg.id)
    }
    this.publish(dev)
  }

  async removeDevice(id: string): Promise<void> {
    await this.disconnect(id).catch(() => undefined)
    this.devices.delete(id)
    this.persist()
  }

  async connect(id: string): Promise<void> {
    const dev = this.get(id)
    dev.userDisconnected = false
    if (dev.reconnectTimer) {
      clearTimeout(dev.reconnectTimer)
      dev.reconnectTimer = null
    }
    await this.establish(dev, 'connecting')
  }

  private async establish(dev: ManagedDevice, phase: 'connecting' | 'reconnecting'): Promise<void> {
    if (this.isProbe(dev)) return this.establishProbe(dev, phase)
    if (this.isSigGen(dev)) return this.establishSigGen(dev, phase)
    if (dev.conn) {
      dev.conn.removeAllListeners()
      dev.conn.disconnect()
      dev.conn = null
      dev.driver = null
      dev.pollDriver = null
    }
    dev.state = phase
    dev.error = null
    this.publish(dev)

    const conn = new ScpiConnection(dev.config.host, dev.config.port, {
      idleCommand: deviceTypeInfo(dev.config.kind).idleCommand
    })
    try {
      await conn.connect()
    } catch (err) {
      dev.error = `Bağlantı kurulamadı: ${(err as Error).message}`
      if (phase === 'reconnecting') {
        this.scheduleReconnect(dev)
      } else {
        dev.state = 'error'
        this.publish(dev)
      }
      throw err instanceof Error ? err : new Error(String(err))
    }

    dev.conn = conn
    dev.driver = createDriver(dev.config.kind, conn)
    dev.pollDriver = createDriver(dev.config.kind, conn, 'poll')
    conn.on('log', (e: { dir: 'tx' | 'rx'; line: string; source: 'user' | 'poll' }) =>
      this.emit('log', {
        deviceId: dev.config.id,
        dir: e.dir,
        line: e.line,
        source: e.source,
        timestamp: Date.now()
      })
    )
    conn.on('close', () => {
      if (dev.userDisconnected || this.disposed) return
      this.stopPolling(dev)
      dev.conn = null
      dev.driver = null
      dev.pollDriver = null
      dev.error = 'Bağlantı koptu'
      this.scheduleReconnect(dev)
    })

    try {
      dev.identity = await dev.driver.identify()
      await this.refreshSetpoints(dev)
      dev.tracking = await dev.driver.readTracking()
    } catch (err) {
      dev.error = `Cihaz yanıt vermiyor: ${(err as Error).message}`
      dev.state = 'error'
      conn.disconnect()
      dev.conn = null
      dev.driver = null
      this.publish(dev)
      throw err instanceof Error ? err : new Error(String(err))
    }

    dev.state = 'connected'
    dev.error = null
    dev.reconnectDelayMs = 1000
    this.publish(dev)
    this.startPolling(dev)
  }

  /** Debug probu (TCF/hw_server) bağlantı akışı. */
  private async establishProbe(dev: ManagedDevice, phase: 'connecting' | 'reconnecting'): Promise<void> {
    if (dev.tcf) {
      dev.tcf.removeAllListeners()
      dev.tcf.disconnect()
      dev.tcf = null
      dev.probeDriver = null
    }
    dev.state = phase
    dev.error = null
    this.publish(dev)

    const tcf = new TcfConnection(dev.config.host, dev.config.port)
    tcf.on('log', (e: { dir: 'tx' | 'rx'; line: string; source: 'user' | 'poll' }) =>
      this.emit('log', {
        deviceId: dev.config.id,
        dir: e.dir,
        line: e.line,
        source: e.source,
        timestamp: Date.now()
      })
    )
    try {
      await tcf.connect()
    } catch (err) {
      tcf.removeAllListeners()
      dev.error = `Bağlantı kurulamadı: ${(err as Error).message}`
      if (phase === 'reconnecting') {
        this.scheduleReconnect(dev)
      } else {
        dev.state = 'error'
        this.publish(dev)
      }
      throw err instanceof Error ? err : new Error(String(err))
    }

    dev.tcf = tcf
    dev.probeDriver = new SmartLynqDriver(tcf)
    tcf.on('close', () => {
      if (dev.userDisconnected || this.disposed) return
      this.stopPolling(dev)
      dev.tcf = null
      dev.probeDriver = null
      dev.error = 'Bağlantı koptu'
      this.scheduleReconnect(dev)
    })

    try {
      dev.probe = await dev.probeDriver.gatherInfo()
      dev.identity = `Xilinx Hardware Server (hw_server)${dev.probe.agentId ? ` — ${dev.probe.agentId}` : ''}`
    } catch (err) {
      dev.error = `Cihaz yanıt vermiyor: ${(err as Error).message}`
      dev.state = 'error'
      tcf.removeAllListeners()
      tcf.disconnect()
      dev.tcf = null
      dev.probeDriver = null
      this.publish(dev)
      throw err instanceof Error ? err : new Error(String(err))
    }

    dev.state = 'connected'
    dev.error = null
    dev.reconnectDelayMs = 1000
    this.publish(dev)
    this.startPolling(dev)
  }

  /** Sinyal üreteci (Mini-Circuits USB/HID) bağlantı akışı. */
  private async establishSigGen(dev: ManagedDevice, phase: 'connecting' | 'reconnecting'): Promise<void> {
    this.closeHid(dev)
    dev.state = phase
    dev.error = null
    this.publish(dev)

    // USB cihazı bulunamaz / açılamaz / yanıt vermezse (kablo çıkık, güç yok, açılıyor)
    // vazgeçilmez: hata gösterilir ve arka planda aranmaya devam edilir; cihaz gelince
    // kendiliğinden bağlanır. "Bağlantıyı Kes" aramayı durdurur.
    const fail = (message: string, err: unknown): never => {
      dev.error = `${message} — cihaz gelince otomatik bağlanılacak`
      this.scheduleReconnect(dev)
      throw err instanceof Error ? err : new Error(String(err))
    }

    const info = deviceTypeInfo(dev.config.kind)
    const wanted = dev.config.usbSerial?.trim() ?? ''
    let target: UsbDeviceInfo | undefined
    let unrecognized: UsbDeviceInfo[] = []
    try {
      const found = await discoverMclDevices(this.hidBackend, this.usbInUse(dev))
      target = found.find(
        (d) => !d.inUse && d.kind === dev.config.kind && (!wanted || d.serial === wanted)
      )
      unrecognized = found.filter((d) => !d.model)
    } catch (err) {
      return fail(`USB cihazları taranamadı: ${(err as Error).message}`, err)
    }
    if (!target) {
      const what = wanted ? `${info.label} (SN ${wanted})` : info.label
      const why =
        unrecognized.length > 0
          ? ` — ${unrecognized.length} Mini-Circuits cihazı görünüyor ama yanıt vermedi (${unrecognized[0].error ?? '?'}). Cihaz ekle penceresindeki "Tanılama raporu"na bakın.`
          : ' — kablo takılı ve cihaz açık mı?'
      const msg = `USB'de ${what} bulunamadı${why}`
      return fail(msg, new Error(msg))
    }

    const conn = new HidMclConnection(this.hidBackend, target.path)
    try {
      await conn.connect()
    } catch (err) {
      return fail(`USB cihazı açılamadı: ${(err as Error).message}`, err)
    }
    dev.hid = conn
    dev.usbInfo = target
    dev.sgDriver = new SsgDriver(conn, info.rf!.usbSeries)
    dev.sgPollDriver = new SsgDriver(conn, info.rf!.usbSeries, 'poll')
    conn.on('log', (e: { dir: 'tx' | 'rx'; line: string; source: 'user' | 'poll' }) =>
      this.emit('log', {
        deviceId: dev.config.id,
        dir: e.dir,
        line: e.line,
        source: e.source,
        timestamp: Date.now()
      })
    )
    conn.on('close', () => {
      if (dev.userDisconnected || this.disposed) return
      this.stopPolling(dev)
      this.closeHid(dev)
      dev.error = 'USB bağlantısı koptu'
      this.scheduleReconnect(dev)
    })

    try {
      dev.identity = (await dev.sgDriver.identify()).identity
      dev.rf = await dev.sgDriver.readState()
    } catch (err) {
      this.closeHid(dev)
      return fail(`Cihaz yanıt vermiyor: ${(err as Error).message}`, err)
    }

    dev.state = 'connected'
    dev.error = null
    dev.reconnectDelayMs = 1000
    this.publish(dev)
    this.startPolling(dev)
  }

  private closeHid(dev: ManagedDevice): void {
    if (dev.hid) {
      dev.hid.removeAllListeners()
      dev.hid.disconnect()
    }
    dev.hid = null
    dev.sgDriver = null
    dev.sgPollDriver = null
    dev.usbInfo = null
  }

  /** Diğer cihazların açık tuttuğu USB yolları (taramada açılmasınlar). */
  private usbInUse(except?: ManagedDevice): Map<string, UsbDeviceInfo> {
    const map = new Map<string, UsbDeviceInfo>()
    for (const d of this.devices.values()) {
      if (d !== except && d.hid && d.usbInfo) map.set(d.usbInfo.path, d.usbInfo)
    }
    return map
  }

  private scheduleReconnect(dev: ManagedDevice): void {
    if (this.disposed || dev.userDisconnected) return
    dev.state = 'reconnecting'
    this.publish(dev)
    dev.reconnectTimer = setTimeout(() => {
      dev.reconnectTimer = null
      this.establish(dev, 'reconnecting').catch(() => undefined)
    }, dev.reconnectDelayMs)
    // USB'de yeniden arama ucuzdur ve kullanıcı cihazı takınca hemen görmek ister
    const maxDelayMs = this.isSigGen(dev) ? 3000 : 15000
    dev.reconnectDelayMs = Math.min(dev.reconnectDelayMs * 2, maxDelayMs)
  }

  async disconnect(id: string): Promise<void> {
    const dev = this.get(id)
    dev.userDisconnected = true
    if (dev.reconnectTimer) {
      clearTimeout(dev.reconnectTimer)
      dev.reconnectTimer = null
    }
    this.stopPolling(dev)
    if (dev.conn) {
      dev.conn.removeAllListeners()
      dev.conn.disconnect()
      dev.conn = null
      dev.driver = null
      dev.pollDriver = null
    }
    if (dev.tcf) {
      dev.tcf.removeAllListeners()
      dev.tcf.disconnect()
      dev.tcf = null
      dev.probeDriver = null
    }
    this.closeHid(dev)
    dev.state = 'disconnected'
    dev.channels = dev.channels.map(() => emptyChannel())
    dev.error = null
    this.publish(dev)
  }

  // ---- Yoklama ----

  private startPolling(dev: ManagedDevice): void {
    this.stopPolling(dev)
    dev.pollCount = 0
    const intervalMs = pollIntervalFor(dev.config.kind, this.pollIntervalOverride)
    dev.pollTimer = setInterval(() => void this.poll(dev), intervalMs)
    // İlk ölçüm aralığı beklemeden gelsin (10 s'lik türlerde önemli)
    void this.poll(dev)
  }

  private stopPolling(dev: ManagedDevice): void {
    if (dev.pollTimer) {
      clearInterval(dev.pollTimer)
      dev.pollTimer = null
    }
    dev.pollBusy = false
  }

  private async poll(dev: ManagedDevice): Promise<void> {
    if (this.isProbe(dev)) return this.pollProbe(dev)
    if (this.isSigGen(dev)) return this.pollSigGen(dev)
    if (dev.pollBusy || !dev.pollDriver || !dev.conn?.connected) return
    dev.pollBusy = true
    try {
      const driver = dev.pollDriver
      for (let ch = 1; ch <= driver.channelCount; ch++) {
        const m = await driver.readChannel(ch)
        const sp = dev.setpoints[ch - 1]
        const mode = !m.outputOn
          ? 'off'
          : sp.current > 0 && m.current >= sp.current * 0.98
            ? 'cc'
            : 'cv'
        dev.channels[ch - 1] = {
          voltage: m.voltage,
          current: m.current,
          power: m.voltage * m.current,
          outputOn: m.outputOn,
          mode
        }
      }
      // Trip ve tracking denetimi: hızlı yoklayan türlerde her 4. turda (≈2 s),
      // ≥2 s aralıklı türlerde (CPX 10 s) her turda
      const intervalMs = pollIntervalFor(dev.config.kind, this.pollIntervalOverride)
      const checkEvery = intervalMs >= 2000 ? 1 : 4
      if (dev.pollCount % checkEvery === 0) {
        for (let ch = 1; ch <= driver.channelCount; ch++) {
          const lsr = await driver.readLsr(ch)
          if (lsr & LSR_OVP) this.addTrip(dev, ch, 'ovp')
          if (lsr & LSR_OCP) this.addTrip(dev, ch, 'ocp')
        }
        dev.tracking = await driver.readTracking()
      }
      dev.pollCount++
      this.publish(dev)
    } catch {
      if (dev.conn && dev.conn.consecutiveTimeouts >= 3) {
        // Bağlantı sorunlu: soketi kapat, yeniden bağlanma close olayı ile tetiklenir
        dev.conn.disconnect()
        if (!dev.userDisconnected) {
          this.stopPolling(dev)
          dev.conn = null
          dev.driver = null
          dev.pollDriver = null
          dev.error = 'Cihaz yanıt vermiyor'
          this.scheduleReconnect(dev)
        }
      }
    } finally {
      dev.pollBusy = false
    }
  }

  /** Sinyal üreteci: durum okuması (ön paneli yok; değişikliği yalnız bu uygulama yapar). */
  private async pollSigGen(dev: ManagedDevice): Promise<void> {
    if (dev.pollBusy || !dev.sgPollDriver || !dev.hid?.connected) return
    dev.pollBusy = true
    try {
      dev.rf = await dev.sgPollDriver.readState()
      dev.pollCount++
      this.publish(dev)
    } catch {
      if (dev.hid && dev.hid.consecutiveTimeouts >= 3 && !dev.userDisconnected) {
        this.stopPolling(dev)
        this.closeHid(dev)
        dev.error = 'Cihaz yanıt vermiyor'
        this.scheduleReconnect(dev)
      }
    } finally {
      dev.pollBusy = false
    }
  }

  /** Probe canlılık denetimi: her 4. döngüde (≈2 sn) Locator sync. */
  private async pollProbe(dev: ManagedDevice): Promise<void> {
    if (dev.pollBusy || !dev.probeDriver || !dev.tcf?.connected) return
    dev.pollCount++
    if (dev.pollCount % 30 !== 0) return
    dev.pollBusy = true
    try {
      await dev.probeDriver.ping()
      dev.error = null
    } catch {
      const tcf = dev.tcf
      if (tcf) {
        tcf.removeAllListeners()
        tcf.disconnect()
      }
      dev.tcf = null
      dev.probeDriver = null
      if (!dev.userDisconnected) {
        this.stopPolling(dev)
        dev.error = 'Cihaz yanıt vermiyor'
        this.scheduleReconnect(dev)
      }
    } finally {
      dev.pollBusy = false
    }
  }

  private addTrip(dev: ManagedDevice, channel: number, kind: TripInfo['kind']): void {
    if (!dev.trips.some((t) => t.channel === channel && t.kind === kind)) {
      dev.trips.push({ channel, kind })
    }
  }

  private async refreshSetpoints(dev: ManagedDevice, onlyChannel?: number): Promise<void> {
    if (!dev.driver) return
    for (let ch = 1; ch <= dev.driver.channelCount; ch++) {
      if (onlyChannel && ch !== onlyChannel) continue
      dev.setpoints[ch - 1] = await dev.driver.readSetpoints(ch)
    }
  }

  /** Set komutu sonrası cihaz tarafı hata denetimi + setpoint doğrulaması. */
  private async afterSet(dev: ManagedDevice, ch?: number): Promise<void> {
    if (!dev.driver) return
    const eer = await dev.driver.readExecutionError()
    await this.refreshSetpoints(dev, ch)
    this.publish(dev)
    if (eer > 0) {
      throw new Error(`Cihaz komutu reddetti (EER ${eer}) — değer aralık dışında olabilir`)
    }
  }

  // ---- Kontrol komutları ----

  /** Kullanıcı isteğiyle anında bir yoklama turu (bağlı değilse veya meşgulse sessizce döner). */
  async refresh(id: string): Promise<void> {
    const dev = this.get(id)
    if (this.isProbe(dev)) return
    await this.poll(dev)
  }

  async setVoltage(id: string, ch: number, volts: number): Promise<void> {
    const { dev, driver } = this.requireUnlocked(id)
    await driver.setVoltage(ch, volts)
    await this.afterSet(dev, ch)
  }

  async setCurrent(id: string, ch: number, amps: number): Promise<void> {
    const { dev, driver } = this.requireUnlocked(id)
    await driver.setCurrent(ch, amps)
    await this.afterSet(dev, ch)
  }

  async setOvp(id: string, ch: number, volts: number): Promise<void> {
    const { dev, driver } = this.requireUnlocked(id)
    await driver.setOvp(ch, volts)
    await this.afterSet(dev, ch)
  }

  async setOcp(id: string, ch: number, amps: number): Promise<void> {
    const { dev, driver } = this.requireUnlocked(id)
    await driver.setOcp(ch, amps)
    await this.afterSet(dev, ch)
  }

  async setOutput(id: string, ch: number, on: boolean): Promise<void> {
    const { dev, driver } = this.requireDriver(id)
    await driver.setOutput(ch, on)
    await this.afterSet(dev, ch)
    await this.poll(dev)
  }

  async setAllOutputs(id: string, on: boolean): Promise<void> {
    const { dev, driver } = this.requireDriver(id)
    await driver.setAllOutputs(on)
    await this.afterSet(dev)
    await this.poll(dev)
  }

  async setTracking(id: string, on: boolean): Promise<void> {
    const { dev, driver } = this.requireUnlocked(id)
    await driver.setTracking(on)
    dev.tracking = await driver.readTracking()
    this.publish(dev)
  }

  async tripReset(id: string): Promise<void> {
    const { dev, driver } = this.requireDriver(id)
    await driver.tripReset()
    // Mandallanmış bitleri de boşalt
    for (let ch = 1; ch <= driver.channelCount; ch++) await driver.readLsr(ch)
    dev.trips = []
    this.publish(dev)
  }

  async setFrequency(id: string, hz: number): Promise<void> {
    const { dev, driver } = this.requireSigGen(id, true)
    const rf = deviceTypeInfo(dev.config.kind).rf!
    if (!(hz >= rf.minFreqHz && hz <= rf.maxFreqHz)) {
      throw new Error(`Frekans ${rf.minFreqHz / 1e6}–${rf.maxFreqHz / 1e6} MHz aralığında olmalı`)
    }
    try {
      await driver.setFrequency(hz)
    } finally {
      await this.refreshRf(dev)
    }
  }

  async setPower(id: string, dbm: number): Promise<void> {
    const { dev, driver } = this.requireSigGen(id, true)
    const rf = deviceTypeInfo(dev.config.kind).rf!
    if (!(dbm >= rf.minPowerDbm && dbm <= rf.maxPowerDbm)) {
      throw new Error(`Güç ${rf.minPowerDbm}–${rf.maxPowerDbm} dBm aralığında olmalı`)
    }
    try {
      await driver.setPower(dbm)
    } finally {
      await this.refreshRf(dev)
    }
  }

  async setRfOutput(id: string, on: boolean): Promise<void> {
    const { dev, driver } = this.requireSigGen(id, false)
    try {
      await driver.setRfOutput(on)
    } finally {
      await this.refreshRf(dev)
    }
  }

  /** Set sonrası cihazdan geri okuyup yayınlar (okuma hatası set hatasını gölgelemesin). */
  private async refreshRf(dev: ManagedDevice): Promise<void> {
    if (!dev.sgDriver) return
    try {
      dev.rf = await dev.sgDriver.readState()
    } catch {
      // bir sonraki yoklamada tazelenir
    }
    this.publish(dev)
  }

  async listUsbDevices(): Promise<UsbDeviceInfo[]> {
    return discoverMclDevices(this.hidBackend, this.usbInUse())
  }

  async usbDiagnostics(): Promise<string> {
    const head = [
      `Cihaz Kontrol ${this.appVersion}`.trim(),
      `Platform: ${process.platform} ${process.arch}, ${new Date().toISOString()}`
    ]
    return [...head, await diagnoseMcl(this.hidBackend, this.usbInUse())].join('\n')
  }

  async sendRaw(id: string, command: string): Promise<string | null> {
    const dev = this.get(id)
    if (this.isSigGen(dev)) {
      if (!dev.sgDriver || !dev.hid?.connected) throw new Error('Cihaz bağlı değil')
      const reply = await dev.sgDriver.scpi(command.trim())
      // Elle gönderilen set komutu durumu değiştirmiş olabilir
      if (!command.includes('?')) await this.refreshRf(dev)
      return reply
    }
    if (this.isProbe(dev)) {
      if (!dev.tcf?.connected) throw new Error('Cihaz bağlı değil')
      const m = command.trim().match(/^(\S+)\s+(\S+)(?:\s+([\s\S]+))?$/)
      if (!m) throw new Error('Biçim: <Servis> <komut> [JSON argüman] — ör. Jtag getChildren ""')
      const args = m[3] ? [m[3].trim()] : []
      const reply = await dev.tcf.command(m[1], m[2], args)
      return reply.length > 0 ? reply.join(' ') : 'OK'
    }
    const { dev: psuDev } = this.requireDriver(id)
    const conn = psuDev.conn!
    if (command.includes('?')) return conn.query(command)
    await conn.send(command)
    return null
  }

  /** Tüm bağlantıları ve zamanlayıcıları kapatır (test/uygulama çıkışı). */
  async dispose(): Promise<void> {
    this.disposed = true
    for (const dev of this.devices.values()) {
      dev.userDisconnected = true
      if (dev.reconnectTimer) clearTimeout(dev.reconnectTimer)
      this.stopPolling(dev)
      dev.conn?.removeAllListeners()
      dev.conn?.disconnect()
      dev.conn = null
      dev.driver = null
      dev.pollDriver = null
      dev.tcf?.removeAllListeners()
      dev.tcf?.disconnect()
      dev.tcf = null
      dev.probeDriver = null
      this.closeHid(dev)
    }
  }
}
