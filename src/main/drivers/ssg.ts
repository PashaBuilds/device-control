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

/**
 * Mini-Circuits SSG serisi (SSG-6000RC, SSG-15G-RC) sinyal üreteci sürücüsü — USB ikili
 * komut kodları (Programming Manual C3, bölüm 5.2). Set komutlarının yanıtı yalnızca
 * kod yankısıdır; uygulanan değer kod 105 (çıkış durumu) ile geri okunur.
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

  /** Kod 105 — RF durumu, kilit, frekans, güç. */
  async readState(): Promise<RfState> {
    const reply = await this.req([MCL_CODE.OUTPUT_STATUS], {
      tx: '[105] durum?',
      rx: (d) => describeStatus(decodeOutputStatus(d))
    })
    return decodeOutputStatus(reply)
  }

  async setFrequency(hz: number): Promise<void> {
    await this.req(encodeSetFrequency(this.series, hz), { tx: `[101] frekans ${mhzText(hz)} MHz`, rx: ack })
  }

  async setPower(dbm: number): Promise<void> {
    await this.req(encodeSetPower(dbm), { tx: `[102] güç ${dbm.toFixed(2)} dBm`, rx: ack })
  }

  async setRfOutput(on: boolean): Promise<void> {
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
