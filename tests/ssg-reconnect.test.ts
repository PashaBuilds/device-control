import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DeviceManager } from '../src/main/deviceManager'
import type { DeviceSnapshot } from '../src/shared/types'
import { FakeHidBackend, type FakeHidDevice } from '../tools/simulator/ssg-hid'
import { SSG_15G_RC_SPEC, SSG_6000RC_SPEC, SsgSim } from '../tools/simulator/ssg-model'

/**
 * Sahada görülen: güç gidip gelince ya da kablo çıkarılıp takılınca sinyal üreteci
 * kendiliğinden geri gelmiyor, kaydı silip eklemek gerekiyordu. Bu senaryolar sahte
 * HID arka ucuyla canlandırılır; her birinde cihaz geri geldiğinde uygulama
 * kendiliğinden "Bağlı" duruma dönmeli.
 */

function waitForState(manager: DeviceManager, id: string, state: DeviceSnapshot['state'], timeoutMs = 10000): Promise<DeviceSnapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      manager.off('snapshot', onSnap)
      reject(new Error(`"${state}" durumu ${timeoutMs} ms içinde gelmedi`))
    }, timeoutMs)
    const onSnap = (s: DeviceSnapshot): void => {
      if (s.id === id && s.state === state) {
        clearTimeout(timer)
        manager.off('snapshot', onSnap)
        resolve(s)
      }
    }
    manager.on('snapshot', onSnap)
  })
}

describe('Sinyal üreteci — kopma sonrası kendiliğinden geri gelme', () => {
  let dir: string
  let devices: FakeHidDevice[]
  let backend: FakeHidBackend
  let manager: DeviceManager
  let id: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dc-ssg-rc-'))
    devices = [
      { path: 'p1', productId: 0x12, sim: new SsgSim(SSG_6000RC_SPEC) },
      { path: 'p2', productId: 0x12, sim: new SsgSim(SSG_15G_RC_SPEC) }
    ]
    backend = new FakeHidBackend(devices)
    manager = new DeviceManager({ dataDir: dir, pollIntervalMs: 50, hidBackend: backend })
    id = (await manager.addDevice({ name: 'SG', kind: 'ssg15grc', host: '', port: 0 })).id
  })

  afterEach(async () => {
    await manager.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('(A) kablo takılınca cihaz bir süre yanıt vermese de vazgeçmez, sonra bağlanır', async () => {
    await manager.connect(id)
    devices[1].unplugged = true
    await waitForState(manager, id, 'reconnecting')
    // Takıldı ama ürün yazılımı henüz açılıyor: ilk denemeler yanıtsız
    devices[1].unplugged = false
    devices[1].silent = true
    await new Promise((r) => setTimeout(r, 2500))
    devices[1].silent = false
    await waitForState(manager, id, 'connected', 15000)
  }, 20000)

  it('(B) güç gidince (USB görünür, cihaz susuyor) yeniden bağlanmaya geçer, güç gelince döner', async () => {
    await manager.connect(id)
    devices[1].silent = true
    await waitForState(manager, id, 'reconnecting', 15000)
    devices[1].silent = false
    await waitForState(manager, id, 'connected', 15000)
  }, 35000)

  it('(C) Windows yeniden takılan cihaza farklı yol verse de bulunur', async () => {
    await manager.connect(id)
    devices[1].unplugged = true
    await waitForState(manager, id, 'reconnecting')
    devices.push({ path: 'p2-yeni', productId: 0x12, sim: devices[1].sim })
    await waitForState(manager, id, 'connected', 15000)
  }, 20000)

  it('(D) sürücü çağrısı takılsa da (okuma/yazma dönmüyor) kopma algılanır ve geri gelinir', async () => {
    await manager.connect(id)
    devices[1].hang = true
    await waitForState(manager, id, 'reconnecting', 15000)
    devices[1].hang = false
    await waitForState(manager, id, 'connected', 15000)
  }, 35000)

  it('(E) cihaz takılı değilken Bağlan’a basılırsa hata gösterilir; takılınca kendiliğinden bağlanır', async () => {
    devices[1].unplugged = true
    await expect(manager.connect(id)).rejects.toThrow(/bulunamadı/)
    devices[1].unplugged = false
    await waitForState(manager, id, 'connected', 15000)
  }, 20000)

  it('Bağlantıyı Kes denince arka planda yeniden denemez', async () => {
    devices[1].unplugged = true
    await expect(manager.connect(id)).rejects.toThrow()
    await manager.disconnect(id)
    devices[1].unplugged = false
    await new Promise((r) => setTimeout(r, 4000))
    const snap = (await manager.listSnapshots()).find((s) => s.id === id)!
    expect(snap.state).toBe('disconnected')
  }, 10000)
})
