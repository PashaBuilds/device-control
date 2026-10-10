import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  decodeScpiReport,
  discoverMclDevices,
  encodeScpiReport,
  kindForModel,
  MCL_SCPI_CODE,
  stripTag
} from '../src/main/hid/mcl'
import { HidScpiConnection } from '../src/main/hid/connection'
import {
  checkSetReply,
  formatFrequencyCommand,
  formatPowerCommand,
  parseFrequencyHz,
  parseOnOff,
  parsePowerDbm,
  SsgDriver
} from '../src/main/drivers/ssg'
import { DeviceManager } from '../src/main/deviceManager'
import type { DeviceSnapshot } from '../src/shared/types'
import { FakeHidBackend, type FakeHidDevice } from '../tools/simulator/ssg-hid'
import { SSG_15G_RC_SPEC, SSG_6000RC_SPEC, SsgSim } from '../tools/simulator/ssg-model'

function demoDevices(): FakeHidDevice[] {
  return [
    { path: 'p1', productId: 0x22, sim: new SsgSim(SSG_6000RC_SPEC) },
    { path: 'p2', productId: 0x22, sim: new SsgSim(SSG_15G_RC_SPEC) }
  ]
}

describe('Mini-Circuits HID çerçeveleme', () => {
  it('SCPI komutunu rapor kimliği + 64 bayta kodlar', () => {
    const buf = encodeScpiReport(':FREQ?')
    expect(buf.length).toBe(65)
    expect(buf[0]).toBe(0)
    expect(buf[1]).toBe(MCL_SCPI_CODE)
    expect(buf.subarray(2, 8).toString('ascii')).toBe(':FREQ?')
    expect(buf.subarray(8).every((b) => b === 0)).toBe(true)
  })

  it('63 baytı aşan komutu reddeder', () => {
    expect(() => encodeScpiReport('x'.repeat(64))).toThrow(/uzun/)
    expect(encodeScpiReport('x'.repeat(63)).length).toBe(65)
  })

  it('yanıt raporunu NUL’a kadar çözer; başka koddaki raporu yok sayar', () => {
    const r = new Uint8Array(64)
    r[0] = 1
    r.set(Buffer.from('SSG-6000RC'), 1)
    expect(decodeScpiReport(r)).toBe('SSG-6000RC')
    r[0] = 40
    expect(decodeScpiReport(r)).toBeNull()
  })

  it('model adından türü bulur, etiketi atar', () => {
    expect(kindForModel('SSG-6000RC')).toBe('ssg6000rc')
    expect(kindForModel('ssg-15g-rc')).toBe('ssg15grc')
    expect(kindForModel('RUDAT-6000-60')).toBeNull()
    expect(stripTag('MN=SSG-6000RC', 'MN')).toBe('SSG-6000RC')
    expect(stripTag(' 11401230001 ', 'SN')).toBe('11401230001')
  })
})

describe('SSG yanıt ayrıştırma', () => {
  it('frekans: birimli, birimsiz Hz ve birimsiz MHz', () => {
    expect(parseFrequencyHz('2400.500000')).toBe(2_400_500_000)
    expect(parseFrequencyHz('2400500000')).toBe(2_400_500_000)
    expect(parseFrequencyHz('2.4 GHz')).toBe(2_400_000_000)
    expect(parseFrequencyHz('25MHz')).toBe(25_000_000)
    expect(parseFrequencyHz('0 - Invalid command')).toBeNull()
    expect(parseFrequencyHz('')).toBeNull()
  })

  it('güç ve RF durumu', () => {
    expect(parsePowerDbm('-5.25')).toBe(-5.25)
    expect(parsePowerDbm('PWR=10.00')).toBe(10)
    expect(parsePowerDbm('0 - Invalid command')).toBeNull()
    expect(parseOnOff('ON')).toBe(true)
    expect(parseOnOff('OFF')).toBe(false)
    expect(parseOnOff('1')).toBe(true)
    expect(parseOnOff('0')).toBe(false)
    expect(parseOnOff('0 - Invalid command')).toBeNull()
  })

  it('komut biçimleri', () => {
    expect(formatFrequencyCommand(2_400_500_000)).toBe(':FREQ:2400.5MHz')
    expect(formatFrequencyCommand(25_000_003)).toBe(':FREQ:25.000003MHz')
    expect(formatFrequencyCommand(6_000_000_000)).toBe(':FREQ:6000MHz')
    expect(formatPowerCommand(-5.25)).toBe(':PWR:-5.25')
    expect(formatPowerCommand(10)).toBe(':PWR:10')
    expect(formatPowerCommand(-0.001)).toBe(':PWR:0')
  })

  it('set yanıtı denetimi', () => {
    expect(() => checkSetReply(':PWR:1', '1 - Success')).not.toThrow()
    expect(() => checkSetReply(':PWR:1', '1')).not.toThrow()
    expect(() => checkSetReply(':PWR:1', '')).not.toThrow()
    expect(() => checkSetReply(':PWR:99', '0 - Power out of range')).toThrow(/reddetti/)
  })
})

describe('HidScpiConnection + SsgDriver (sahte HID)', () => {
  it('tanır, ayarlar ve geri okur', async () => {
    const backend = new FakeHidBackend(demoDevices())
    const conn = new HidScpiConnection(backend, 'p1')
    await conn.connect()
    const log: string[] = []
    conn.on('log', (e: { dir: string; line: string }) => log.push(`${e.dir} ${e.line}`))
    const drv = new SsgDriver(conn)
    const id = await drv.identify()
    expect(id.model).toBe('SSG-6000RC')
    expect(id.identity).toBe('Mini-Circuits SSG-6000RC · SN 11401230001 · FW C4')

    await drv.setFrequency(2_412_000_000)
    await drv.setPower(-7.5)
    await drv.setRfOutput(true)
    expect(await drv.readState()).toEqual({ frequencyHz: 2_412_000_000, powerDbm: -7.5, outputOn: true })
    expect(log).toContain('tx :FREQ:2412MHz')
    await expect(drv.setPower(20)).rejects.toThrow(/reddetti/)
    conn.disconnect()
  })

  it('kablo çekilince close yayar; yanıtsız cihazda zaman aşımı sayar', async () => {
    const devices = demoDevices()
    const backend = new FakeHidBackend(devices)
    const conn = new HidScpiConnection(backend, 'p1', { timeoutMs: 50 })
    await conn.connect()
    let closed = false
    conn.on('close', () => (closed = true))
    devices[0].silent = true
    await expect(conn.query(':FREQ?')).rejects.toThrow(/timeout/)
    expect(conn.consecutiveTimeouts).toBe(1)
    devices[0].unplugged = true
    await expect(conn.query(':FREQ?')).rejects.toThrow(/USB iletişim hatası/)
    expect(closed).toBe(true)
    expect(conn.connected).toBe(false)
  })

  it('komutlar sırayla işlenir (eşzamanlı çağrılarda yanıtlar karışmaz)', async () => {
    const backend = new FakeHidBackend(demoDevices())
    const conn = new HidScpiConnection(backend, 'p2')
    await conn.connect()
    const [mn, sn, fq] = await Promise.all([conn.query(':MN?'), conn.query(':SN?'), conn.query(':FREQ?')])
    expect([mn, sn, fq]).toEqual(['MN=SSG-15G-RC', 'SN=12001230002', '10.000000'])
    conn.disconnect()
  })

  it('tarama: modelleri tanır, yanıtsız cihazı "tanınmadı" listeler, kullanımdakini açmaz', async () => {
    const devices = demoDevices()
    devices.push({ path: 'p3', productId: 0x12, sim: new SsgSim(SSG_6000RC_SPEC), silent: true })
    const backend = new FakeHidBackend(devices)
    const inUse = new Map([
      ['p2', { path: 'p2', productId: 0x22, model: 'SSG-15G-RC', serial: 'X', kind: 'ssg15grc' as const, inUse: true }]
    ])
    const found = await discoverMclDevices(backend, inUse, 30)
    expect(found).toEqual([
      { path: 'p1', productId: 0x22, model: 'SSG-6000RC', serial: '11401230001', kind: 'ssg6000rc', inUse: false },
      { path: 'p2', productId: 0x22, model: 'SSG-15G-RC', serial: 'X', kind: 'ssg15grc', inUse: true },
      { path: 'p3', productId: 0x12, model: '', serial: '', kind: null, inUse: false }
    ])
  })
})

function waitForSnapshot(
  manager: DeviceManager,
  predicate: (s: DeviceSnapshot) => boolean,
  timeoutMs = 5000
): Promise<DeviceSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      manager.off('snapshot', onSnap)
      reject(new Error('beklenen snapshot gelmedi'))
    }, timeoutMs)
    const onSnap = (s: DeviceSnapshot): void => {
      if (predicate(s)) {
        clearTimeout(timer)
        manager.off('snapshot', onSnap)
        resolve(s)
      }
    }
    manager.on('snapshot', onSnap)
  })
}

describe('DeviceManager — sinyal üreteci (sahte HID)', () => {
  let dir: string
  let devices: FakeHidDevice[]
  let manager: DeviceManager

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dc-ssg-'))
    devices = demoDevices()
    manager = new DeviceManager({ dataDir: dir, pollIntervalMs: 30, hidBackend: new FakeHidBackend(devices) })
  })

  afterEach(async () => {
    await manager.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  async function add(kind: 'ssg6000rc' | 'ssg15grc', usbSerial?: string): Promise<string> {
    const cfg = await manager.addDevice({ name: 'SG', kind, host: '', port: 0, usbSerial })
    return cfg.id
  }

  it('türe göre doğru cihaza bağlanır, ayarlar ve snapshot yayınlar', async () => {
    const id = await add('ssg15grc')
    await manager.connect(id)
    const [snap] = (await manager.listSnapshots()).filter((s) => s.id === id)
    expect(snap.state).toBe('connected')
    expect(snap.identity).toContain('SSG-15G-RC')
    expect(snap.rf).toEqual({ frequencyHz: 10e6, powerDbm: -45, outputOn: false })

    await manager.setFrequency(id, 12.5e9)
    await manager.setPower(id, 3.25)
    await manager.setRfOutput(id, true)
    const s = await waitForSnapshot(manager, (x) => x.id === id && x.rf?.outputOn === true)
    expect(s.rf).toEqual({ frequencyHz: 12.5e9, powerDbm: 3.25, outputOn: true })
    expect(devices[1].sim.rfOn).toBe(true)
    expect(devices[0].sim.rfOn).toBe(false)
  })

  it('aralık dışı değeri cihaza göndermeden reddeder; kilit ayarı engeller ama RF anahtarını değil', async () => {
    const id = await add('ssg6000rc')
    await manager.connect(id)
    await expect(manager.setFrequency(id, 7e9)).rejects.toThrow(/25–6000 MHz/)
    await expect(manager.setPower(id, 15)).rejects.toThrow(/-65–14 dBm/)
    const cfg = (await manager.listDevices()).find((d) => d.id === id)!
    await manager.updateDevice({ ...cfg, locked: true })
    await expect(manager.setPower(id, 0)).rejects.toThrow(/kilidi/)
    await manager.setRfOutput(id, true)
    expect(devices[0].sim.rfOn).toBe(true)
  })

  it('seri numarasıyla seçer; bulunamazsa anlaşılır hata verir', async () => {
    const bad = await add('ssg6000rc', '999')
    await expect(manager.connect(bad)).rejects.toThrow(/SN 999/)
    const good = await add('ssg6000rc', '11401230001')
    await manager.connect(good)
    expect((await manager.listSnapshots()).find((s) => s.id === good)!.state).toBe('connected')
  })

  it('aynı cihaz iki kayda verilmez; listUsbDevices kullanımdakini işaretler', async () => {
    const a = await add('ssg6000rc')
    const b = await add('ssg6000rc')
    await manager.connect(a)
    await expect(manager.connect(b)).rejects.toThrow(/bulunamadı/)
    const list = await manager.listUsbDevices()
    expect(list.map((d) => [d.model, d.inUse])).toEqual([
      ['SSG-6000RC', true],
      ['SSG-15G-RC', false]
    ])
  })

  it('kablo çekilince yeniden bağlanmaya geçer, takılınca geri gelir', async () => {
    const id = await add('ssg6000rc')
    await manager.connect(id)
    devices[0].unplugged = true
    await waitForSnapshot(manager, (s) => s.id === id && s.state === 'reconnecting')
    devices[0].unplugged = false
    await waitForSnapshot(manager, (s) => s.id === id && s.state === 'connected', 8000)
  })

  it('SCPI konsolu: ham komut yanıt döndürür, set sonrası durum tazelenir', async () => {
    const id = await add('ssg6000rc')
    await manager.connect(id)
    expect(await manager.sendRaw(id, ':MN?')).toBe('MN=SSG-6000RC')
    expect(await manager.sendRaw(id, ':PWR:RF:ON')).toBe('1 - Success')
    expect((await manager.listSnapshots()).find((s) => s.id === id)!.rf?.outputOn).toBe(true)
  })

  it('PSU komutları sinyal üretecinde desteklenmez', async () => {
    const id = await add('ssg6000rc')
    await manager.connect(id)
    await expect(manager.setVoltage(id, 1, 5)).rejects.toThrow(/desteklenmiyor/)
  })
})
