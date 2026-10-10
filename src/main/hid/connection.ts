import { EventEmitter } from 'node:events'
import type { LogSource } from '@shared/types'
import { MclTimeoutError, mclRequest, type HidBackend, type HidDeviceHandle } from './mcl'

export interface HidMclConnectionOptions {
  timeoutMs?: number
}

/** Konsol/günlük için insan okunur satırlar: gönderilen komutun adı ve yanıtın özeti. */
export interface RequestLog {
  tx: string
  rx: (reply: Uint8Array) => string
}

/**
 * Mini-Circuits USB (HID) cihazıyla istek/yanıt iletişimi.
 *
 * ScpiConnection'ın USB karşılığı: komut raporları tek sırada işlenir; her komut
 * aynı kodla başlayan bir yanıt raporu alır. G/Ç hatasında (kablo çekildi) bağlantı
 * kapanır ve 'close' yayılır.
 *
 * Olaylar: 'log' ({dir, line, source}), 'close'
 */
export class HidMclConnection extends EventEmitter {
  private handle: HidDeviceHandle | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private readonly timeoutMs: number
  private _connected = false
  /** Art arda zaman aşımı sayacı; DeviceManager yeniden bağlanma kararı için okur. */
  consecutiveTimeouts = 0

  constructor(
    private readonly backend: HidBackend,
    readonly path: string,
    opts: HidMclConnectionOptions = {}
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

  /** Komut raporunu gönderir, yanıt raporunu döndürür. */
  request(body: number[], source: LogSource, log: RequestLog): Promise<Uint8Array> {
    const run = async (): Promise<Uint8Array> => {
      const handle = this.handle
      if (!this._connected || !handle) throw new Error('disconnected')
      this.emit('log', { dir: 'tx', line: log.tx, source })
      let reply: Uint8Array
      try {
        reply = await mclRequest(handle, body, this.timeoutMs)
      } catch (err) {
        if (err instanceof MclTimeoutError) {
          this.consecutiveTimeouts += 1
          throw new Error(`timeout: "${log.tx}" ${this.timeoutMs}ms içinde yanıtlanmadı`)
        }
        // Yazma/okuma hatası: cihaz çıkarıldı ya da erişim kayboldu
        this.handleIoError()
        throw new Error(`USB iletişim hatası: ${(err as Error).message}`)
      }
      this.consecutiveTimeouts = 0
      this.emit('log', { dir: 'rx', line: log.rx(reply), source })
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
