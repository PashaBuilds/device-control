import type { LogSource, RfState } from '@shared/types'
import type { RequestLog } from '../hid/connection'
import { MCL_CODE, asciiz, hexBytes, isPrintable, stripTag } from '../hid/mcl'
import {
  decodeFirmware,
  decodeOutputStatus,
  decodeScpiReply,
  describeStatus,
  encodeScpi,
  encodeSetFrequency,
  encodeSetPower,
  encodeSetRf,
  mhzText,
  type SsgSeries
} from '../hid/ssgProtocol'

/** Sürücünün ihtiyaç duyduğu bağlantı yüzeyi (HidMclConnection karşılar). */
export interface SsgLink {
  request(body: number[], source: LogSource, log: RequestLog): Promise<Uint8Array>
}

const ack = (): string => 'tamam'

const UNIT_HZ: Record<string, number> = { HZ: 1, KHZ: 1e3, MHZ: 1e6, GHZ: 1e9 }

/** `:FREQ?` yanıtı → Hz. Kılavuz: birimsiz MHz ("2105.000000"); birim varsa ona göre. */
export function parseScpiFrequencyHz(reply: string): number {
  const m = reply.trim().match(/^([-+]?\d+(?:\.\d+)?)\s*(HZ|KHZ|MHZ|GHZ)?$/i)
  if (!m) throw new Error(`:FREQ? yanıtı anlaşılamadı: "${reply}"`)
  return Math.round(Number(m[1]) * UNIT_HZ[(m[2] ?? 'MHZ').toUpperCase()])
}

/** `:PWR?` yanıtı → dBm ("-10.25"). */
export function parseScpiPowerDbm(reply: string): number {
  const m = reply.trim().match(/^([-+]?\d+(?:\.\d+)?)\s*(DBM)?$/i)
  if (!m) throw new Error(`:PWR? yanıtı anlaşılamadı: "${reply}"`)
  return Number(m[1])
}

/** `:PWR:RF?` yanıtı → açık mı ("ON"/"OFF"). */
export function parseScpiOnOff(reply: string): boolean {
  const t = reply.trim().toUpperCase()
  if (t === 'ON' || t === '1') return true
  if (t === 'OFF' || t === '0') return false
  throw new Error(`:PWR:RF? yanıtı anlaşılamadı: "${reply}"`)
}

/** dBm → SCPI metni ("-5.25", "0", "4.5"). */
export function powerText(dbm: number): string {
  const v = (Math.round(dbm * 100) / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
  return v === '-0' ? '0' : v
}

/**
 * Mini-Circuits SSG serisi (SSG-6000RC, SSG-15G-RC) sinyal üreteci sürücüsü — USB komut
 * kodları (Programming Manual C3, bölüm 5.2).
 *
 * - '6000' ailesi (SSG-6000RC): ikili kodlar — 101 frekans, 102 güç, 104 RF, 105 durum.
 * - 'xg' ailesi (SSG-15G-RC): kod 105'in yanıtı sahada kılavuzdaki ikili düzende değil,
 *   frekansı ASCII metin olarak taşıyor (9000 MHz → bayt 3–7 "9000."). Bu yüzden bu ailede
 *   ayar ve geri okuma USB üzerinden SCPI ile (kod 42) yapılır: `:FREQ:…MHz`, `:PWR:…`,
 *   `:PWR:RF:ON|OFF` (yanıt 1 = tamam, 0 = başarısız) ve `:FREQ?`, `:PWR?`, `:PWR:RF?`.
 *   SCPI'de kilit/seviye durumu sorgusu olmadığından bunlar bilinmiyor (null).
 */
export class SsgDriver {
  constructor(
    private readonly link: SsgLink,
    private readonly series: SsgSeries,
    private readonly source: LogSource = 'user'
  ) {}

  private req(body: number[], log: RequestLog): Promise<Uint8Array> {
    return this.link.request(body, this.source, log)
  }

  /** Model, seri no ve ürün yazılımı; ör. "Mini-Circuits SSG-6000RC · SN 11401230001 · FW C4". */
  async identify(): Promise<{ model: string; serial: string; identity: string }> {
    const text = (d: Uint8Array): string => {
      const t = asciiz(d, 1)
      return isPrintable(t) ? t : `[${hexBytes(d)}]`
    }
    const model = stripTag(
      asciiz(await this.req([MCL_CODE.MODEL_NAME], { tx: '[40] model adı?', rx: text }), 1),
      'MN'
    )
    const serial = stripTag(
      asciiz(await this.req([MCL_CODE.SERIAL_NUMBER], { tx: '[41] seri no?', rx: text }), 1),
      'SN'
    )
    let firmware = ''
    try {
      firmware = decodeFirmware(
        await this.req([MCL_CODE.FIRMWARE], { tx: '[99] ürün yazılımı?', rx: decodeFirmware })
      )
    } catch {
      // Ürün yazılımı okunamazsa kimlik onsuz da yeterli
    }
    const parts = [`Mini-Circuits ${model}`]
    if (serial) parts.push(`SN ${serial}`)
    if (firmware) parts.push(`FW ${firmware}`)
    return { model, serial, identity: parts.join(' · ') }
  }

  /** RF durumu, frekans, güç ('6000': kod 105 ile kilit/seviye dahil; 'xg': SCPI). */
  async readState(): Promise<RfState> {
    if (this.series === 'xg') {
      const frequencyHz = parseScpiFrequencyHz(await this.scpi(':FREQ?'))
      const powerDbm = parseScpiPowerDbm(await this.scpi(':PWR?'))
      const outputOn = parseScpiOnOff(await this.scpi(':PWR:RF?'))
      return { frequencyHz, powerDbm, outputOn, locked: null, unleveled: null }
    }
    const reply = await this.req([MCL_CODE.OUTPUT_STATUS], {
      tx: '[105] durum?',
      rx: (d) => describeStatus(decodeOutputStatus(d))
    })
    return decodeOutputStatus(reply)
  }

  /** SCPI ayar komutu; cihaz "0 …" ile yanıtlarsa reddedilmiş sayılır. */
  private async scpiSet(cmd: string): Promise<void> {
    const reply = await this.scpi(cmd)
    if (/^0\b/.test(reply.trim())) throw new Error(`Cihaz "${cmd}" komutunu reddetti (yanıt: ${reply})`)
  }

  async setFrequency(hz: number): Promise<void> {
    if (this.series === 'xg') return this.scpiSet(`:FREQ:${mhzText(hz)}MHz`)
    await this.req(encodeSetFrequency(this.series, hz), { tx: `[101] frekans ${mhzText(hz)} MHz`, rx: ack })
  }

  async setPower(dbm: number): Promise<void> {
    if (this.series === 'xg') return this.scpiSet(`:PWR:${powerText(dbm)}`)
    await this.req(encodeSetPower(dbm), { tx: `[102] güç ${dbm.toFixed(2)} dBm`, rx: ack })
  }

  async setRfOutput(on: boolean): Promise<void> {
    if (this.series === 'xg') return this.scpiSet(on ? ':PWR:RF:ON' : ':PWR:RF:OFF')
    await this.req(encodeSetRf(on), { tx: `[104] RF ${on ? 'AÇ' : 'KAPAT'}`, rx: ack })
  }

  /** SCPI komutu (konsol için): '6000' ailesinde kod 121, diğerlerinde kod 42. */
  async scpi(cmd: string): Promise<string> {
    const reply = await this.req(encodeScpi(this.series, cmd), {
      tx: cmd,
      rx: (d) => decodeScpiReply(this.series, d)
    })
    return decodeScpiReply(this.series, reply)
  }
}
