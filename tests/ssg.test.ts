import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asciiz, discoverMclDevices, encodeReport, kindForModel, stripTag } from '../src/main/hid/mcl'
import { diagnoseMcl } from '../src/main/hid/diagnostics'
import { HidMclConnection } from '../src/main/hid/connection'
import {
  decodeOutputStatus,
  decodeScpiReply,
  encodeScpi,
  encodeSetFrequency,
  encodeSetPower,
  encodeSetRf,
  hzBytes,
  mhzText
} from '../src/main/hid/ssgProtocol'
import { SsgDriver } from '../src/main/drivers/ssg'
import { DeviceManager } from '../src/main/deviceManager'
import type { DeviceSnapshot } from '../src/shared/types'
import { FakeHidBackend, type FakeHidDevice } from '../tools/simulator/ssg-hid'
import { SSG_15G_RC_SPEC, SSG_6000RC_SPEC, SsgSim } from '../tools/simulator/ssg-model'

function demoDevices(): FakeHidDevice[] {
  return [
    { path: 'p1', productId: 0x12, sim: new SsgSim(SSG_6000RC_SPEC) },
    { path: 'p2', productId: 0x12, sim: new SsgSim(SSG_15G_RC_SPEC) }
  ]
}

describe('Mini-Circuits HID çerçeveleme', () => {
  it('gövdeyi rapor kimliği + 64 bayta yerleştirir', () => {
    const buf = encodeReport([105])
    expect(buf.length).toBe(65)
    expect(buf[0]).toBe(0)
    expect(buf[1]).toBe(105)
    expect(buf.subarray(2).every((b) => b === 0)).toBe(true)
    expect(() => encodeReport(new Array(65).fill(1))).toThrow(/1–64/)
  })

  it('NUL ile biten metni çözer; model adından türü bulur', () => {
    const r = new Uint8Array(64)
    r[0] = 40
    r.set(Buffer.from('SSG-6000RC'), 1)
    expect(asciiz(r, 1)).toBe('SSG-6000RC')
    expect(kindForModel('SSG-6000RC')).toBe('ssg6000rc')
    expect(kindForModel('ssg-15g-rc')).toBe('ssg15grc')
    expect(kindForModel('RUDAT-6000-60')).toBeNull()
    expect(stripTag('MN=SSG-6000RC', 'MN')).toBe('SSG-6000RC')
  })
})

describe('SSG USB paketleri — kılavuz (C3) bölüm 5.2 örnekleri', () => {
  it('5.2.3/5.2.5: 6000 ailesinde frekans 5 bayt Hz, en anlamlı önce', () => {
    expect(hzBytes(5_501_560_000)).toEqual([1, 71, 235, 36, 192])
    expect(hzBytes(4_100_550_000)).toEqual([0, 244, 105, 109, 112])
    expect(encodeSetFrequency('6000', 4_100_550_000)).toEqual([101, 0, 244, 105, 109, 112, 0])
  })

  it('5.2.6: xG ailesinde frekans ASCII MHz metni + NUL', () => {
    expect(encodeSetFrequency('xg', 4_100_550_000)).toEqual([101, 52, 49, 48, 48, 46, 53, 53, 0])
    expect(mhzText(25_000_003)).toBe('25.000003')
    expect(mhzText(6_000_000_000)).toBe('6000')
  })

  it('5.2.7: güç işaret + |dBm|×100 iki bayt; 5.2.8: RF aç/kapat', () => {
    expect(encodeSetPower(-5.5)).toEqual([102, 1, 2, 38, 0])
    expect(encodeSetPower(4.5)).toEqual([102, 0, 1, 194, 0])
    expect(encodeSetPower(-0.001)).toEqual([102, 0, 0, 0, 0])
    expect(encodeSetRf(true)).toEqual([104, 1])
    expect(encodeSetRf(false)).toEqual([104, 0])
  })

  it('5.2.9: durum yanıtı çözülür (4980.50 MHz, +5.5 dBm, RF açık, kilitli)', () => {
    const r = new Uint8Array(64)
    r.set([105, 1, 1, 1, 40, 220, 102, 32, 0, 2, 38, 0, 0])
    expect(decodeOutputStatus(r)).toEqual({
      outputOn: true,
      locked: true,
      frequencyHz: 4_980_500_000,
      powerDbm: 5.5,
      unleveled: null
    })
    r[8] = 1
    r[11] = 1
    expect(decodeOutputStatus(r)).toMatchObject({ powerDbm: -5.5, unleveled: 'high' })
  })

  it('5.2.17/5.2.18: SCPI kodu aileye göre (121 + uzunluk / 42)', () => {
    expect(encodeScpi('6000', ':MN?')).toEqual([121, 4, 58, 77, 78, 63])
    expect(encodeScpi('xg', ':MN?')).toEqual([42, 58, 77, 78, 63])
    const r6000 = new Uint8Array(64)
    r6000.set([121, 4, 58, 77, 78, 63, 0, 0, ...Buffer.from('SSG-6001RC')])
    expect(decodeScpiReply('6000', r6000)).toBe('SSG-6001RC')
    const rxg = new Uint8Array(64)
    rxg.set([42, ...Buffer.from('SSG-15G-RC')])
    expect(decodeScpiReply('xg', rxg)).toBe('SSG-15G-RC')
  })
})

describe('HidMclConnection + SsgDriver (sahte HID)', () => {
  it('SSG-6000RC: tanır, ikili komutlarla ayarlar, kod 105 ile geri okur', async () => {
    const devices = demoDevices()
    const conn = new HidMclConnection(new FakeHidBackend(devices), 'p1')
    await conn.connect()
    const log: string[] = []
    conn.on('log', (e: { dir: string; line: string }) => log.push(`${e.dir} ${e.line}`))
    const drv = new SsgDriver(conn, '6000')
    expect((await drv.identify()).identity).toBe('Mini-Circuits SSG-6000RC · SN 11401230001 · FW C4')
    await drv.setFrequency(2_412_500_000)
    await drv.setPower(-7.5)
    await drv.setRfOutput(true)
    expect(await drv.readState()).toEqual({
      frequencyHz: 2_412_500_000,
      powerDbm: -7.5,
      outputOn: true,
      locked: true,
      unleveled: null
    })
    // Cihaza giden paketler kılavuz biçiminde; Trigger Out kapalı
    expect(devices[0].sim.received[0].slice(0, 7)).toEqual([101, 0, 0x8f, 0xcb, 0xd4, 0x20, 0])
    expect(devices[0].sim.received[1].slice(0, 5)).toEqual([102, 1, 2, 238, 0])
    expect(log).toContain('tx [101] frekans 2412.5 MHz')
    expect(log).toContain('rx RF AÇIK · kilitli · 2412.5 MHz · -7.50 dBm')
    expect(await drv.scpi(':PWR:RF?')).toBe('ON')
    conn.disconnect()
  })

  it('SSG-15G-RC: ayar ve geri okuma USB üzerinden SCPI ile (kod 42), kod 105 kullanılmaz', async () => {
    const devices = demoDevices()
    const conn = new HidMclConnection(new FakeHidBackend(devices), 'p2')
    await conn.connect()
    const log: string[] = []
    conn.on('log', (e: { dir: string; line: string }) => log.push(`${e.dir} ${e.line}`))
    const drv = new SsgDriver(conn, 'xg')
    await drv.setFrequency(9_000_000_000)
    await drv.setPower(0)
    await drv.setRfOutput(true)
    expect(await drv.readState()).toEqual({
      frequencyHz: 9_000_000_000,
      powerDbm: 0,
      outputOn: true,
      locked: null,
      unleveled: null
    })
    expect(log).toEqual([
      'tx :FREQ:9000MHz', 'rx 1',
      'tx :PWR:0', 'rx 1',
      'tx :PWR:RF:ON', 'rx 1',
      'tx :FREQ?', 'rx 9000.000000',
      'tx :PWR?', 'rx 0.00',
      'tx :PWR:RF?', 'rx ON'
    ])
    await expect(drv.setPower(20)).rejects.toThrow(/reddetti/)
    conn.disconnect()
  })

  it('sahadaki SSG-15G-RC kod 105 yanıtı: frekans ASCII metin — ikili çözüm anlamsız (bu yüzden SCPI)', () => {
    const sim = new SsgSim(SSG_15G_RC_SPEC)
    sim.handle(':FREQ:9000MHz')
    const r = sim.handleReport(Uint8Array.from([105]))
    // Ekrandaki 245 621 600 302 Hz değeri = "9000." baytları
    expect(decodeOutputStatus(r).frequencyHz).toBe(245_621_600_302)
  })

  it('kablo çekilince close yayar; yanıtsız cihazda zaman aşımı sayar', async () => {
    const devices = demoDevices()
    const conn = new HidMclConnection(new FakeHidBackend(devices), 'p1', { timeoutMs: 50 })
    await conn.connect()
    let closed = false
    conn.on('close', () => (closed = true))
    const drv = new SsgDriver(conn, '6000')
    devices[0].silent = true
    await expect(drv.readState()).rejects.toThrow(/timeout/)
    expect(conn.consecutiveTimeouts).toBe(1)
    devices[0].unplugged = true
    await expect(drv.readState()).rejects.toThrow(/USB iletişim hatası/)
    expect(closed).toBe(true)
    expect(conn.connected).toBe(false)
  })

  it('komutlar sırayla işlenir (eşzamanlı çağrılarda yanıtlar karışmaz)', async () => {
    const conn = new HidMclConnection(new FakeHidBackend(demoDevices()), 'p2')
    await conn.connect()
    const drv = new SsgDriver(conn, 'xg')
    const [id, st, mn] = await Promise.all([drv.identify(), drv.readState(), drv.scpi(':SN?')])
    expect(id.model).toBe('SSG-15G-RC')
    expect(st.frequencyHz).toBe(10e6)
    expect(mn).toBe('12001230002')
    conn.disconnect()
  })

  it('tarama: kod 40/41 ile tanır, yanıtsız cihazı nedeniyle listeler, kullanımdakini açmaz', async () => {
    const devices = demoDevices()
    devices.push({ path: 'p3', productId: 0x12, sim: new SsgSim(SSG_6000RC_SPEC), silent: true })
    const inUse = new Map([
      ['p2', { path: 'p2', productId: 0x12, model: 'SSG-15G-RC', serial: 'X', kind: 'ssg15grc' as const, inUse: true }]
    ])
    const found = await discoverMclDevices(new FakeHidBackend(devices), inUse, 30)
    expect(found).toEqual([
      { path: 'p1', productId: 0x12, model: 'SSG-6000RC', serial: '11401230001', kind: 'ssg6000rc', inUse: false },
      { path: 'p2', productId: 0x12, model: 'SSG-15G-RC', serial: 'X', kind: 'ssg15grc', inUse: true },
      {
        path: 'p3',
        productId: 0x12,
        model: '',
        serial: '',
        kind: null,
        inUse: false,
        error: 'tanınamadı: timeout: kod 40 30ms içinde yanıtlanmadı'
      }
    ])
  })

  it('tanılama raporu: model, seri, ürün yazılımı, durum ve modele uygun SCPI kodu', async () => {
    const report = await diagnoseMcl(new FakeHidBackend(demoDevices()), new Map(), 30)
    expect(report).toContain('Toplam HID arayüzü: 3; Mini-Circuits (VID 0x20CE ya da adı uyan): 2')
    expect(report).toContain('[40] model adı → "SSG-6000RC"')
    expect(report).toContain('[41] seri no → "11401230001"')
    expect(report).toContain('[99] ürün yazılımı → "C4"')
    expect(report).toContain('[105] durum → RF KAPALI · kilitli · 25 MHz · -65.00 dBm')
    expect(report).toContain('SCPI :MN? [kod 121] → "SSG-6000RC"')
    expect(report).toContain('SCPI :MN? [kod 42] → "SSG-15G-RC"')
    expect(report).toContain('SCPI :FREQ? [kod 42] → "10.000000"')
  })

  it('tanılama raporu: hiç Mini-Circuits yoksa görülen üreticileri listeler', async () => {
    const report = await diagnoseMcl(new FakeHidBackend([]), new Map(), 30)
    expect(report).toContain('Mini-Circuits (VID 0x20CE ya da adı uyan): 0')
    expect(report).toContain('0x046D Logitech')
    expect(report).toContain('Cihaz USB HID olarak görünmüyor')
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
    expect(snap.rf).toEqual({ frequencyHz: 10e6, powerDbm: -45, outputOn: false, locked: null, unleveled: null })

    await manager.setFrequency(id, 12.5e9)
    await manager.setPower(id, 3.25)
    await manager.setRfOutput(id, true)
    const s = await waitForSnapshot(manager, (x) => x.id === id && x.rf?.outputOn === true)
    expect(s.rf).toEqual({ frequencyHz: 12.5e9, powerDbm: 3.25, outputOn: true, locked: null, unleveled: null })
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

  it('yanıt vermeyen Mini-Circuits cihazı varsa bağlantı hatası bunu söyler', async () => {
    devices[0].silent = true
    const id = await add('ssg6000rc')
    await expect(manager.connect(id)).rejects.toThrow(/1 Mini-Circuits cihazı görünüyor ama yanıt vermedi/)
  })

  it('tanılama raporu IPC yüzeyinden alınır', async () => {
    const report = await manager.usbDiagnostics()
    expect(report).toContain('HID kitaplığı: sahte HID arka ucu')
    expect(report).toContain('Mini-Circuits (VID 0x20CE ya da adı uyan): 2')
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
    expect(await manager.sendRaw(id, ':MN?')).toBe('SSG-6000RC')
    expect(await manager.sendRaw(id, ':PWR:RF:ON')).toBe('1')
    expect((await manager.listSnapshots()).find((s) => s.id === id)!.rf?.outputOn).toBe(true)
  })

  it('PSU komutları sinyal üretecinde desteklenmez', async () => {
    const id = await add('ssg6000rc')
    await manager.connect(id)
    await expect(manager.setVoltage(id, 1, 5)).rejects.toThrow(/desteklenmiyor/)
  })
})
