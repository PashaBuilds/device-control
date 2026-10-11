import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { Hmp4040Sim } from './hmp4040-model'

export { Hmp4040Sim } from './hmp4040-model'

export interface Hmp4040SimHandle {
  port: number
  sim: Hmp4040Sim
  close: () => Promise<void>
}

export function startHmp4040Sim(
  port: number,
  onLog?: (msg: string) => void
): Promise<Hmp4040SimHandle> {
  const sim = new Hmp4040Sim()
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => sockets.delete(socket))
    let buf = ''
    socket.on('data', (d) => {
      buf += d.toString('ascii')
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '')
        buf = buf.slice(idx + 1)
        onLog?.(`rx: ${line}`)
        const resp = sim.handle(line)
        if (resp !== null) {
          onLog?.(`tx: ${resp}`)
          socket.write(resp + '\n')
        }
      }
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        sim,
        close: () =>
          new Promise((r) => {
            for (const s of sockets) s.destroy()
            server.close(() => r())
          })
      })
    })
  })
}
