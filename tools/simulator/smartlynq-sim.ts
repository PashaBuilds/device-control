import net from 'node:net'
import type { AddressInfo } from 'node:net'
import { encodeTcfMessage, TcfDecoder } from '../../src/main/tcf/connection'

/**
 * Xilinx SmartLynq / hw_server TCF simülatörü.
 *
 * Gerçek hw_server'ın TCP 3121'deki davranışının uygulama kapsamındaki alt
 * kümesini taklit eder: Hello alışverişi, Locator sync/getAgentID ve Jtag
 * servisi üzerinden basit bir zincir (port0 → xc7z045).
 */

const SERVICES = [
  'Locator',
  'Jtag',
  'JtagCable',
  'JtagDevice',
  'Memory',
  'RunControl',
  'Xicom',
  'stapl'
]

const AGENT_ID = 'sim-dlc20-agent-0001'

const JTAG_TREE: Record<string, string[]> = {
  '': ['port0'],
  // Zynq tipik zinciri: ARM DAP + PL (xc7z045)
  port0: ['arm_dap-0', 'xc7z045-0']
}

const JTAG_CONTEXTS: Record<string, object> = {
  port0: { ID: 'port0', Name: 'SmartLynq DLC20 (sim)', isActive: true },
  'arm_dap-0': { ID: 'arm_dap-0', Name: 'arm_dap', idCode: '0x4ba00477', irLen: 4 },
  'xc7z045-0': { ID: 'xc7z045-0', Name: 'xc7z045', idCode: '0x23731093', irLen: 6 }
}

function handleCommand(parts: string[]): string[] {
  const [, token, service, command, ...args] = parts

  if (service === 'Locator' && command === 'sync') return ['R', token]
  if (service === 'Locator' && command === 'getAgentID') {
    return ['R', token, 'null', JSON.stringify(AGENT_ID)]
  }
  if (service === 'Jtag' && command === 'getChildren') {
    let parent = ''
    try {
      parent = JSON.parse(args[0] ?? '""')
    } catch {
      /* bozuk argüman: kök varsay */
    }
    const children = JTAG_TREE[parent]
    if (!children) return ['R', token, JSON.stringify({ Format: 'Invalid context' }), '[]']
    return ['R', token, 'null', JSON.stringify(children)]
  }
  if (service === 'Jtag' && command === 'getContext') {
    let id = ''
    try {
      id = JSON.parse(args[0] ?? '""')
    } catch {
      /* yok */
    }
    const ctx = JTAG_CONTEXTS[id]
    if (!ctx) return ['R', token, JSON.stringify({ Format: 'Invalid context' }), 'null']
    return ['R', token, 'null', JSON.stringify(ctx)]
  }
  return ['N', token]
}

export interface SmartLynqSimHandle {
  port: number
  close: () => Promise<void>
}

export function startSmartLynqSim(
  port: number,
  onLog?: (msg: string) => void
): Promise<SmartLynqSimHandle> {
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => sockets.delete(socket))
    const decoder = new TcfDecoder()

    // Kanal açılışı: kendi Hello'muz
    socket.write(encodeTcfMessage(['E', 'Locator', 'Hello', JSON.stringify(SERVICES)]))
    onLog?.('tx: Hello ' + JSON.stringify(SERVICES))

    socket.on('data', (d) => {
      const buf = typeof d === 'string' ? Buffer.from(d) : d
      for (const msg of decoder.push(buf)) {
        onLog?.('rx: ' + msg.join(' '))
        if (msg[0] === 'C') {
          const reply = handleCommand(msg)
          onLog?.('tx: ' + reply.join(' '))
          socket.write(encodeTcfMessage(reply))
        }
        // Karşı tarafın Hello olayı vb. yanıt gerektirmez
      }
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise((r) => {
            for (const s of sockets) s.destroy()
            server.close(() => r())
          })
      })
    })
  })
}
