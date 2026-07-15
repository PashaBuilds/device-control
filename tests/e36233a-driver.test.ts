import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { startE36233aSim, E36233aSimHandle } from '../tools/simulator/e36233a-sim'
import { ScpiConnection } from '../src/main/scpi/connection'
import { createDriver } from '../src/main/drivers/cpx400dp'
import type { PsuDriver } from '../src/main/drivers/types'

const LSR_OVP = 0b0100
const LSR_OCP = 0b1000

describe('E36233aDriver (simülatöre karşı)', () => {
  let sim: E36233aSimHandle
  let conn: ScpiConnection
  let driver: PsuDriver

  beforeAll(async () => {
    sim = await startE36233aSim(0)
  })
  afterAll(async () => {
    conn?.disconnect()
    await sim.close()
  })
  beforeEach(async () => {
    conn?.disconnect()
    conn = new ScpiConnection('127.0.0.1', sim.port, { timeoutMs: 2000 })
    await conn.connect()
    driver = createDriver('e36233a', conn)
    await conn.send('*RST')
    await conn.send('SIM:LOAD1 10')
    await conn.send('SIM:LOAD2 10')
  })

  it('identify Keysight kimliği', async () => {
    expect(await driver.identify()).toContain('E36233A')
  })

  it('setpoint yaz/oku (OVP dahil, OCP seviyesi yok → 0)', async () => {
    await driver.setVoltage(1, 12.5)
    await driver.setCurrent(1, 3.25)
    await driver.setOvp(1, 28)
    const sp = await driver.readSetpoints(1)
    expect(sp.voltage).toBeCloseTo(12.5, 3)
    expect(sp.current).toBeCloseTo(3.25, 3)
    expect(sp.ovp).toBeCloseTo(28, 3)
    expect(sp.ocp).toBe(0)
  })

  it('readChannel CV ölçümleri', async () => {
    await driver.setVoltage(1, 5)
    await driver.setCurrent(1, 2)
    await driver.setOutput(1, true)
    const ch = await driver.readChannel(1)
    expect(ch.outputOn).toBe(true)
    expect(ch.voltage).toBeCloseTo(5, 2)
    expect(ch.current).toBeCloseTo(0.5, 2)
  })

  it('readChannel CC ölçümleri', async () => {
    await driver.setVoltage(2, 20)
    await driver.setCurrent(2, 1)
    await driver.setOutput(2, true)
    const ch = await driver.readChannel(2)
    expect(ch.voltage).toBeCloseTo(10, 2)
    expect(ch.current).toBeCloseTo(1, 2)
  })

  it('setAllOutputs ikisini açar', async () => {
    await driver.setAllOutputs(true)
    expect((await driver.readChannel(1)).outputOn).toBe(true)
    expect((await driver.readChannel(2)).outputOn).toBe(true)
  })

  it('OVP trip readLsr bit2, tripReset temizler', async () => {
    await driver.setOutput(1, true)
    await conn.send('SIM:TRIP1 OVP')
    expect((await driver.readChannel(1)).outputOn).toBe(false)
    expect((await driver.readLsr(1)) & LSR_OVP).toBe(LSR_OVP)
    await driver.tripReset()
    expect((await driver.readLsr(1)) & LSR_OVP).toBe(0)
  })

  it('OCP: setOcp OCP korumasını etkinleştirir, CC modunda triplenir (bit3)', async () => {
    await driver.setOcp(1, 5) // seviye yok sayılır; koruma etkinleşir
    await driver.setVoltage(1, 20)
    await driver.setCurrent(1, 1)
    await driver.setOutput(1, true)
    await driver.readChannel(1) // CC tespiti
    expect((await driver.readLsr(1)) & LSR_OCP).toBe(LSR_OCP)
  })

  it('readTracking false, setTracking hata vermez', async () => {
    expect(await driver.readTracking()).toBe(false)
    await expect(driver.setTracking(true)).resolves.toBeUndefined()
  })

  it('readExecutionError aralık dışında pozitif kod döndürür', async () => {
    await driver.setVoltage(1, 999)
    expect(await driver.readExecutionError()).toBeGreaterThan(0)
    expect(await driver.readExecutionError()).toBe(0)
  })

  it('geçersiz kanal RangeError', async () => {
    await expect(driver.readChannel(3)).rejects.toThrow(RangeError)
  })
})
