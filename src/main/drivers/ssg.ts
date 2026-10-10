import type { LogSource, RfState } from '@shared/types'
import { stripTag } from '../hid/mcl'

/** Sürücünün ihtiyaç duyduğu bağlantı yüzeyi (HidScpiConnection karşılar). */
export interface SsgLink {
  query(cmd: string, source?: LogSource): Promise<string>
}

/** "0 - Invalid command" gibi hata yanıtları (sorgu yanıtı sanılmasın diye). */
function isErrorReply(reply: string): boolean {
  return /invalid|error|fail|out of range|^0\s*-/i.test(reply.trim())
}

const UNIT_HZ: Record<string, number> = { HZ: 1, KHZ: 1e3, MHZ: 1e6, GHZ: 1e9 }

/**
 * `:FREQ?` yanıtını Hz'e çevirir. Birim varsa ona göre; yoksa büyüklükten
 * çıkarılır: SSG'lerin en düşük frekansı 10 MHz olduğundan ≥ 100 000 bir Hz
 * değeridir, daha küçüğü MHz'dir (en yüksek 15 000 MHz). Okunamazsa null.
 */
export function parseFrequencyHz(reply: string): number | null {
  if (isErrorReply(reply)) return null
  const m = stripTag(reply, 'FREQ').match(/([-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\s*(HZ|KHZ|MHZ|GHZ)?/i)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  if (m[2]) return Math.round(n * UNIT_HZ[m[2].toUpperCase()])
  return Math.round(n >= 1e5 ? n : n * 1e6)
}

/** `:PWR?` yanıtından dBm; okunamazsa null. */
export function parsePowerDbm(reply: string): number | null {
  if (isErrorReply(reply)) return null
  const m = stripTag(reply, 'PWR').match(/[-+]?\d+(?:\.\d+)?/)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}

/** `:PWR:RF?` yanıtı: ON/OFF ya da 1/0; okunamazsa null. */
export function parseOnOff(reply: string): boolean | null {
  if (isErrorReply(reply)) return null
  const t = reply.trim().toUpperCase()
  if (/\bON\b/.test(t) || /^1\b/.test(t)) return true
  if (/\bOFF\b/.test(t) || /^0\b/.test(t)) return false
  return null
}

/**
 * Set komutu yanıtını denetler. Mini-Circuits başarıyı "1"/"1 - Success",
 * başarısızlığı "0 - …" ya da hata metniyle bildirir; boş yanıt başarı sayılır.
 */
export function checkSetReply(cmd: string, reply: string): void {
  const t = reply.trim()
  if (/^0\b/.test(t) || isErrorReply(t)) {
    throw new Error(`Cihaz "${cmd}" komutunu reddetti: ${t}`)
  }
}

/** Hz → ":FREQ:2400.5MHz" (Hz çözünürlüğünde, gereksiz sıfırlar atılır). */
export function formatFrequencyCommand(hz: number): string {
  const mhz = (Math.round(hz) / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  return `:FREQ:${mhz}MHz`
}

/** dBm → ":PWR:-5.25" */
export function formatPowerCommand(dbm: number): string {
  const v = (Math.round(dbm * 100) / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return `:PWR:${v === '-0' ? '0' : v}`
}

/** Mini-Circuits SSG serisi (SSG-6000RC, SSG-15G-RC) sinyal üreteci sürücüsü. */
export class SsgDriver {
  constructor(
    private readonly link: SsgLink,
    private readonly source: LogSource = 'user'
  ) {}

  private q(cmd: string): Promise<string> {
    return this.link.query(cmd, this.source)
  }

  /** Model ve seri numarası; ör. "Mini-Circuits SSG-6000RC · SN 11401230001 · FW C4". */
  async identify(): Promise<{ model: string; serial: string; identity: string }> {
    const model = stripTag(await this.q(':MN?'), 'MN')
    const serial = stripTag(await this.q(':SN?'), 'SN')
    let firmware = ''
    try {
      firmware = stripTag(await this.q(':FIRMWARE?'), 'FIRMWARE')
      if (isErrorReply(firmware)) firmware = ''
    } catch {
      // Ürün yazılımı sorgusu yoksa kimlik onsuz da yeterli
    }
    const parts = [`Mini-Circuits ${model}`]
    if (serial) parts.push(`SN ${serial}`)
    if (firmware) parts.push(`FW ${firmware}`)
    return { model, serial, identity: parts.join(' · ') }
  }

  /** Cihaz durumunu okur; okunamayan alan null döner (son bilinen değer korunur). */
  async readState(): Promise<{ [K in keyof RfState]: RfState[K] | null }> {
    const frequencyHz = parseFrequencyHz(await this.q(':FREQ?'))
    const powerDbm = parsePowerDbm(await this.q(':PWR?'))
    const outputOn = parseOnOff(await this.q(':PWR:RF?'))
    return { frequencyHz, powerDbm, outputOn }
  }

  async setFrequency(hz: number): Promise<void> {
    const cmd = formatFrequencyCommand(hz)
    checkSetReply(cmd, await this.q(cmd))
  }

  async setPower(dbm: number): Promise<void> {
    const cmd = formatPowerCommand(dbm)
    checkSetReply(cmd, await this.q(cmd))
  }

  async setRfOutput(on: boolean): Promise<void> {
    const cmd = on ? ':PWR:RF:ON' : ':PWR:RF:OFF'
    checkSetReply(cmd, await this.q(cmd))
  }
}
