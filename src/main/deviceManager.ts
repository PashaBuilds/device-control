import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type {
  ChannelMeasurement,
  ChannelSetpoints,
  ConnectionState,
  DeviceConfig,
  DeviceSnapshot,
  ProbeInfo,
  TripInfo
} from '@shared/types'
import { deviceTypeInfo } from '@shared/types'
import { ScpiConnection } from './scpi/connection'
import { TcfConnection } from './tcf/connection'
import { createDriver } from './drivers/cpx400dp'
import { SmartLynqDriver } from './drivers/smartlynq'
import type { PsuDriver } from './drivers/types'
import { Store } from './store'

const LSR_OVP = 0b0100
const LSR_OCP = 0b1000

export interface DeviceManagerOptions {
  dataDir: string
  /** Ölçüm yoklama aralığı (ms). Varsayılan 500. */
  pollIntervalMs?: number
}

interface ManagedDevice {
  config: DeviceConfig
  conn: ScpiConnection | null
  driver: PsuDriver | null
  tcf: TcfConnection | null
  probeDriver: SmartLynqDriver | null
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
  private readonly pollIntervalMs: number
  private readonly devices = new Map<string, ManagedDevice>()
  private disposed = false

  constructor(opts: DeviceManagerOptions) {
    super()
    this.store = new Store(opts.dataDir)
    this.pollIntervalMs = opts.pollIntervalMs ?? 500
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
      tcf: null,
      probeDriver: null,
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

  private requireDriver(id: string): { dev: ManagedDevice; driver: PsuDriver } {
    const dev = this.get(id)
    if (this.isProbe(dev)) throw new Error('Bu komut bu cihaz türünde desteklenmiyor')
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
      probe: dev.probe ? { ...dev.probe, services: [...dev.probe.services], jtagTargets: [...dev.probe.jtagTargets] } : null,
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
    const addressChanged = dev.config.host !== cfg.host || dev.config.port !== cfg.port
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
    if (dev.conn) {
      dev.conn.removeAllListeners()
      dev.conn.disconnect()
      dev.conn = null
      dev.driver = null
    }
    dev.state = phase
    dev.error = null
    this.publish(dev)

    const conn = new ScpiConnection(dev.config.host, dev.config.port)
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
    conn.on('log', (e: { dir: 'tx' | 'rx'; line: string }) =>
      this.emit('log', { deviceId: dev.config.id, dir: e.dir, line: e.line, timestamp: Date.now() })
    )
    conn.on('close', () => {
      if (dev.userDisconnected || this.disposed) return
      this.stopPolling(dev)
      dev.conn = null
      dev.driver = null
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
    tcf.on('log', (e: { dir: 'tx' | 'rx'; line: string }) =>
      this.emit('log', { deviceId: dev.config.id, dir: e.dir, line: e.line, timestamp: Date.now() })
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
      dev.identity = `Xilinx hw_server (TCF)${dev.probe.agentId ? ` — ${dev.probe.agentId}` : ''}`
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

  private scheduleReconnect(dev: ManagedDevice): void {
    if (this.disposed || dev.userDisconnected) return
    dev.state = 'reconnecting'
    this.publish(dev)
    dev.reconnectTimer = setTimeout(() => {
      dev.reconnectTimer = null
      this.establish(dev, 'reconnecting').catch(() => undefined)
    }, dev.reconnectDelayMs)
    dev.reconnectDelayMs = Math.min(dev.reconnectDelayMs * 2, 15000)
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
    }
    if (dev.tcf) {
      dev.tcf.removeAllListeners()
      dev.tcf.disconnect()
      dev.tcf = null
      dev.probeDriver = null
    }
    dev.state = 'disconnected'
    dev.channels = dev.channels.map(() => emptyChannel())
    dev.error = null
    this.publish(dev)
  }

  // ---- Yoklama ----

  private startPolling(dev: ManagedDevice): void {
    this.stopPolling(dev)
    dev.pollCount = 0
    dev.pollTimer = setInterval(() => void this.poll(dev), this.pollIntervalMs)
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
    if (dev.pollBusy || !dev.driver || !dev.conn?.connected) return
    dev.pollBusy = true
    try {
      const driver = dev.driver
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
      // Her 4. döngüde trip ve tracking denetimi
      if (dev.pollCount % 4 === 0) {
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
          dev.error = 'Cihaz yanıt vermiyor'
          this.scheduleReconnect(dev)
        }
      }
    } finally {
      dev.pollBusy = false
    }
  }

  /** Probe canlılık denetimi: her 4. döngüde (≈2 sn) Locator sync. */
  private async pollProbe(dev: ManagedDevice): Promise<void> {
    if (dev.pollBusy || !dev.probeDriver || !dev.tcf?.connected) return
    dev.pollCount++
    if (dev.pollCount % 4 !== 0) return
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

  async sendRaw(id: string, command: string): Promise<string | null> {
    const dev = this.get(id)
    if (this.isProbe(dev)) {
      if (!dev.tcf?.connected) throw new Error('Cihaz bağlı değil')
      const m = command.trim().match(/^(\S+)\s+(\S+)(?:\s+([\s\S]+))?$/)
      if (!m) throw new Error('Biçim: <Servis> <komut> [JSON argüman] — ör. Jtag getChildren ""')
      const args = m[3] ? [m[3].trim()] : []
      const reply = await dev.tcf.command(m[1], m[2], ...args)
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
      dev.tcf?.removeAllListeners()
      dev.tcf?.disconnect()
      dev.tcf = null
      dev.probeDriver = null
    }
  }
}
