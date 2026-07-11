import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startCpx400dpSim, SimHandle } from '../tools/simulator/cpx400dp-sim'
import { startSmartLynqSim } from '../tools/simulator/smartlynq-sim'
import { DeviceManager } from '../src/main/deviceManager'
import type { DeviceSnapshot } from '../src/shared/types'

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

describe('DeviceManager (simülatöre karşı)', () => {
  let sim: SimHandle
  let dir: string
  let manager: DeviceManager

  beforeEach(async () => {
    sim = await startCpx400dpSim(0)
    dir = mkdtempSync(join(tmpdir(), 'dc-test-'))
    manager = new DeviceManager({ dataDir: dir, pollIntervalMs: 50 })
  })

  afterEach(async () => {
    await manager.dispose()
    await sim.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function addAndConnect(): Promise<string> {
    const cfg = await manager.addDevice({
      name: 'Test PSU',
      kind: 'cpx400dp',
      host: '127.0.0.1',
      port: sim.port
    })
    await manager.connect(cfg.id)
    return cfg.id
  }

  it('cihaz ekler, kalıcılaştırır ve listeler', async () => {
    const cfg = await manager.addDevice({
      name: 'Sol PSU',
      kind: 'cpx400dp',
      host: '10.0.0.5',
      port: 9221
    })
    expect(cfg.id).toBeTruthy()
    expect(await manager.listDevices()).toHaveLength(1)
    expect(existsSync(join(dir, 'devices.json'))).toBe(true)
    // yeni manager aynı dizinden okur
    const manager2 = new DeviceManager({ dataDir: dir, pollIntervalMs: 50 })
    expect(await manager2.listDevices()).toEqual([cfg])
    await manager2.dispose()
  })

  it('bağlanınca connected snapshot ve kimlik gelir', async () => {
    const id = await addAndConnect()
    const snap = await waitForSnapshot(manager, (s) => s.id === id && s.state === 'connected')
    expect(snap.identity).toContain('CPX400DP')
    expect(snap.setpoints).toHaveLength(2)
  })

  it('setpoint değişikliği anında doğrulanmış snapshot üretir', async () => {
    const id = await addAndConnect()
    await waitForSnapshot(manager, (s) => s.state === 'connected')
    await manager.setVoltage(id, 1, 7.25)
    const snap = await waitForSnapshot(manager, (s) => s.setpoints[0]?.voltage === 7.25)
    expect(snap.setpoints[0].voltage).toBe(7.25)
  })

  it('polling ölçümleri yayınlar (CV modu)', async () => {
    const id = await addAndConnect()
    await waitForSnapshot(manager, (s) => s.state === 'connected')
    await manager.setVoltage(id, 1, 5)
    await manager.setCurrent(id, 1, 2)
    await manager.setOutput(id, 1, true)
    const snap = await waitForSnapshot(
      manager,
      (s) => s.channels[0]?.outputOn === true && Math.abs(s.channels[0].voltage - 5) < 0.01
    )
    expect(snap.channels[0].mode).toBe('cv')
    expect(snap.channels[0].power).toBeCloseTo(5 * 0.625, 2)
  })

  it('CC modunu ölçümden türetir', async () => {
    const id = await addAndConnect()
    await waitForSnapshot(manager, (s) => s.state === 'connected')
    await manager.setVoltage(id, 1, 30)
    await manager.setCurrent(id, 1, 2)
    await manager.setOutput(id, 1, true)
    const snap = await waitForSnapshot(manager, (s) => s.channels[0]?.mode === 'cc')
    expect(snap.channels[0].current).toBeCloseTo(2, 2)
  })

  it('trip tespit edilir ve tripReset temizler', async () => {
    const id = await addAndConnect()
    await waitForSnapshot(manager, (s) => s.state === 'connected')
    await manager.setOutput(id, 1, true)
    await manager.sendRaw(id, 'SIM:TRIP1 OVP')
    const tripped = await waitForSnapshot(manager, (s) => s.trips.length > 0)
    expect(tripped.trips[0]).toEqual({ channel: 1, kind: 'ovp' })
    await manager.tripReset(id)
    await waitForSnapshot(manager, (s) => s.trips.length === 0)
  })

  it('sendRaw sorguya yanıt, komuta null döner', async () => {
    const id = await addAndConnect()
    await waitForSnapshot(manager, (s) => s.state === 'connected')
    expect(await manager.sendRaw(id, '*IDN?')).toContain('CPX400DP')
    expect(await manager.sendRaw(id, 'V1 3')).toBeNull()
  })

  it('disconnect durumu günceller, removeDevice kalıcılıktan siler', async () => {
    const id = await addAndConnect()
    await waitForSnapshot(manager, (s) => s.state === 'connected')
    const disconnected = waitForSnapshot(manager, (s) => s.state === 'disconnected')
    await manager.disconnect(id)
    const snap = await disconnected
    expect(snap.id).toBe(id)
    await manager.removeDevice(id)
    expect(await manager.listDevices()).toHaveLength(0)
    expect(JSON.parse(readFileSync(join(dir, 'devices.json'), 'utf8'))).toEqual([])
  })

  it('kilitliyken setpoint komutları reddedilir, çıkış kontrolü çalışır', async () => {
    const id = await addAndConnect()
    await waitForSnapshot(manager, (s) => s.state === 'connected')
    const cfg = (await manager.listDevices())[0]
    await manager.updateDevice({ ...cfg, locked: true })

    await expect(manager.setVoltage(id, 1, 5)).rejects.toThrow(/kili[td]/i)
    await expect(manager.setCurrent(id, 1, 2)).rejects.toThrow(/kili[td]/i)
    await expect(manager.setOvp(id, 1, 50)).rejects.toThrow(/kili[td]/i)
    await expect(manager.setOcp(id, 1, 10)).rejects.toThrow(/kili[td]/i)
    await expect(manager.setTracking(id, true)).rejects.toThrow(/kili[td]/i)
    // cihaza hiçbir set komutu gitmedi
    expect(sim.sim.channels[0].vSet).toBe(1)

    // çıkış kontrolü kilitten etkilenmez (acil kapatma her zaman mümkün olmalı)
    await manager.setOutput(id, 1, true)
    expect(sim.sim.channels[0].outputOn).toBe(true)
    await manager.setAllOutputs(id, false)
    expect(sim.sim.channels[0].outputOn).toBe(false)

    // kilit kalıcı: yeni manager aynı dizinden locked okur
    const manager2 = new DeviceManager({ dataDir: dir, pollIntervalMs: 50 })
    expect((await manager2.listDevices())[0].locked).toBe(true)
    await manager2.dispose()

    // kilit açılınca komutlar tekrar çalışır
    await manager.updateDevice({ ...cfg, locked: false })
    await manager.setVoltage(id, 1, 5)
    expect(sim.sim.channels[0].vSet).toBe(5)
  })

  it('smartlynq cihazına bağlanır, probe bilgisi yayınlar, PSU komutlarını reddeder', async () => {
    const lynq = await startSmartLynqSim(0)
    try {
      const cfg = await manager.addDevice({
        name: 'Lynq 1',
        kind: 'smartlynq',
        host: '127.0.0.1',
        port: lynq.port
      })
      const connectedSnap = waitForSnapshot(
        manager,
        (s) => s.id === cfg.id && s.state === 'connected' && s.probe !== null
      )
      await manager.connect(cfg.id)
      const snap = await connectedSnap
      expect(snap.probe!.services).toContain('Jtag')
      expect(snap.probe!.agentId).toMatch(/sim/i)
      expect(snap.probe!.jtagTargets).toContain('xc7z045')
      expect(snap.identity).toContain('hw_server')
      expect(snap.channels).toHaveLength(0)

      // PSU'ya özgü komutlar bu türde reddedilir
      await expect(manager.setVoltage(cfg.id, 1, 5)).rejects.toThrow(/desteklenmiyor/i)
      await expect(manager.setAllOutputs(cfg.id, true)).rejects.toThrow(/desteklenmiyor/i)

      // Ham TCF komutu konsoldan çalışır
      const reply = await manager.sendRaw(cfg.id, 'Locator getAgentID')
      expect(reply).toContain('sim')

      const disconnected = waitForSnapshot(manager, (s) => s.id === cfg.id && s.state === 'disconnected')
      await manager.disconnect(cfg.id)
      await disconnected
    } finally {
      await lynq.close()
    }
  })

  it('bağlantı koptuğunda reconnecting durumuna geçer ve sunucu dönünce bağlanır', async () => {
    const id = await addAndConnect()
    await waitForSnapshot(manager, (s) => s.state === 'connected')
    const port = sim.port
    await sim.close()
    await waitForSnapshot(manager, (s) => s.state === 'reconnecting', 8000)
    sim = await startCpx400dpSim(port)
    await waitForSnapshot(manager, (s) => s.state === 'connected', 8000)
    // id hâlâ aynı cihaz
    expect((await manager.listDevices())[0].id).toBe(id)
  })
})
