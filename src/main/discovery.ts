import net from 'node:net'
import os from 'node:os'
import { exec } from 'node:child_process'
import type { DeviceKind, DiscoveredDevice } from '@shared/types'
import { DEVICE_TYPES } from '@shared/types'
import { ScpiConnection } from './scpi/connection'
import { TcfConnection } from './tcf/connection'

export type { DiscoveredDevice }

/**
 * Ağ keşfi: yerel alt ağ(lar)ı bilinen cihaz portlarında tarar, açık portları
 * ilgili protokolle yoklayıp cihaz türünü doğrular. Yalnızca kullanıcı isteğiyle
 * (Keşfet düğmesi) çalışır — arka planda otomatik tarama yapılmaz.
 */

export interface PortSpec {
  port: number
  kind: DeviceKind
}

/** Varsayılan olarak taranan portlar (cihaz türlerinden türetilir). */
export function defaultPortSpecs(): PortSpec[] {
  return DEVICE_TYPES.map((t) => ({ port: t.defaultPort, kind: t.kind }))
}

/**
 * Tek bir host:port'u yoklar. `expectKind` verilirse yalnızca o türü doğrular;
 * verilmezse porta göre otomatik seçer. Cihaz doğrulanamazsa null döner.
 */
export async function probeHost(
  host: string,
  port: number,
  timeoutMs: number,
  expectKind?: DeviceKind
): Promise<DiscoveredDevice | null> {
  const kind =
    expectKind ?? DEVICE_TYPES.find((t) => t.defaultPort === port)?.kind ?? null
  if (!kind) return null
  const label = DEVICE_TYPES.find((t) => t.kind === kind)?.label ?? kind

  // Önce hızlı bir TCP bağlanılabilirlik kontrolü (kapalı port erken elenir)
  const open = await tcpProbe(host, port, timeoutMs)
  if (!open) return null

  try {
    if (kind === 'cpx400dp') {
      const conn = new ScpiConnection(host, port, { timeoutMs })
      await conn.connect()
      try {
        const idn = await conn.query('*IDN?')
        if (!/CPX400DP/i.test(idn)) return null
        return { host, port, kind, label, identity: idn.trim(), mac: null }
      } finally {
        conn.disconnect()
      }
    }
    if (kind === 'smartlynq') {
      const conn = new TcfConnection(host, port, { timeoutMs })
      await conn.connect() // Hello alışverişi başarılıysa TCF konuşan bir uçtur
      const services = conn.services
      conn.disconnect()
      if (!services.includes('Locator')) return null
      return {
        host,
        port,
        kind,
        label,
        identity: `Xilinx hw_server (TCF) — ${services.length} servis`,
        mac: null
      }
    }
  } catch {
    return null
  }
  return null
}

/** Ham TCP bağlanılabilirlik denemesi (yalnızca port açık mı?). */
function tcpProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

export interface ScanOptions {
  /** Taranacak host listesi; verilmezse yerel alt ağlardan türetilir. */
  hosts?: string[]
  /** Taranacak portlar; verilmezse cihaz türlerinin varsayılan portları. */
  ports?: PortSpec[]
  timeoutMs?: number
  concurrency?: number
}

/** Yerel IPv4 arabirimlerinden /24 alt ağların host adreslerini üretir. */
export function localSubnetHosts(): string[] {
  const hosts = new Set<string>()
  const ifaces = os.networkInterfaces()
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      const parts = a.address.split('.').map(Number)
      if (parts.length !== 4) continue
      const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`
      for (let i = 1; i <= 254; i++) hosts.add(`${prefix}.${i}`)
    }
  }
  return [...hosts]
}

/** Sınırlı eşzamanlılıkla host×port matrisini tarar; bulunanları MAC ile zenginleştirir. */
export async function scanHosts(opts: ScanOptions = {}): Promise<DiscoveredDevice[]> {
  const hosts = opts.hosts ?? localSubnetHosts()
  const ports = opts.ports ?? defaultPortSpecs()
  const timeoutMs = opts.timeoutMs ?? 600
  const concurrency = opts.concurrency ?? 48

  const jobs: Array<{ host: string; port: number; kind: DeviceKind }> = []
  for (const host of hosts) {
    for (const p of ports) jobs.push({ host, port: p.port, kind: p.kind })
  }

  const results: DiscoveredDevice[] = []
  let idx = 0
  async function worker(): Promise<void> {
    while (idx < jobs.length) {
      const job = jobs[idx++]
      const found = await probeHost(job.host, job.port, timeoutMs, job.kind)
      if (found) results.push(found)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker))

  // Bulunan hostlar için ARP tablosundan MAC çöz
  await Promise.all(
    results.map(async (r) => {
      r.mac = await lookupMac(r.host)
    })
  )
  return results
}

/** İşletim sistemi ARP tablosundan MAC adresini okur (platforma göre). */
export function lookupMac(host: string): Promise<string | null> {
  const cmd = process.platform === 'win32' ? `arp -a ${host}` : `arp -n ${host}`
  return new Promise((resolve) => {
    exec(cmd, { timeout: 2500 }, (err, stdout) => {
      if (err) return resolve(null)
      const m = stdout.match(/([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i)
      resolve(m ? m[0].replace(/-/g, ':').toLowerCase() : null)
    })
  })
}
