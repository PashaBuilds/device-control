import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { Cpx400dpSim } from './model'

export { Cpx400dpSim } from './model'

export interface SimHandle {
  port: number
  sim: Cpx400dpSim
  close: () => Promise<void>
}

export function startCpx400dpSim(port: number, onLog?: (msg: string) => void): Promise<SimHandle> {
  const sim = new Cpx400dpSim()
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
          socket.write(resp + '\r\n')
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
