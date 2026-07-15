/**
 * Tarayıcı geliştirme modu: preload köprüsü (window.deviceApi) yoksa,
 * saf protokol modeli (Cpx400dpSim) üzerinde çalışan bir DeviceApi taklidi
 * kurar. Amaç: arayüzü Electron/donanım olmadan, gerçek protokol
 * davranışıyla tarayıcıda geliştirebilmek ve smoke-test edebilmek.
 *
 * Not: Üretimde preload her zaman deviceApi sağlar; bu modül yalnızca
 * düz tarayıcıda yüklenir.
 */
import { Cpx400dpSim } from '../../../../tools/simulator/model'
import type {
  ChannelMeasurement,
  ChannelSetpoints,
  ConnectionState,
  DeviceConfig,
  DeviceSnapshot,
  ProbeInfo,
  ScpiLogEntry,
  TripInfo
} from '@shared/types'
import { deviceTypeInfo } from '@shared/types'

const STORAGE_KEY = 'mock-devices'
const LSR_OVP = 0b0100
const LSR_OCP = 0b1000

interface MockDevice {
  config: DeviceConfig
  sim: Cpx400dpSim | null
  state: ConnectionState
  identity: string | null
  trips: TripInfo[]
  probe: ProbeInfo | null
  pollTimer: number | null
  pollCount: number
}

const MOCK_PROBE: ProbeInfo = {
  services: ['Locator', 'Jtag', 'JtagCable', 'JtagDevice', 'Memory', 'RunControl', 'Xicom', 'stapl'],
  agentId: 'sim-dlc20-agent-0001',
  jtagTargets: [
    { name: 'arm_dap', idCode: '0x4ba00477', irLen: 4 },
    { name: 'xc7z045', idCode: '0x23731093', irLen: 6 }
  ]
}

type SnapshotCb = (s: DeviceSnapshot) => void
type LogCb = (e: ScpiLogEntry) => void

const devices = new Map<string, MockDevice>()
const snapshotCbs = new Set<SnapshotCb>()
const logCbs = new Set<LogCb>()

function loadConfigs(): DeviceConfig[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function persist(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...devices.values()].map((d) => d.config)))
}

function createMock(config: DeviceConfig): MockDevice {
  if (config.kind === 'smartlynq') {
    return { config, sim: null, state: 'disconnected', identity: null, trips: [], probe: null, pollTimer: null, pollCount: 0 }
  }
  const sim = new Cpx400dpSim()
  // Görsel test için canlı bir sahne: farklı yükler
  sim.handle('SIM:LOAD1 8')
  sim.handle('SIM:LOAD2 3')
  return { config, sim, state: 'disconnected', identity: null, trips: [], probe: null, pollTimer: null, pollCount: 0 }
}

for (const cfg of loadConfigs()) devices.set(cfg.id, createMock(cfg))

function num(resp: string | null): number {
  // "V1 5.000" gibi yanıtlarda ilk sayı kanal numarasıdır; her zaman SON sayıyı al
  const matches = (resp ?? '').match(/-?[\d.]+/g)
  return matches && matches.length > 0 ? Number(matches[matches.length - 1]) : 0
}

function ask(dev: MockDevice, cmd: string, source: 'user' | 'poll' = 'user'): string | null {
  if (!dev.sim) return null
  const resp = dev.sim.handle(cmd)
  const ts = Date.now()
  for (const cb of logCbs) {
    cb({ deviceId: dev.config.id, dir: 'tx', line: cmd, source, timestamp: ts })
    if (resp !== null) cb({ deviceId: dev.config.id, dir: 'rx', line: resp, source, timestamp: ts })
  }
  return resp
}

function readSetpoints(dev: MockDevice, ch: number): ChannelSetpoints {
  // Snapshot üretimi arka plan işi sayılır → poll etiketi
  return {
    voltage: num(ask(dev, `V${ch}?`, 'poll')),
    current: num(ask(dev, `I${ch}?`, 'poll')),
    ovp: num(ask(dev, `OVP${ch}?`, 'poll')),
    ocp: num(ask(dev, `OCP${ch}?`, 'poll'))
  }
}

function snapshot(dev: MockDevice): DeviceSnapshot {
  if (dev.config.kind === 'smartlynq') {
    return {
      id: dev.config.id,
      state: dev.state,
      identity: dev.identity,
      error: null,
      channels: [],
      setpoints: [],
      tracking: false,
      trips: [],
      probe: dev.probe,
      timestamp: Date.now()
    }
  }
  const info = deviceTypeInfo(dev.config.kind)
  const channels: ChannelMeasurement[] = []
  const setpoints: ChannelSetpoints[] = []
  for (let ch = 1; ch <= info.channelCount; ch++) {
    const sp = readSetpoints(dev, ch)
    setpoints.push(sp)
    if (dev.state !== 'connected') {
      channels.push({ voltage: 0, current: 0, power: 0, outputOn: false, mode: 'off' })
      continue
    }
    const voltage = num(ask(dev, `V${ch}O?`, 'poll'))
    const current = num(ask(dev, `I${ch}O?`, 'poll'))
    const outputOn = ask(dev, `OP${ch}?`, 'poll') === '1'
    const mode = !outputOn ? 'off' : sp.current > 0 && current >= sp.current * 0.98 ? 'cc' : 'cv'
    channels.push({ voltage, current, power: voltage * current, outputOn, mode })
  }
  return {
    id: dev.config.id,
    state: dev.state,
    identity: dev.identity,
    error: null,
    channels,
    setpoints,
    tracking: ask(dev, 'CONFIG?', 'poll') === '0',
    trips: [...dev.trips],
    probe: null,
    timestamp: Date.now()
  }
}

function publish(dev: MockDevice): void {
  const s = snapshot(dev)
  for (const cb of snapshotCbs) cb(s)
}

function pollTrips(dev: MockDevice): void {
  const info = deviceTypeInfo(dev.config.kind)
  for (let ch = 1; ch <= info.channelCount; ch++) {
    const lsr = num(ask(dev, `LSR${ch}?`, 'poll'))
    for (const [bit, kind] of [
      [LSR_OVP, 'ovp'],
      [LSR_OCP, 'ocp']
    ] as const) {
      if (lsr & bit && !dev.trips.some((t) => t.channel === ch && t.kind === kind)) {
        dev.trips.push({ channel: ch, kind })
      }
    }
  }
}

function requireDev(id: string): MockDevice {
  const dev = devices.get(id)
  if (!dev) throw new Error(`Cihaz bulunamadı: ${id}`)
  return dev
}

function requireConnected(id: string): MockDevice {
  const dev = requireDev(id)
  if (dev.state !== 'connected') throw new Error('Cihaz bağlı değil')
  return dev
}

function requirePsu(id: string): MockDevice {
  const dev = requireConnected(id)
  if (!dev.sim) throw new Error('Bu komut bu cihaz türünde desteklenmiyor')
  return dev
}

function requireUnlocked(id: string): MockDevice {
  const dev = requirePsu(id)
  if (dev.config.locked) {
    throw new Error('Ayar kilidi etkin — değerleri değiştirmek için kilidi açın')
  }
  return dev
}

async function afterSet(dev: MockDevice): Promise<void> {
  const eer = num(ask(dev, 'EER?'))
  publish(dev)
  if (eer > 0) throw new Error(`Cihaz komutu reddetti (EER ${eer}) — değer aralık dışında olabilir`)
}

const mockApi = {
  async listDevices(): Promise<DeviceConfig[]> {
    return [...devices.values()].map((d) => ({ ...d.config }))
  },
  async listSnapshots(): Promise<DeviceSnapshot[]> {
    return [...devices.values()].map(snapshot)
  },
  async addDevice(cfg: Omit<DeviceConfig, 'id'>): Promise<DeviceConfig> {
    const config: DeviceConfig = { ...cfg, id: crypto.randomUUID() }
    devices.set(config.id, createMock(config))
    persist()
    return config
  },
  async updateDevice(cfg: DeviceConfig): Promise<void> {
    requireDev(cfg.id).config = { ...cfg }
    persist()
  },
  async removeDevice(id: string): Promise<void> {
    const dev = devices.get(id)
    if (dev?.pollTimer) window.clearInterval(dev.pollTimer)
    devices.delete(id)
    persist()
  },
  async connect(id: string): Promise<void> {
    const dev = requireDev(id)
    dev.state = 'connecting'
    publish(dev)
    await new Promise((r) => setTimeout(r, 600))
    if (dev.config.kind === 'smartlynq') {
      dev.state = 'connected'
      dev.probe = MOCK_PROBE
      dev.identity = `Xilinx Hardware Server (hw_server) — ${MOCK_PROBE.agentId}`
      const ts = Date.now()
      for (const cb of logCbs) {
        cb({ deviceId: dev.config.id, dir: 'tx', line: 'E Locator Hello ["Locator"]', source: 'user', timestamp: ts })
        cb({ deviceId: dev.config.id, dir: 'rx', line: 'E Locator Hello ' + JSON.stringify(MOCK_PROBE.services), source: 'user', timestamp: ts })
      }
      publish(dev)
      return
    }
    dev.state = 'connected'
    dev.identity = ask(dev, '*IDN?')
    dev.pollTimer = window.setInterval(() => {
      if (dev.pollCount % 4 === 0) pollTrips(dev)
      dev.pollCount++
      publish(dev)
    }, 500)
    publish(dev)
  },
  async disconnect(id: string): Promise<void> {
    const dev = requireDev(id)
    if (dev.pollTimer) window.clearInterval(dev.pollTimer)
    dev.pollTimer = null
    dev.state = 'disconnected'
    publish(dev)
  },
  async setVoltage(id: string, ch: number, v: number): Promise<void> {
    const dev = requireUnlocked(id)
    ask(dev, `V${ch} ${v.toFixed(3)}`)
    await afterSet(dev)
  },
  async setCurrent(id: string, ch: number, a: number): Promise<void> {
    const dev = requireUnlocked(id)
    ask(dev, `I${ch} ${a.toFixed(3)}`)
    await afterSet(dev)
  },
  async setOvp(id: string, ch: number, v: number): Promise<void> {
    const dev = requireUnlocked(id)
    ask(dev, `OVP${ch} ${v.toFixed(3)}`)
    await afterSet(dev)
  },
  async setOcp(id: string, ch: number, a: number): Promise<void> {
    const dev = requireUnlocked(id)
    ask(dev, `OCP${ch} ${a.toFixed(3)}`)
    await afterSet(dev)
  },
  async setOutput(id: string, ch: number, on: boolean): Promise<void> {
    const dev = requirePsu(id)
    ask(dev, `OP${ch} ${on ? 1 : 0}`)
    await afterSet(dev)
  },
  async setAllOutputs(id: string, on: boolean): Promise<void> {
    const dev = requirePsu(id)
    ask(dev, `OPALL ${on ? 1 : 0}`)
    await afterSet(dev)
  },
  async setTracking(id: string, on: boolean): Promise<void> {
    const dev = requireUnlocked(id)
    ask(dev, `CONFIG ${on ? 0 : 2}`)
    publish(dev)
  },
  async tripReset(id: string): Promise<void> {
    const dev = requireConnected(id)
    ask(dev, 'TRIPRST')
    ask(dev, 'LSR1?')
    ask(dev, 'LSR2?')
    dev.trips = []
    publish(dev)
  },
  async sendRaw(id: string, command: string): Promise<string | null> {
    const dev = requireConnected(id)
    if (dev.config.kind === 'smartlynq') {
      const ts = Date.now()
      let reply = 'OK'
      if (/getAgentID/i.test(command)) reply = `null ${JSON.stringify(MOCK_PROBE.agentId)}`
      else if (/getChildren\s+""/i.test(command)) reply = 'null ["port0"]'
      else if (/getChildren/i.test(command)) reply = 'null ["xc7z045-0"]'
      else if (/getContext/i.test(command)) reply = 'null {"ID":"xc7z045-0","Name":"xc7z045"}'
      for (const cb of logCbs) {
        cb({ deviceId: dev.config.id, dir: 'tx', line: 'C 1 ' + command, source: 'user', timestamp: ts })
        cb({ deviceId: dev.config.id, dir: 'rx', line: 'R 1 ' + reply, source: 'user', timestamp: ts })
      }
      return reply
    }
    const resp = ask(dev, command)
    publish(dev)
    return command.includes('?') ? resp : null
  },
  onSnapshot(cb: SnapshotCb): () => void {
    snapshotCbs.add(cb)
    return () => snapshotCbs.delete(cb)
  },
  onLog(cb: LogCb): () => void {
    logCbs.add(cb)
    return () => logCbs.delete(cb)
  }
}

window.deviceApi = mockApi as unknown as typeof window.deviceApi
console.info('[mock] deviceApi tarayıcı taklidi etkin — Electron dışı geliştirme modu')
