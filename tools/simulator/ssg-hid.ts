/**
 * Sahte Mini-Circuits HID arka ucu: SsgSim örneklerini gerçek USB raporu
 * biçimiyle (rapor kimliği + 64 bayt, kod 1 = SCPI) konuşturur.
 *
 * Testlerde ve `DC_FAKE_HID=1` ile başlatılan uygulamada (donanımsız
 * arayüz denemesi / e2e) gerçek node-hid yerine kullanılır.
 */
import type { HidBackend, HidDeviceEntry, HidDeviceHandle } from '../../src/main/hid/mcl'
import { MCL_REPORT_SIZE, MCL_SCPI_CODE, MCL_VENDOR_ID } from '../../src/main/hid/mcl'
import { SSG_15G_RC_SPEC, SSG_6000RC_SPEC, SsgSim } from './ssg-model'

export interface FakeHidDevice {
  path: string
  productId: number
  sim: SsgSim
  /** true: hiçbir rapora yanıt vermez */
  silent?: boolean
  /**
   * true: SCPI'yi (kod 1) tanımaz, yalnızca ikili model/seri kodlarına (40/41)
   * yanıt verir — eski ürün yazılımı taklidi (tanılama raporu testi için)
   */
  legacy?: boolean
  unplugged?: boolean
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
    this.check()
    // data[0] rapor kimliği (0), data[1..64] rapor
    const report = data.subarray(1)
    if (this.dev.silent) return
    if (this.dev.legacy) {
      if (report[0] === MCL_SCPI_CODE) {
        // Gerçek eski cihazdaki gibi: kod 1'e metin değil ikili durum verisi
        const reply = Buffer.alloc(MCL_REPORT_SIZE, 0xff)
        reply[0] = MCL_SCPI_CODE
        reply.set([0x02, 0x9c, 0x36, 0x45], 1)
        this.inbox.push(reply)
        this.waiter?.()
        return
      }
      if (report[0] === 40 || report[0] === 41) {
        const reply = Buffer.alloc(MCL_REPORT_SIZE)
        reply[0] = report[0]
        const spec = this.dev.sim.spec
        Buffer.from(report[0] === 40 ? spec.model : spec.serial, 'ascii').copy(reply, 1)
        this.inbox.push(reply)
        this.waiter?.()
      }
      return
    }
    if (report[0] !== MCL_SCPI_CODE) return
    let end = 1
    while (end < report.length && report[end] !== 0) end++
    const cmd = Buffer.from(report.subarray(1, end)).toString('ascii')
    const reply = Buffer.alloc(MCL_REPORT_SIZE)
    reply[0] = MCL_SCPI_CODE
    Buffer.from(this.dev.sim.handle(cmd), 'ascii').copy(reply, 1, 0, MCL_REPORT_SIZE - 2)
    this.inbox.push(reply)
    this.waiter?.()
  }

  async read(timeoutMs: number): Promise<Uint8Array | null> {
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
