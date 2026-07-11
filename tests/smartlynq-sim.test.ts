import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startSmartLynqSim, SmartLynqSimHandle } from '../tools/simulator/smartlynq-sim'
import { TcfConnection } from '../src/main/tcf/connection'

describe('SmartLynqSim (TCF hw_server taklidi)', () => {
  let sim: SmartLynqSimHandle
  let conn: TcfConnection

  beforeAll(async () => {
    sim = await startSmartLynqSim(0)
    conn = new TcfConnection('127.0.0.1', sim.port, { timeoutMs: 2000 })
    await conn.connect()
  })

  afterAll(async () => {
    conn.disconnect()
    await sim.close()
  })

  it('Hello ile hw_server benzeri servis listesi bildirir', () => {
    expect(conn.services).toContain('Locator')
    expect(conn.services).toContain('Jtag')
    expect(conn.services).toContain('JtagCable')
  })

  it('Locator sync yanıtlar (ping)', async () => {
    await expect(conn.command('Locator', 'sync')).resolves.toEqual([])
  })

  it('Locator getAgentID kimlik döndürür', async () => {
    const [err, id] = await conn.command('Locator', 'getAgentID')
    expect(err).toBe('null')
    expect(JSON.parse(id)).toMatch(/sim/i)
  })

  it('Jtag getChildren kök için port listesi döndürür', async () => {
    const [err, children] = await conn.command('Jtag', 'getChildren', ['""'])
    expect(err).toBe('null')
    expect(JSON.parse(children)).toEqual(['port0'])
  })

  it('Jtag getChildren port için cihaz listesi, getContext ad+idCode döndürür', async () => {
    const [, children] = await conn.command('Jtag', 'getChildren', ['"port0"'])
    const ids: string[] = JSON.parse(children)
    expect(ids.length).toBe(2) // arm_dap + xc7z045
    const ctxs = await Promise.all(
      ids.map(async (id) => JSON.parse((await conn.command('Jtag', 'getContext', [JSON.stringify(id)]))[1]))
    )
    const names = ctxs.map((c) => c.Name)
    expect(names).toContain('xc7z045')
    expect(names).toContain('arm_dap')
    const zynq = ctxs.find((c) => c.Name === 'xc7z045')
    expect(zynq.idCode).toBe('0x23731093')
    expect(zynq.irLen).toBe(6)
  })

  it('tanınmayan komuta N döner', async () => {
    await expect(conn.command('Jtag', 'olmayanKomut')).rejects.toThrow(/desteklemiyor/i)
  })
})
