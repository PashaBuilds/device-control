/**
 * Mini-Circuits SSG serisi (SSG-6000RC, SSG-15G-RC) simülatörü.
 *
 * USB'de cihazın konuştuğu ikili komut kodlarını Programming Manual (C3) bölüm 5.2'ye
 * göre uygular (`handleReport`): 40 model, 41 seri, 99 ürün yazılımı, 101 frekans,
 * 102 güç, 104 RF, 105 durum, SCPI (6000 ailesi 121, diğerleri 42). Paket çözümü
 * sürücüden bağımsız yazıldı ki testler sürücünün kodlamasını kılavuza karşı sınasın.
 *
 * `handle` SCPI alt kümesini konuşur (`:MN?`, `:SN?`, `:FIRMWARE?`, `:FREQ:…`, `:FREQ?`,
 * `:PWR:…`, `:PWR?`, `:PWR:RF:ON|OFF`, `:PWR:RF?`); yanıtlar kılavuzdaki örneklere göre
 * (set → "1", `:FREQ?` → "2105.000000", `:PWR:RF?` → "OFF").
 */

export interface SsgModelSpec {
  model: string
  serial: string
  firmware: string
  /** USB komut ailesi: '6000' = frekans 5 bayt Hz, SCPI 121; 'xg' = ASCII MHz, SCPI 42 */
  series: '6000' | 'xg'
  minFreqHz: number
  maxFreqHz: number
  minPowerDbm: number
  maxPowerDbm: number
}

export const SSG_6000RC_SPEC: SsgModelSpec = {
  model: 'SSG-6000RC',
  serial: '11401230001',
  firmware: 'C4',
  series: '6000',
  minFreqHz: 25e6,
  maxFreqHz: 6000e6,
  minPowerDbm: -65,
  maxPowerDbm: 14
}

export const SSG_15G_RC_SPEC: SsgModelSpec = {
  model: 'SSG-15G-RC',
  serial: '12001230002',
  firmware: 'A2',
  series: 'xg',
  minFreqHz: 10e6,
  maxFreqHz: 15000e6,
  minPowerDbm: -45,
  maxPowerDbm: 10
}

const UNITS: Record<string, number> = { HZ: 1, KHZ: 1e3, MHZ: 1e6, GHZ: 1e9 }
const REPORT = 64

function zstr(bytes: Uint8Array, start: number, end = bytes.length): string {
  let s = ''
  for (let i = start; i < end && bytes[i] !== 0; i++) s += String.fromCharCode(bytes[i])
  return s
}

export class SsgSim {
  frequencyHz: number
  powerDbm: number
  rfOn = false
  /** Son komutlarda Trigger Out baytı (testler için) */
  triggerOut = 0
  /** Alınan kod 101/102 paketleri (testler için) */
  readonly received: number[][] = []

  constructor(readonly spec: SsgModelSpec) {
    this.frequencyHz = spec.minFreqHz
    this.powerDbm = spec.minPowerDbm
  }

  private setFrequency(hz: number): boolean {
    if (!(hz >= this.spec.minFreqHz && hz <= this.spec.maxFreqHz)) return false
    this.frequencyHz = Math.round(hz)
    return true
  }

  private setPower(dbm: number): boolean {
    if (!(dbm >= this.spec.minPowerDbm && dbm <= this.spec.maxPowerDbm)) return false
    // Cihaz 0,25 dB adımlarla ayarlar
    this.powerDbm = Math.round(dbm * 4) / 4
    return true
  }

  /** Tek bir SCPI komutunu işler, yanıt metnini döndürür. */
  handle(raw: string): string {
    const cmd = raw.trim().toUpperCase()
    if (cmd === ':MN?') return this.spec.model
    if (cmd === ':SN?') return this.spec.serial
    if (cmd === ':FIRMWARE?') return this.spec.firmware
    if (cmd === ':FREQ?') return (this.frequencyHz / 1e6).toFixed(6)
    if (cmd === ':PWR?') return this.powerDbm.toFixed(2)
    if (cmd === ':PWR:RF?') return this.rfOn ? 'ON' : 'OFF'
    if (cmd === ':PWR:RF:ON') {
      this.rfOn = true
      return '1'
    }
    if (cmd === ':PWR:RF:OFF') {
      this.rfOn = false
      return '1'
    }
    let m = cmd.match(/^:FREQ:([-+]?\d+(?:\.\d+)?)\s*(HZ|KHZ|MHZ|GHZ)?$/)
    if (m) return this.setFrequency(Number(m[1]) * UNITS[m[2] ?? 'MHZ']) ? '1' : '0'
    m = cmd.match(/^:PWR:([-+]?\d+(?:\.\d+)?)$/)
    if (m) return this.setPower(Number(m[1])) ? '1' : '0'
    return '0'
  }

  /**
   * USB rapor gövdesini (rapor kimliği hariç, bayt 0 = kod) işler; yanıt raporunu
   * döndürür. Tanınmayan kodlara gerçek cihazdaki gibi kodu yankılayan anlamsız veri döner.
   */
  handleReport(r: Uint8Array): Uint8Array {
    const code = r[0]
    const out = new Uint8Array(REPORT)
    out[0] = code
    const putText = (text: string, at: number): void => {
      for (let i = 0; i < text.length && at + i < REPORT - 1; i++) out[at + i] = text.charCodeAt(i)
    }
    switch (code) {
      case 40:
        putText(this.spec.model, 1)
        break
      case 41:
        putText(this.spec.serial, 1)
        break
      case 99:
        out.set([55, 52, 83, 87], 1)
        putText(this.spec.firmware, 5)
        break
      case 101: {
        this.received.push([...r.subarray(0, 24)])
        if (this.spec.series === '6000') {
          // 5.2.5: Freq_1..Freq_5 (Hz, 256 tabanında, en anlamlı önce), bayt 6 Trigger Out
          let hz = 0
          for (let i = 1; i <= 5; i++) hz = hz * 256 + r[i]
          this.triggerOut = r[6]
          this.setFrequency(hz)
        } else {
          // 5.2.6: ASCII MHz metni, NUL ile biter
          this.setFrequency(Number(zstr(r, 1)) * 1e6)
        }
        break
      }
      case 102: {
        // 5.2.7: bayt 1 işaret (1 = negatif), bayt 2–3 |dBm|×100, bayt 4 Trigger Out
        this.received.push([...r.subarray(0, 8)])
        const magnitude = (r[2] * 256 + r[3]) / 100
        this.triggerOut = r[4]
        this.setPower(r[1] === 1 ? -magnitude : magnitude)
        break
      }
      case 104:
        this.rfOn = r[1] === 1
        break
      case 105: {
        // 5.2.9: RF, kilit, frekans 5 bayt, işaret, |dBm|×100 2 bayt, unlevel high/low
        out[1] = this.rfOn ? 1 : 0
        out[2] = 1
        let hz = this.frequencyHz
        for (let i = 7; i >= 3; i--) {
          out[i] = hz % 256
          hz = Math.floor(hz / 256)
        }
        const magnitude = Math.round(Math.abs(this.powerDbm) * 100)
        out[8] = this.powerDbm < 0 ? 1 : 0
        out[9] = Math.floor(magnitude / 256)
        out[10] = magnitude % 256
        break
      }
      case 121:
        if (this.spec.series === '6000') {
          // 5.2.17: bayt 1 uzunluk, 2–63 komut; yanıtta 1–7 yankı, 8'den itibaren cevap
          const cmd = String.fromCharCode(...r.subarray(2, 2 + r[1]))
          out.set(r.subarray(1, 8), 1)
          putText(this.handle(cmd), 8)
        } else {
          out.fill(0xff, 1)
        }
        break
      case 42:
        if (this.spec.series === 'xg') {
          // 5.2.18: bayt 1–63 komut, yanıt bayt 1'den
          putText(this.handle(zstr(r, 1)), 1)
        } else {
          // 6000 ailesinde 42 = en düşük frekans (5.2.10), 4 bayt Hz
          let hz = this.spec.minFreqHz
          for (let i = 4; i >= 1; i--) {
            out[i] = hz % 256
            hz = Math.floor(hz / 256)
          }
        }
        break
      default:
        // Gerçek cihaz kılavuzda olmayan kodlara (ör. 1) kodu yankılayan ikili veri döndürüyor
        out.set([0x02, 0x9c, 0x36, 0x45], 1)
        out.fill(0xff, 5)
    }
    return out
  }
}
