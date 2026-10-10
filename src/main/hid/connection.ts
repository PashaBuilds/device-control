import { EventEmitter } from 'node:events'
import type { LogSource } from '@shared/types'
import { MclTimeoutError, mclTransact, type HidBackend, type HidDeviceHandle } from './mcl'

export interface HidScpiConnectionOptions {
  timeoutMs?: number
}

/**
 * Mini-Circuits USB (HID) cihazıyla SCPI iletişimi.
 *
 * ScpiConnection'ın USB karşılığı: komutlar tek sırada işlenir; Mini-Circuits
 * her komutu (set dahil) bir yanıt raporuyla karşıladığı için her komut bir
 * sorgudur. G/Ç hatasında (kablo çekildi) bağlantı kapanır ve 'close' yayılır.
 *
 * Olaylar: 'log' ({dir, line, source}), 'close'
 */
export class HidScpiConnection extends EventEmitter {
  private handle: HidDeviceHandle | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private readonly timeoutMs: number
  private _connected = false
  /** Art arda zaman aşımı sayacı; DeviceManager yeniden bağlanma kararı için okur. */
  consecutiveTimeouts = 0

  constructor(
    private readonly backend: HidBackend,
    readonly path: string,
    opts: HidScpiConnectionOptions = {}
  ) {
    super()
    this.timeoutMs = opts.timeoutMs ?? 1500
  }

  get connected(): boolean {
    return this._connected
  }

  async connect(): Promise<void> {
    if (this._connected) return
    this.handle = await this.backend.open(this.path)
    this._connected = true
  }

  disconnect(): void {
    const handle = this.handle
    this.handle = null
    this._connected = false
    void handle?.close().catch(() => undefined)
  }

  /** Komutu gönderir, yanıt metnini döndürür (set komutları dahil). */
  query(cmd: string, source: LogSource = 'user'): Promise<string> {
    const run = async (): Promise<string> => {
      const handle = this.handle
      if (!this._connected || !handle) throw new Error('disconnected')
      this.emit('log', { dir: 'tx', line: cmd, source })
      let reply: string
      try {
        reply = await mclTransact(handle, cmd, this.timeoutMs)
      } catch (err) {
        if (err instanceof MclTimeoutError) {
          this.consecutiveTimeouts += 1
          throw err
        }
        // Yazma/okuma hatası: cihaz çıkarıldı ya da erişim kayboldu
        this.handleIoError()
        throw new Error(`USB iletişim hatası: ${(err as Error).message}`)
      }
      this.consecutiveTimeouts = 0
      this.emit('log', { dir: 'rx', line: reply, source })
      return reply
    }
    const result = this.chain.then(run, run)
    this.chain = result.catch(() => undefined)
    return result
  }

  private handleIoError(): void {
    if (!this._connected) return
    this.disconnect()
    this.emit('close')
  }
}
