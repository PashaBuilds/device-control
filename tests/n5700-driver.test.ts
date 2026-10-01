import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startN5745aSim, type N5745aSimHandle } from '../tools/simulator/n5745a-sim'
import { ScpiConnection } from '../src/main/scpi/connection'
import { createDriver } from '../src/main/drivers/cpx400dp'
import { N5700Driver } from '../src/main/drivers/n5700'
import { deviceTypeInfo } from '../src/shared/types'
import type { PsuDriver } from '../src/main/drivers/types'

describe('N5745A türü', () => {
  it('tek kanal, 30 V / 25 A, OVP 36, OCP alanı ve tracking yok, LOCAL yok', () => {
    const t = deviceTypeInfo('n5745a')
    expect(t).toMatchObject({
      label: 'Keysight N5745A',
      category: 'power-supply',
      channelCount: 1,
      maxVoltage: 30,
      maxCurrent: 25,
      maxOvp: 36,
      defaultPort: 5025,
      hasTracking: false,
      hasOcpLevel: false,
      pollIntervalMs: 500
    })
    expect(t.idleCommand).toBeUndefined()
  })
})

describe('N5700Driver (simülatöre karşı)', () => {
  let srv: N5745aSimHandle
  let conn: ScpiConnection
  let driver: PsuDriver

  beforeAll(async () => {
    srv = await startN5745aSim(0)
    conn = new ScpiConnection('127.0.0.1', srv.port)
    await conn.connect()
    driver = createDriver('n5745a', conn)
  })

  afterAll(async () => {
    conn.disconnect()
    await srv.close()
  })

  beforeEach(() => {
    srv.sim.reset()
  })

  it('createDriver N5700Driver döndürür; tek kanal', () => {
    expect(driver).toBeInstanceOf(N5700Driver)
    expect(driver.channelCount).toBe(1)
  })

  it('kimlik', async () => {
    expect(await driver.identify()).toMatch(/N5745A/)
  })

  it('setpoint yazar ve okur (OCP 0 döner)', async () => {
    await driver.setVoltage(1, 12.5)
    await driver.setCurrent(1, 3)
    await driver.setOvp(1, 20)
    expect(await driver.readSetpoints(1)).toEqual({ voltage: 12.5, current: 3, ovp: 20, ocp: 0 })
    expect(await driver.readExecutionError()).toBe(0)
  })

  it('ölçüm ve çıkış durumu', async () => {
    await driver.setVoltage(1, 12)
    await driver.setCurrent(1, 5)
    await driver.setOutput(1, true)
    const m = await driver.readChannel(1)
    expect(m.outputOn).toBe(true)
    expect(m.voltage).toBeCloseTo(12)
    expect(m.current).toBeCloseTo(1.2)
    await driver.setAllOutputs(false)
    expect((await driver.readChannel(1)).outputOn).toBe(false)
  })

  it('trip bitlerini LSR düzenine eşler ve sıfırlar', async () => {
    srv.sim.handle('SIM:TRIP OVP')
    expect(await driver.readLsr(1)).toBe(0b0100)
    srv.sim.handle('SIM:TRIP OCP')
    expect(await driver.readLsr(1)).toBe(0b1100)
    await driver.tripReset()
    expect(await driver.readLsr(1)).toBe(0)
  })

  it('aralık dışı değer hata kodu verir', async () => {
    await driver.setVoltage(1, 35)
    expect(await driver.readExecutionError()).toBe(222)
  })

  it('setOcp ve setTracking cihaza hiçbir şey göndermez', async () => {
    const sent: string[] = []
    const onLog = (e: { dir: string; line: string }): void => {
      if (e.dir === 'tx') sent.push(e.line)
    }
    conn.on('log', onLog)
    await driver.setOcp(1, 5)
    await driver.setTracking(true)
    conn.off('log', onLog)
    expect(sent).toEqual([])
    expect(await driver.readTracking()).toBe(false)
  })

  it('kanal 2 reddedilir', async () => {
    await expect(driver.setVoltage(2, 1)).rejects.toThrow(RangeError)
  })
})
