import { EventEmitter } from 'node:events'
import net from 'node:net'

export interface ScpiConnectionOptions {
  timeoutMs?: number
}

export type LogSource = 'user' | 'poll'

interface QueueItem {
  cmd: string
  expectsResponse: boolean
  source: LogSource
  resolve: (value: string) => void
  reject: (err: Error) => void
}

/**
 * Ham TCP üzerinden satır bazlı SCPI iletişimi.
 *
 * Tüm komutlar tek FIFO kuyruktan geçer; sorgu (`query`) yanıtı gelmeden
 * sonraki komut yazılmaz. Cihaz sorguları geliş sırasıyla yanıtladığı için
 * istek-yanıt eşleştirmesi bu sırayla garanti edilir.
 *
 * Olaylar: 'state' (ConnectionState benzeri metin), 'log' ({dir, line}), 'close'
 */
export class ScpiConnection extends EventEmitter {
  private socket: net.Socket | null = null
  private buffer = ''
  private queue: QueueItem[] = []
  private inFlight: QueueItem | null = null
  private timeoutTimer: NodeJS.Timeout | null = null
  private readonly timeoutMs: number
  private _connected = false
  /** Art arda zaman aşımı sayacı; DeviceManager yeniden bağlanma kararı için okur. */
  consecutiveTimeouts = 0

  constructor(
    private readonly host: string,
    private readonly port: number,
    opts: ScpiConnectionOptions = {}
  ) {
    super()
    this.timeoutMs = opts.timeoutMs ?? 3000
  }

  get connected(): boolean {
    return this._connected
  }

  connect(): Promise<void> {
    if (this._connected) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port })
      socket.setNoDelay(true)

      const onError = (err: Error): void => {
        socket.destroy()
        reject(err)
      }

      socket.once('error', onError)
      socket.once('connect', () => {
        socket.off('error', onError)
        this.socket = socket
        this._connected = true
        this.buffer = ''
        socket.on('data', (d) => this.onData(d))
        socket.on('error', () => {
          /* close olayı üzerinden ele alınır */
        })
        socket.on('close', () => this.handleClose())
        this.emit('state', 'connected')
        resolve()
      })
    })
  }

  disconnect(): void {
    const socket = this.socket
    this.socket = null
    this._connected = false
    if (socket) {
      socket.removeAllListeners('close')
      socket.destroy()
    }
    this.failAll(new Error('disconnected'))
    this.emit('state', 'disconnected')
  }

  /** Yanıt bekleyen komut. Tek satır yanıt döner (CR/LF kırpılmış). */
  query(cmd: string, source: LogSource = 'user'): Promise<string> {
    return this.enqueue(cmd, true, source)
  }

  /** Yanıt beklemeyen komut. Kuyruk sırası korunarak yazılır. */
  send(cmd: string, source: LogSource = 'user'): Promise<void> {
    return this.enqueue(cmd, false, source).then(() => undefined)
  }

  private enqueue(cmd: string, expectsResponse: boolean, source: LogSource): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (!this._connected || !this.socket) {
        reject(new Error('disconnected'))
        return
      }
      this.queue.push({ cmd, expectsResponse, source, resolve, reject })
      this.pump()
    })
  }

  private pump(): void {
    if (this.inFlight || this.queue.length === 0) return
    if (!this._connected || !this.socket) {
      this.failAll(new Error('disconnected'))
      return
    }
    const item = this.queue.shift()!
    this.emit('log', { dir: 'tx', line: item.cmd, source: item.source })
    this.socket.write(item.cmd + '\n')

    if (!item.expectsResponse) {
      item.resolve('')
      // Yazım sırası socket.write kuyruğuyla korunur; sonraki komuta geç.
      this.pump()
      return
    }

    this.inFlight = item
    this.timeoutTimer = setTimeout(() => {
      this.timeoutTimer = null
      if (this.inFlight === item) {
        this.inFlight = null
        this.consecutiveTimeouts += 1
        item.reject(new Error(`timeout: "${item.cmd}" ${this.timeoutMs}ms içinde yanıtlanmadı`))
        this.pump()
      }
    }, this.timeoutMs)
  }

  private onData(data: Buffer | string): void {
    this.buffer += typeof data === 'string' ? data : data.toString('ascii')
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, '')
      this.buffer = this.buffer.slice(idx + 1)
      this.emit('log', { dir: 'rx', line, source: this.inFlight?.source ?? 'user' })
      const item = this.inFlight
      if (item) {
        this.inFlight = null
        if (this.timeoutTimer) {
          clearTimeout(this.timeoutTimer)
          this.timeoutTimer = null
        }
        this.consecutiveTimeouts = 0
        item.resolve(line)
        this.pump()
      }
      // Beklenmeyen (eşleşmeyen) satırlar loglanır ve yok sayılır.
    }
  }

  private handleClose(): void {
    if (!this._connected) return
    this._connected = false
    this.socket = null
    this.failAll(new Error('bağlantı koptu'))
    this.emit('state', 'disconnected')
    this.emit('close')
  }

  private failAll(err: Error): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer)
      this.timeoutTimer = null
    }
    const pending = this.inFlight ? [this.inFlight, ...this.queue] : [...this.queue]
    this.inFlight = null
    this.queue = []
    for (const item of pending) item.reject(err)
  }
}
