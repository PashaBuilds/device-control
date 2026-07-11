import { afterEach, describe, expect, it } from 'vitest'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { encodeTcfMessage, TcfDecoder, TcfConnection } from '../src/main/tcf/connection'

describe('TCF çerçeveleme', () => {
  it('mesajı NUL ayraçlı + EOM (0x03 0x01) kodlar', () => {
    const buf = encodeTcfMessage(['E', 'Locator', 'Hello', '["Locator"]'])
    expect([...buf]).toEqual([
      ...Buffer.from('E\0Locator\0Hello\0["Locator"]\0'),
      0x03,
      0x01
    ])
  })

  it('parçalı gelen akışı mesajlara böler', () => {
    const dec = new TcfDecoder()
    const full = Buffer.concat([
      encodeTcfMessage(['E', 'Locator', 'Hello', '["Jtag"]']),
      encodeTcfMessage(['R', '1', 'null'])
    ])
    const out: string[][] = []
    // tek bayt tek bayt besle (en kötü parçalanma)
    for (const byte of full) out.push(...dec.push(Buffer.from([byte])))
    expect(out).toEqual([
      ['E', 'Locator', 'Hello', '["Jtag"]'],
      ['R', '1', 'null']
    ])
  })
})

/** Testlere özel minimal TCF sunucusu. */
function startTcfServer(
  handler: (parts: string[], write: (parts: string[]) => void) => void,
  helloServices = ['Locator', 'Jtag']
): Promise<{ port: number; close: () => Promise<void> }> {
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => undefined)
    const dec = new TcfDecoder()
    const write = (parts: string[]): void => void socket.write(encodeTcfMessage(parts))
    write(['E', 'Locator', 'Hello', JSON.stringify(helloServices)])
    socket.on('data', (d) => {
      for (const msg of dec.push(d)) handler(msg, write)
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () =>
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise((r) => {
            for (const s of sockets) s.destroy()
            server.close(() => r())
          })
      })
    )
  })
}

describe('TcfConnection', () => {
  let conn: TcfConnection | undefined
  let closeServer: (() => Promise<void>) | undefined

  afterEach(async () => {
    conn?.disconnect()
    conn = undefined
    await closeServer?.()
    closeServer = undefined
  })

  it('bağlanır, Hello alışverişi yapar ve servisleri öğrenir', async () => {
    const srv = await startTcfServer(() => undefined, ['Locator', 'Jtag', 'JtagCable'])
    closeServer = srv.close
    conn = new TcfConnection('127.0.0.1', srv.port)
    await conn.connect()
    expect(conn.services).toEqual(['Locator', 'Jtag', 'JtagCable'])
  })

  it('komut gönderir ve R yanıtını token ile eşleştirir', async () => {
    const srv = await startTcfServer((msg, write) => {
      if (msg[0] === 'C' && msg[2] === 'Locator' && msg[3] === 'getAgentID') {
        write(['R', msg[1], 'null', '"sim-agent-1"'])
      }
    })
    closeServer = srv.close
    conn = new TcfConnection('127.0.0.1', srv.port)
    await conn.connect()
    const reply = await conn.command('Locator', 'getAgentID')
    expect(reply).toEqual(['null', '"sim-agent-1"'])
  })

  it("tanınmayan komutta 'N' yanıtı hatayla reddedilir", async () => {
    const srv = await startTcfServer((msg, write) => {
      if (msg[0] === 'C') write(['N', msg[1]])
    })
    closeServer = srv.close
    conn = new TcfConnection('127.0.0.1', srv.port)
    await conn.connect()
    await expect(conn.command('Bilinmeyen', 'komut')).rejects.toThrow(/tanınmayan|desteklenmiyor/i)
  })

  it('yanıt gelmezse zaman aşımına düşer', async () => {
    const srv = await startTcfServer(() => undefined)
    closeServer = srv.close
    conn = new TcfConnection('127.0.0.1', srv.port, { timeoutMs: 100 })
    await conn.connect()
    await expect(conn.command('Locator', 'sync')).rejects.toThrow(/timeout/i)
  })

  it('sunucu kapatınca close olayı yayınlanır', async () => {
    const srv = await startTcfServer(() => undefined)
    closeServer = srv.close
    conn = new TcfConnection('127.0.0.1', srv.port)
    await conn.connect()
    const closed = new Promise<void>((r) => conn!.on('close', () => r()))
    await srv.close()
    closeServer = undefined
    await closed
    expect(conn.connected).toBe(false)
  })
})
