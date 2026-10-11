import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startHmp4040Sim, type Hmp4040SimHandle } from '../tools/simulator/hmp4040-sim'
import { Hmp4040Sim } from '../tools/simulator/hmp4040-model'
import { ScpiConnection } from '../src/main/scpi/connection'
import { createDriver } from '../src/main/drivers/cpx400dp'
import type { PsuDriver } from '../src/main/drivers/types'
import { DeviceManager } from '../src/main/deviceManager'
import type { DeviceSnapshot } from '../src/shared/types'

const LSR_OVP = 0b0100
const LSR_OCP = 0b1000

describe('Hmp4040Sim (kılavuz komut seti)', () => {
  it('komutlar seçili kanala gider; kanal ancak SEL + GEN açıkken çıkış verir', () => {
    const s = new Hmp4040Sim()
    s.handle('INST:NSEL 3')
    s.handle('VOLT 6')
    s.handle('CURR 3')
    expect(s.channels[2].vSet).toBe(6)
    expect(s.channels[0].vSet).toBe(0)
    expect(s.handle('INST OUT2')).toBeNull()
    expect(s.handle('INST?')).toBe('OUTP2')
    s.handle('INST:NSEL 3')
    s.handle('OUTP:SEL ON')
    expect(s.handle('OUTP?')).toBe('0') // ana çıkış kapalı
    s.handle('OUTP:GEN ON')
    expect(s.handle('OUTP?')).toBe('1')
    expect(s.handle('MEAS:VOLT?')).toBe('6.000')
    expect(s.handle('MEAS:CURR?')).toBe('0.6000') // 10 Ω yük
  })

  it('aralık dışı değer -222 hatası; bilinmeyen komut -113', () => {
    const s = new Hmp4040Sim()
    s.handle('VOLT 40')
    expect(s.handle('SYST:ERR?')).toBe('-222, "Data out of range"')
    s.handle('FOO')
    expect(s.handle('SYST:ERR?')).toBe('-113, "Undefined header"')
    expect(s.handle('SYST:ERR?')).toBe('0, "No error"')
  })
})

describe('Hmp4040Driver (simülatöre karşı)', () => {
  let sim: Hmp4040SimHandle
  let conn: ScpiConnection
  let driver: PsuDriver

  beforeAll(async () => {
    sim = await startHmp4040Sim(0)
  })
  afterAll(async () => {
    conn?.disconnect()
    await sim.close()
  })
  beforeEach(async () => {
    conn?.disconnect()
    conn = new ScpiConnection('127.0.0.1', sim.port, { timeoutMs: 2000 })
    await conn.connect()
    driver = createDriver('hmp4040', conn)
    await conn.send('*RST')
    for (const ch of [1, 2, 3, 4]) await conn.send(`SIM:LOAD${ch} 10`)
  })

  it('identify kimliği döndürür ve karma moda (SYST:MIX) alır', async () => {
    expect(await driver.identify()).toContain('HMP4040')
    expect(sim.sim.mode).toBe('MIX')
  })

  it('4 kanalın gerilim/akım/OVP değerleri ayrı ayrı yazılır ve okunur', async () => {
    const values = [
      [12, 5, 13],
      [5.6, 8, 6],
      [6, 3, 7],
      [1, 1, 2]
    ]
    for (const [i, [v, a, ovp]] of values.entries()) {
      await driver.setVoltage(i + 1, v)
      await driver.setCurrent(i + 1, a)
      await driver.setOvp(i + 1, ovp)
    }
    for (const [i, [v, a, ovp]] of values.entries()) {
      expect(await driver.readSetpoints(i + 1)).toEqual({ voltage: v, current: a, ovp, ocp: 0 })
    }
    expect(await driver.readExecutionError()).toBe(0)
  })

  it('kanal çıkışı: açınca yalnız o kanal; ana çıkış kapalıyken diğer etkin kanallar açılmaz', async () => {
    // Ön panelden kanal 2 "etkin" bırakılmış, ana çıkış kapalı
    await conn.send('INST:NSEL 2')
    await conn.send('OUTP:SEL ON')
    await driver.setVoltage(1, 5)
    await driver.setOutput(1, true)
    expect((await driver.readChannel(1)).outputOn).toBe(true)
    expect((await driver.readChannel(2)).outputOn).toBe(false)
    expect(sim.sim.general).toBe(true)
    // Kanal 3'ü aç, kanal 1'i kapat: kanal 3 etkilenmez
    await driver.setOutput(3, true)
    await driver.setOutput(1, false)
    expect((await driver.readChannel(1)).outputOn).toBe(false)
    expect((await driver.readChannel(3)).outputOn).toBe(true)
  })

  it('tümünü aç / kapat', async () => {
    await driver.setAllOutputs(true)
    for (const ch of [1, 2, 3, 4]) expect((await driver.readChannel(ch)).outputOn).toBe(true)
    await driver.setAllOutputs(false)
    for (const ch of [1, 2, 3, 4]) expect((await driver.readChannel(ch)).outputOn).toBe(false)
  })

  it('ölçüm: gerilim, akım (yük modeli)', async () => {
    await driver.setVoltage(4, 2)
    await driver.setCurrent(4, 1)
    await driver.setOutput(4, true)
    const m = await driver.readChannel(4)
    expect(m.voltage).toBeCloseTo(2, 3)
    expect(m.current).toBeCloseTo(0.2, 4)
  })

  it('trip: OVP ve sigorta LSR bitlerine eşlenir; OVP sıfırlanır', async () => {
    await conn.send('SIM:TRIP2 OVP')
    await conn.send('SIM:TRIP3 FUSE')
    expect(await driver.readLsr(2)).toBe(LSR_OVP)
    expect(await driver.readLsr(3)).toBe(LSR_OCP)
    await driver.tripReset()
    expect(await driver.readLsr(2)).toBe(0)
  })

  it('aralık dışı değer cihaz hatası olarak okunur', async () => {
    await driver.setVoltage(1, 40)
    expect(await driver.readExecutionError()).toBe(222)
  })

  it('eşzamanlı sorgular kanal seçimini karıştırmaz (seç + komut bölünmez)', async () => {
    for (const ch of [1, 2, 3, 4]) await driver.setVoltage(ch, ch * 2)
    const results = await Promise.all([
      driver.readSetpoints(1),
      driver.setVoltage(3, 9.5),
      driver.readSetpoints(2),
      driver.readSetpoints(3),
      driver.readSetpoints(4)
    ])
    expect((results[0] as { voltage: number }).voltage).toBe(2)
    expect((results[2] as { voltage: number }).voltage).toBe(4)
    expect((results[3] as { voltage: number }).voltage).toBe(9.5)
    expect((results[4] as { voltage: number }).voltage).toBe(8)
    expect(sim.sim.channels.map((c) => c.vSet)).toEqual([2, 4, 9.5, 8])
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

describe('DeviceManager — HMP4040 (simülatöre karşı)', () => {
  let sim: Hmp4040SimHandle
  let dir: string
  let manager: DeviceManager

  beforeEach(async () => {
    sim = await startHmp4040Sim(0)
    dir = mkdtempSync(join(tmpdir(), 'dc-hmp-'))
    // Hızlı yoklama: kullanıcı komutlarıyla iç içe geçsin (seçim yarışını sınar)
    manager = new DeviceManager({ dataDir: dir, pollIntervalMs: 5 })
  })
  afterEach(async () => {
    await manager.dispose()
    await sim.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('4 kanal yoklanır; yoğun yoklama altında ayarlar doğru kanala gider', async () => {
    const cfg = await manager.addDevice({ name: 'HMP', kind: 'hmp4040', host: '127.0.0.1', port: sim.port })
    await manager.connect(cfg.id)
    const setpoints: Array<[number, number, number]> = [
      [1, 12, 5],
      [2, 5.6, 8],
      [3, 6, 3],
      [4, 1, 1]
    ]
    for (const [ch, v, a] of setpoints) {
      await manager.setVoltage(cfg.id, ch, v)
      await manager.setCurrent(cfg.id, ch, a)
    }
    await manager.setOutput(cfg.id, 3, true)
    const s = await waitForSnapshot(manager, (x) => x.id === cfg.id && x.channels[2].outputOn)
    expect(s.channels).toHaveLength(4)
    expect(s.setpoints.map((p) => [p.voltage, p.current])).toEqual(setpoints.map(([, v, a]) => [v, a]))
    expect(s.channels[2].voltage).toBeCloseTo(6, 3)
    expect(s.channels.filter((c) => c.outputOn)).toHaveLength(1)
    expect(sim.sim.channels.map((c) => c.vSet)).toEqual([12, 5.6, 6, 1])
  })
})
