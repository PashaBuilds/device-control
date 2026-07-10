import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import net from 'node:net'
import { AddressInfo } from 'node:net'
import { ScpiConnection } from '../src/main/scpi/connection'

/** Satır bazlı sahte SCPI sunucusu: handler(line) => yanıt | undefined (yanıtsız). */
function startFakeServer(handler: (line: string) => string | undefined): Promise<{
  port: number
  received: string[]
  sockets: net.Socket[]
  close: () => Promise<void>
}> {
  const received: string[] = []
  const sockets: net.Socket[] = []
  const server = net.createServer((socket) => {
    sockets.push(socket)
    let buf = ''
    socket.on('data', (d) => {
      buf += d.toString('ascii')
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '')
        buf = buf.slice(idx + 1)
        received.push(line)
        const resp = handler(line)
        if (resp !== undefined) socket.write(resp + '\r\n')
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        received,
        sockets,
        close: () =>
          new Promise((r) => {
            for (const s of sockets) s.destroy()
            server.close(() => r())
          })
      })
    })
  })
}

describe('ScpiConnection', () => {
  let conn: ScpiConnection | undefined
  let closeServer: (() => Promise<void>) | undefined

  afterEach(async () => {
    conn?.disconnect()
    conn = undefined
    await closeServer?.()
    closeServer = undefined
  })

  it('query yazar ve yanıtı CRLF olmadan döndürür', async () => {
    const srv = await startFakeServer((line) => (line === 'V1?' ? 'V1 5.000' : undefined))
    closeServer = srv.close
    conn = new ScpiConnection('127.0.0.1', srv.port)
    await conn.connect()
    const resp = await conn.query('V1?')
    expect(resp).toBe('V1 5.000')
    expect(srv.received).toEqual(['V1?'])
  })

  it('art arda sorgular sırayla eşleşir', async () => {
    const srv = await startFakeServer((line) => {
      if (line === 'V1?') return 'V1 1.000'
      if (line === 'I1?') return 'I1 2.000'
      return undefined
    })
    closeServer = srv.close
    conn = new ScpiConnection('127.0.0.1', srv.port)
    await conn.connect()
    const [a, b] = await Promise.all([conn.query('V1?'), conn.query('I1?')])
    expect(a).toBe('V1 1.000')
    expect(b).toBe('I1 2.000')
  })

  it('yanıt gelmeyen sorgu zaman aşımıyla reddedilir, kuyruk devam eder', async () => {
    const srv = await startFakeServer((line) => (line === 'OP1?' ? '1' : undefined))
    closeServer = srv.close
    conn = new ScpiConnection('127.0.0.1', srv.port, { timeoutMs: 100 })
    await conn.connect()
    await expect(conn.query('SESSIZ?')).rejects.toThrow(/timeout/i)
    await expect(conn.query('OP1?')).resolves.toBe('1')
  })

  it('send ve query karışık sırada, yazım sırası korunur', async () => {
    const srv = await startFakeServer((line) => (line === 'V1?' ? 'V1 9.000' : undefined))
    closeServer = srv.close
    conn = new ScpiConnection('127.0.0.1', srv.port)
    await conn.connect()
    await conn.send('V1 9')
    await conn.send('OP1 1')
    const resp = await conn.query('V1?')
    expect(resp).toBe('V1 9.000')
    expect(srv.received).toEqual(['V1 9', 'OP1 1', 'V1?'])
  })

  it('sunucu kapatınca close olayı yayınlanır ve bekleyenler reddedilir', async () => {
    const srv = await startFakeServer(() => undefined)
    closeServer = srv.close
    conn = new ScpiConnection('127.0.0.1', srv.port, { timeoutMs: 5000 })
    await conn.connect()
    // sunucu tarafındaki 'connection' olayı ayrı makro görevde koşar; soketi bekle
    while (srv.sockets.length === 0) await new Promise((r) => setTimeout(r, 5))
    const closed = new Promise<void>((r) => conn!.on('close', () => r()))
    const pending = conn.query('V1?')
    // sunucu tarafındaki soketi kopar
    for (const s of srv.sockets) s.destroy()
    await expect(pending).rejects.toThrow()
    await closed
    expect(conn.connected).toBe(false)
  })

  it('tx/rx log olayları yayınlanır', async () => {
    const srv = await startFakeServer((line) => (line === '*IDN?' ? 'THURLBY THANDAR, CPX400DP, 0, 1.00' : undefined))
    closeServer = srv.close
    conn = new ScpiConnection('127.0.0.1', srv.port)
    const logs: Array<{ dir: string; line: string }> = []
    conn.on('log', (e: { dir: string; line: string }) => logs.push(e))
    await conn.connect()
    await conn.query('*IDN?')
    expect(logs).toEqual([
      { dir: 'tx', line: '*IDN?' },
      { dir: 'rx', line: 'THURLBY THANDAR, CPX400DP, 0, 1.00' }
    ])
  })
})
