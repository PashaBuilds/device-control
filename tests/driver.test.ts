import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startCpx400dpSim, SimHandle } from '../tools/simulator/cpx400dp-sim'
import { ScpiConnection } from '../src/main/scpi/connection'
import { createDriver, parseNamedValue, parseSuffixed } from '../src/main/drivers/cpx400dp'
import type { PsuDriver } from '../src/main/drivers/types'

describe('parse yardımcıları', () => {
  it('parseNamedValue "V1 5.000" → 5', () => {
    expect(parseNamedValue('V1 5.000')).toBe(5)
    expect(parseNamedValue('DELTAV1 0.500')).toBe(0.5)
  })

  it('parseSuffixed "5.001V" → 5.001, "0.625A" → 0.625', () => {
    expect(parseSuffixed('5.001V')).toBe(5.001)
    expect(parseSuffixed('0.625A')).toBe(0.625)
  })

  it('bozuk girişte Error fırlatır', () => {
    expect(() => parseNamedValue('GARBAGE')).toThrow()
    expect(() => parseSuffixed('yok')).toThrow()
  })
})

describe('Cpx400dpDriver (simülatöre karşı)', () => {
  let sim: SimHandle
  let conn: ScpiConnection
  let driver: PsuDriver

  beforeAll(async () => {
    sim = await startCpx400dpSim(0)
  })

  afterAll(async () => {
    conn?.disconnect()
    await sim.close()
  })

  beforeEach(async () => {
    conn?.disconnect()
    conn = new ScpiConnection('127.0.0.1', sim.port, { timeoutMs: 2000 })
    await conn.connect()
    driver = createDriver('cpx400dp', conn)
    await conn.send('*RST')
    await conn.send('SIM:LOAD1 8')
    await conn.send('SIM:LOAD2 8')
  })

  it('identify kimlik metni döndürür', async () => {
    expect(await driver.identify()).toContain('CPX400DP')
  })

  it('setpoint yazma ve okuma', async () => {
    await driver.setVoltage(1, 12.5)
    await driver.setCurrent(1, 3.75)
    await driver.setOvp(1, 55)
    await driver.setOcp(1, 18)
    const sp = await driver.readSetpoints(1)
    expect(sp).toEqual({ voltage: 12.5, current: 3.75, ovp: 55, ocp: 18 })
  })

  it('readChannel CV senaryosunda ölçümleri döndürür', async () => {
    await driver.setVoltage(1, 5)
    await driver.setCurrent(1, 2)
    await driver.setOutput(1, true)
    const ch = await driver.readChannel(1)
    expect(ch.outputOn).toBe(true)
    expect(ch.voltage).toBeCloseTo(5, 3)
    expect(ch.current).toBeCloseTo(0.625, 3)
  })

  it('readChannel CC senaryosunda akım limitinde kalır', async () => {
    await driver.setVoltage(2, 30)
    await driver.setCurrent(2, 2)
    await driver.setOutput(2, true)
    const ch = await driver.readChannel(2)
    expect(ch.voltage).toBeCloseTo(16, 3)
    expect(ch.current).toBeCloseTo(2, 3)
  })

  it('setAllOutputs iki kanalı da açar', async () => {
    await driver.setAllOutputs(true)
    expect((await driver.readChannel(1)).outputOn).toBe(true)
    expect((await driver.readChannel(2)).outputOn).toBe(true)
    await driver.setAllOutputs(false)
    expect((await driver.readChannel(1)).outputOn).toBe(false)
  })

  it('trip akışı: zorla trip → LSR biti → tripReset → tekrar açılır', async () => {
    await driver.setOutput(1, true)
    await conn.send('SIM:TRIP1 OVP')
    expect((await driver.readChannel(1)).outputOn).toBe(false)
    const lsr = await driver.readLsr(1)
    expect(lsr & 0b100).toBe(0b100)
    await driver.tripReset()
    expect((await driver.readLsr(1)) & 0b100).toBe(0)
    await driver.setOutput(1, true)
    expect((await driver.readChannel(1)).outputOn).toBe(true)
  })

  it('tracking modu yazılır ve okunur', async () => {
    expect(await driver.readTracking()).toBe(false)
    await driver.setTracking(true)
    expect(await driver.readTracking()).toBe(true)
    await driver.setTracking(false)
    expect(await driver.readTracking()).toBe(false)
  })

  it('geçersiz kanal numarası RangeError fırlatır', async () => {
    await expect(driver.readChannel(3)).rejects.toThrow(RangeError)
    await expect(driver.setVoltage(0, 5)).rejects.toThrow(RangeError)
  })
})
