import type { RfState } from '@shared/types'
import { MCL_CODE, MCL_REPORT_SIZE, asciiz } from './mcl'

/**
 * Mini-Circuits SSG sinyal üreteçlerinin USB komut paketleri — Programming Manual (C3)
 * bölüm 5.2. '6000' ailesi (SSG-6000RC/6001RC) frekansı 5 baytlık Hz olarak, 'xg' ailesi
 * (diğerleri, ör. SSG-15G-RC) ASCII MHz metni olarak alır.
 */
export type SsgSeries = '6000' | 'xg'

/** Hz → MHz metni, Hz çözünürlüğünde ("2412.5", "25.000003", "6000"). */
export function mhzText(hz: number): string {
  return (Math.round(hz) / 1e6).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}

/** Hz → 5 bayt, en anlamlı önce (Freq_1 = INT(Hz / 256^4) …). */
export function hzBytes(hz: number): number[] {
  let rest = Math.round(hz)
  const out: number[] = []
  for (let p = 4; p >= 0; p--) {
    const w = 256 ** p
    const b = Math.floor(rest / w)
    out.push(b)
    rest -= b * w
  }
  return out
}

/** Kod 101 — frekans (5.2.5 / 5.2.6). Trigger Out kapalı. */
export function encodeSetFrequency(series: SsgSeries, hz: number): number[] {
  if (series === '6000') return [MCL_CODE.SET_FREQUENCY, ...hzBytes(hz), 0]
  return [MCL_CODE.SET_FREQUENCY, ...Buffer.from(mhzText(hz), 'ascii'), 0]
}

/** Kod 102 — güç (5.2.7): işaret (0 = +, 1 = −), |dBm|×100 iki bayt, Trigger Out kapalı. */
export function encodeSetPower(dbm: number): number[] {
  const magnitude = Math.round(Math.abs(dbm) * 100)
  const negative = dbm < 0 && magnitude > 0
  return [MCL_CODE.SET_POWER, negative ? 1 : 0, Math.floor(magnitude / 256), magnitude % 256, 0]
}

/** Kod 104 — RF çıkışı aç/kapat (5.2.8). */
export function encodeSetRf(on: boolean): number[] {
  return [MCL_CODE.SET_RF, on ? 1 : 0]
}

/** Kod 105 yanıtı — çıkış durumu (5.2.9). */
export function decodeOutputStatus(data: Uint8Array): RfState {
  const frequencyHz =
    data[3] * 256 ** 4 + data[4] * 256 ** 3 + data[5] * 256 ** 2 + data[6] * 256 + data[7]
  const magnitude = (data[9] * 256 + data[10]) / 100
  return {
    outputOn: data[1] === 1,
    locked: data[2] === 1,
    frequencyHz,
    powerDbm: data[8] === 1 ? -magnitude : magnitude,
    unleveled: data[11] === 1 ? 'high' : data[12] === 1 ? 'low' : null
  }
}

/** Kod 99 yanıtı — ürün yazılımı (5.2.16): bayt 5–6 ASCII, ör. "C3". */
export function decodeFirmware(data: Uint8Array): string {
  return String.fromCharCode(data[5], data[6]).replace(/[^\x20-\x7e]/g, '').trim()
}

/** SCPI komutu paketi (5.2.17 / 5.2.18). */
export function encodeScpi(series: SsgSeries, cmd: string): number[] {
  const text = Buffer.from(cmd, 'ascii')
  if (series === '6000') {
    // bayt 0 = 121, bayt 1 = uzunluk, bayt 2–63 = komut
    if (text.length > MCL_REPORT_SIZE - 2) throw new Error(`SCPI komutu çok uzun (en çok ${MCL_REPORT_SIZE - 2} karakter)`)
    return [MCL_CODE.SCPI_6000, text.length, ...text]
  }
  if (text.length > MCL_REPORT_SIZE - 1) throw new Error(`SCPI komutu çok uzun (en çok ${MCL_REPORT_SIZE - 1} karakter)`)
  return [MCL_CODE.SCPI_XG, ...text]
}

/** SCPI yanıt metni: '6000' ailesinde bayt 8'den, 'xg' ailesinde bayt 1'den NUL'a kadar. */
export function decodeScpiReply(series: SsgSeries, data: Uint8Array): string {
  return asciiz(data, series === '6000' ? 8 : 1).trim()
}

/** Durumun okunur özeti (konsol günlüğü / tanılama raporu için). */
export function describeStatus(s: RfState): string {
  const parts = [
    s.outputOn ? 'RF AÇIK' : 'RF KAPALI',
    s.locked ? 'kilitli' : 'KİLİTSİZ',
    `${mhzText(s.frequencyHz)} MHz`,
    `${s.powerDbm.toFixed(2)} dBm`
  ]
  if (s.unleveled === 'high') parts.push('güç cihaz sınırının üstünde')
  if (s.unleveled === 'low') parts.push('güç cihaz sınırının altında')
  return parts.join(' · ')
}
