import { EventEmitter } from 'node:events'
import net from 'node:net'

/**
 * TCF (Target Communication Framework) bağlantısı — Xilinx hw_server /
 * SmartLynq cihazları TCP 3121'de bu protokolü konuşur.
 *
 * Çerçeveleme: her mesaj NUL ('\0') ile sonlanan parçalardan oluşur ve
 * EOM işareti (0x03 0x01) ile biter.
 *   Olay:   E \0 <servis> \0 <olay> \0 <argümanlar...> EOM
 *   Komut:  C \0 <token> \0 <servis> \0 <komut> \0 <argümanlar...> EOM
 *   Yanıt:  R \0 <token> \0 <argümanlar...> EOM
 *   Tanınmayan komut: N \0 <token> EOM
 *
 * Kanal açılışında iki taraf da Locator Hello olayı gönderir; karşı tarafın
 * Hello'su desteklediği servislerin listesini içerir.
 */

const EOM = Buffer.from([0x03, 0x01])

export function encodeTcfMessage(parts: string[]): Buffer {
  const body = parts.map((p) => p + '\0').join('')
  return Buffer.concat([Buffer.from(body, 'utf8'), EOM])
}

/** Gelen bayt akışını TCF mesajlarına (parça dizilerine) böler. */
export class TcfDecoder {
  private buffer = Buffer.alloc(0)

  push(data: Buffer): string[][] {
    this.buffer = Buffer.concat([this.buffer, data])
    const messages: string[][] = []
    let eomIdx: number
    while ((eomIdx = this.buffer.indexOf(EOM)) >= 0) {
      const raw = this.buffer.subarray(0, eomIdx)
      this.buffer = this.buffer.subarray(eomIdx + EOM.length)
      const text = raw.toString('utf8')
      // Parçalar NUL ile SONLANIR; son eleman boş kalır, at
      const parts = text.split('\0')
      if (parts[parts.length - 1] === '') parts.pop()
      messages.push(parts)
    }
    return messages
  }
}

export interface TcfConnectionOptions {
  timeoutMs?: number
}

export type LogSource = 'user' | 'poll'

interface PendingCommand {
  resolve: (args: string[]) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
  label: string
  source: LogSource
}

export class TcfConnection extends EventEmitter {
  private socket: net.Socket | null = null
  private readonly decoder = new TcfDecoder()
  private readonly timeoutMs: number
  private tokenCounter = 0
  private pending = new Map<string, PendingCommand>()
  private _connected = false
  /** Karşı tarafın Hello ile bildirdiği servisler. */
  services: string[] = []

  constructor(
    private readonly host: string,
    private readonly port: number,
    opts: TcfConnectionOptions = {}
  ) {
    super()
    this.timeoutMs = opts.timeoutMs ?? 4000
  }

  get connected(): boolean {
    return this._connected
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port })
      socket.setNoDelay(true)

      const connectTimer = setTimeout(() => {
        socket.destroy()
        reject(new Error(`TCF Hello ${this.timeoutMs}ms içinde gelmedi`))
      }, this.timeoutMs)

      const onError = (err: Error): void => {
        clearTimeout(connectTimer)
        socket.destroy()
        reject(err)
      }
      socket.once('error', onError)

      socket.once('connect', () => {
        // Kendi Hello'muzu gönder (Locator servisi sunuyoruz)
        socket.write(encodeTcfMessage(['E', 'Locator', 'Hello', '["Locator"]']))
        this.emit('log', { dir: 'tx', line: 'E Locator Hello ["Locator"]', source: 'user' })
      })

      socket.on('data', (d: Buffer | string) => {
        const buf = typeof d === 'string' ? Buffer.from(d) : d
        for (const msg of this.decoder.push(buf)) {
          this.emit('log', { dir: 'rx', line: msg.join(' '), source: this.sourceOf(msg) })
          if (!this._connected) {
            // İlk beklenen mesaj: karşı tarafın Hello olayı
            if (msg[0] === 'E' && msg[1] === 'Locator' && msg[2] === 'Hello') {
              try {
                this.services = JSON.parse(msg[3] ?? '[]')
              } catch {
                this.services = []
              }
              this._connected = true
              this.socket = socket
              socket.off('error', onError)
              socket.on('error', () => undefined)
              socket.on('close', () => this.handleClose())
              clearTimeout(connectTimer)
              this.emit('state', 'connected')
              resolve()
            }
            continue
          }
          this.dispatch(msg)
        }
      })
    })
  }

  /** Gelen mesajın hangi kaynağa ait olduğunu (token eşleşmesiyle) bulur. */
  private sourceOf(msg: string[]): LogSource {
    if (msg[0] === 'R' || msg[0] === 'P' || msg[0] === 'N') {
      return this.pending.get(msg[1])?.source ?? 'user'
    }
    return 'user'
  }

  private dispatch(msg: string[]): void {
    const [type] = msg
    if (type === 'R' || type === 'P') {
      const token = msg[1]
      const cmd = this.pending.get(token)
      if (!cmd) return
      if (type === 'P') return // ilerleme mesajı; nihai R beklenir
      this.pending.delete(token)
      clearTimeout(cmd.timer)
      cmd.resolve(msg.slice(2))
    } else if (type === 'N') {
      const token = msg[1]
      const cmd = this.pending.get(token)
      if (!cmd) return
      this.pending.delete(token)
      clearTimeout(cmd.timer)
      cmd.reject(new Error(`Karşı taraf komutu desteklemiyor (tanınmayan komut): ${cmd.label}`))
    } else if (type === 'E') {
      this.emit('event', { service: msg[1], event: msg[2], args: msg.slice(3) })
    }
  }

  /** TCF komutu gönderir; yanıt argümanlarını (JSON metinleri) döndürür. */
  command(
    service: string,
    name: string,
    args: string[] = [],
    source: LogSource = 'user'
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      if (!this._connected || !this.socket) {
        reject(new Error('disconnected'))
        return
      }
      const token = String(++this.tokenCounter)
      const label = `${service} ${name}`
      const timer = setTimeout(() => {
        this.pending.delete(token)
        reject(new Error(`timeout: "${label}" ${this.timeoutMs}ms içinde yanıtlanmadı`))
      }, this.timeoutMs)
      this.pending.set(token, { resolve, reject, timer, label, source })
      const parts = ['C', token, service, name, ...args]
      this.socket.write(encodeTcfMessage(parts))
      this.emit('log', { dir: 'tx', line: parts.join(' '), source })
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

  private handleClose(): void {
    if (!this._connected) return
    this._connected = false
    this.socket = null
    this.failAll(new Error('bağlantı koptu'))
    this.emit('state', 'disconnected')
    this.emit('close')
  }

  private failAll(err: Error): void {
    for (const cmd of this.pending.values()) {
      clearTimeout(cmd.timer)
      cmd.reject(err)
    }
    this.pending.clear()
  }
}
