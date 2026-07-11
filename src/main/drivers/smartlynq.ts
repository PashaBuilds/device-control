import type { ProbeInfo } from '@shared/types'
import { TcfConnection } from '../tcf/connection'

/**
 * Xilinx SmartLynq / hw_server sürücüsü (TCF, TCP 3121).
 *
 * v1 kapsamı "ulaş ve gör": bağlantı doğrulama (Hello), servis listesi,
 * agent kimliği ve — cihaz destekliyorsa — JTAG zincirindeki hedef adları.
 * Programlama/debug işlemleri Vivado/hw_server araçlarına bırakılır.
 */
export class SmartLynqDriver {
  constructor(private readonly conn: TcfConnection) {}

  /** Bağlantı sonrası cihaz hakkında toplanabilen her şeyi toplar. */
  async gatherInfo(): Promise<ProbeInfo> {
    const services = [...this.conn.services]

    let agentId: string | null = null
    try {
      const [err, id] = await this.conn.command('Locator', 'getAgentID')
      if (err === 'null' && id) agentId = JSON.parse(id)
    } catch {
      // komut desteklenmiyor olabilir; kimliksiz devam
    }

    const jtagTargets: string[] = []
    if (services.includes('Jtag')) {
      try {
        const [rootErr, rootChildren] = await this.conn.command('Jtag', 'getChildren', '""')
        if (rootErr === 'null') {
          const ports: string[] = JSON.parse(rootChildren ?? '[]')
          for (const port of ports) {
            const [chErr, chChildren] = await this.conn.command(
              'Jtag',
              'getChildren',
              JSON.stringify(port)
            )
            if (chErr !== 'null') continue
            const devices: string[] = JSON.parse(chChildren ?? '[]')
            for (const id of devices) {
              try {
                const [ctxErr, ctx] = await this.conn.command('Jtag', 'getContext', JSON.stringify(id))
                if (ctxErr === 'null') {
                  const parsed = JSON.parse(ctx ?? '{}')
                  jtagTargets.push(typeof parsed?.Name === 'string' ? parsed.Name : id)
                } else {
                  jtagTargets.push(id)
                }
              } catch {
                jtagTargets.push(id)
              }
            }
          }
        }
      } catch {
        // Jtag numaralandırma desteklenmiyorsa hedef listesi boş kalır
      }
    }

    return { services, agentId, jtagTargets }
  }

  /** Canlılık denetimi: herhangi bir yanıt (R veya N) bağlantının sağlıklı olduğunu gösterir. */
  async ping(): Promise<void> {
    try {
      await this.conn.command('Locator', 'sync')
    } catch (err) {
      // 'N' (desteklenmeyen komut) da geçerli bir canlılık kanıtıdır
      if (err instanceof Error && /desteklemiyor/.test(err.message)) return
      throw err
    }
  }
}
