/**
 * Sahte Mini-Circuits HID arka ucu: SsgSim örneklerini gerçek USB raporu
 * biçimiyle (rapor kimliği + 64 bayt, bayt 0 = kesme kodu) konuşturur.
 *
 * Testlerde ve `DC_FAKE_HID=1` ile başlatılan uygulamada (donanımsız
 * arayüz denemesi / e2e) gerçek node-hid yerine kullanılır.
 */
import type { HidBackend, HidDeviceEntry, HidDeviceHandle } from '../../src/main/hid/mcl'
import { MCL_VENDOR_ID } from '../../src/main/hid/mcl'
import { SSG_15G_RC_SPEC, SSG_6000RC_SPEC, SsgSim } from './ssg-model'

export interface FakeHidDevice {
  path: string
  productId: number
  sim: SsgSim
  /** true: hiçbir rapora yanıt vermez (ör. güç gitti ama USB görünür, ya da açılıyor) */
  silent?: boolean
  unplugged?: boolean
  /** true: okuma/yazma çağrıları hiç dönmez (sürücü/işletim sistemi takılması taklidi) */
  hang?: boolean
}

class FakeHandle implements HidDeviceHandle {
  private inbox: Uint8Array[] = []
  private waiter: (() => void) | null = null
  private closed = false

  constructor(private readonly dev: FakeHidDevice) {}

  private check(): void {
    if (this.closed) throw new Error('device closed')
    if (this.dev.unplugged) throw new Error('could not write to HID device')
  }

  async write(data: Buffer): Promise<void> {
    if (this.dev.hang) return new Promise<void>(() => undefined)
    this.check()
    // data[0] rapor kimliği (0), data[1..64] rapor
    if (this.dev.silent) return
    this.inbox.push(this.dev.sim.handleReport(data.subarray(1)))
    this.waiter?.()
  }

  async read(timeoutMs: number): Promise<Uint8Array | null> {
    if (this.dev.hang) return new Promise<Uint8Array | null>(() => undefined)
    this.check()
    if (this.inbox.length === 0 && timeoutMs > 0) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          this.waiter = null
          resolve()
        }, timeoutMs)
        this.waiter = () => {
          clearTimeout(t)
          this.waiter = null
          resolve()
        }
      })
      this.check()
    }
    return this.inbox.shift() ?? null
  }

  async close(): Promise<void> {
    this.closed = true
    this.waiter?.()
  }
}

export class FakeHidBackend implements HidBackend {
  constructor(readonly devices: FakeHidDevice[]) {}

  async enumerate(): Promise<HidDeviceEntry[]> {
    return this.devices
      .filter((d) => !d.unplugged)
      .map((d) => ({
        path: d.path,
        vendorId: MCL_VENDOR_ID,
        productId: d.productId,
        manufacturer: 'Mini-Circuits',
        product: d.sim.spec.model,
        serialNumber: '',
        usagePage: 0xff00,
        usage: 1,
        interface: 0
      }))
  }

  async enumerateAll(): Promise<HidDeviceEntry[]> {
    // Gerçek sistemdeki gibi başka HID aygıtları da görünsün
    const keyboard = { path: 'fake-kbd', vendorId: 0x046d, productId: 0xc31c, manufacturer: 'Logitech', product: 'USB Keyboard' }
    return [keyboard, ...(await this.enumerate())]
  }

  async describe(): Promise<string> {
    return 'sahte HID arka ucu (DC_FAKE_HID)'
  }

  async open(path: string): Promise<HidDeviceHandle> {
    const dev = this.devices.find((d) => d.path === path && !d.unplugged)
    if (!dev) throw new Error(`cannot open device with path ${path}`)
    return new FakeHandle(dev)
  }
}

/** DC_FAKE_HID için: bir SSG-6000RC ve bir SSG-15G-RC takılıymış gibi. */
export function createDemoFakeHidBackend(): FakeHidBackend {
  return new FakeHidBackend([
    { path: 'fake-hid-1', productId: 0x0022, sim: new SsgSim(SSG_6000RC_SPEC) },
    { path: 'fake-hid-2', productId: 0x0022, sim: new SsgSim(SSG_15G_RC_SPEC) }
  ])
}
