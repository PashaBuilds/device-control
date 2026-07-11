import { afterEach, describe, expect, it } from 'vitest'
import { startCpx400dpSim, SimHandle } from '../tools/simulator/cpx400dp-sim'
import { startSmartLynqSim, SmartLynqSimHandle } from '../tools/simulator/smartlynq-sim'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { scanHosts, probeHost } from '../src/main/discovery'

/** Hiçbir şey konuşmayan ama portu açık tutan sahte sunucu (yanlış-pozitif testi). */
function startSilentServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer(() => {
    /* sessiz */
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () => new Promise((r) => server.close(() => r()))
      })
    )
  })
}

describe('probeHost', () => {
  let psu: SimHandle | undefined
  let lynq: SmartLynqSimHandle | undefined
  let silent: { port: number; close: () => Promise<void> } | undefined

  afterEach(async () => {
    await psu?.close()
    await lynq?.close()
    await silent?.close()
    psu = lynq = silent = undefined
  })

  it('CPX400DP portunu tanır', async () => {
    psu = await startCpx400dpSim(0)
    const res = await probeHost('127.0.0.1', psu.port, 1000, 'cpx400dp')
    expect(res).not.toBeNull()
    expect(res!.kind).toBe('cpx400dp')
    expect(res!.identity).toContain('CPX400DP')
  })

  it('SmartLynq portunu tanır', async () => {
    lynq = await startSmartLynqSim(0)
    const res = await probeHost('127.0.0.1', lynq.port, 1000, 'smartlynq')
    expect(res).not.toBeNull()
    expect(res!.kind).toBe('smartlynq')
  })

  it('kapalı portta null döner', async () => {
    // kullanılmayan bir port: kısa timeout'la reddedilir
    const res = await probeHost('127.0.0.1', 1, 500)
    expect(res).toBeNull()
  })

  it('yanıt vermeyen açık portta (yanlış pozitif) null döner', async () => {
    silent = await startSilentServer()
    const res = await probeHost('127.0.0.1', silent.port, 600)
    expect(res).toBeNull()
  })

  it('CPX400DP portunda TCF beklenen tür sorulursa null (protokol uyuşmazlığı)', async () => {
    psu = await startCpx400dpSim(0)
    // PSU portuna smartlynq beklentisiyle bakılırsa TCF Hello gelmez → null
    const res = await probeHost('127.0.0.1', psu.port, 800, 'smartlynq')
    expect(res).toBeNull()
  })
})

describe('scanHosts', () => {
  let psu: SimHandle
  let lynq: SmartLynqSimHandle

  afterEach(async () => {
    await psu?.close()
    await lynq?.close()
  })

  it('verilen host/port listesinde iki cihazı da bulur', async () => {
    psu = await startCpx400dpSim(0)
    lynq = await startSmartLynqSim(0)
    const found = await scanHosts({
      hosts: ['127.0.0.1'],
      ports: [
        { port: psu.port, kind: 'cpx400dp' },
        { port: lynq.port, kind: 'smartlynq' }
      ],
      timeoutMs: 1000,
      concurrency: 8
    })
    const kinds = found.map((f) => f.kind).sort()
    expect(kinds).toEqual(['cpx400dp', 'smartlynq'])
    expect(found.every((f) => f.host === '127.0.0.1')).toBe(true)
  })
})
