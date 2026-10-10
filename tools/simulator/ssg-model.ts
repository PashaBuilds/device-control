/**
 * Mini-Circuits SSG serisi (SSG-6000RC, SSG-15G-RC) SCPI simülatörü.
 *
 * Cihazın USB (HID) üzerinden kabul ettiği SCPI alt kümesini konuşur:
 * `:MN?`, `:SN?`, `:FIRMWARE?`, `:FREQ:<değer><birim>`, `:FREQ?`, `:PWR:<dBm>`,
 * `:PWR?`, `:PWR:RF:ON|OFF`, `:PWR:RF?`.
 *
 * Not: Yanıt biçimleri (set için "1 - Success", aralık dışı için "0 - …",
 * `:FREQ?` için birimsiz MHz) Mini-Circuits programlama kılavuzu elde
 * olmadan yazıldı; sürücü bu yüzden birden çok biçimi tolere eder. Sim
 * bilerek birimsiz MHz döndürür ki sürücünün bu yolu da sınansın.
 */

export interface SsgModelSpec {
  model: string
  serial: string
  firmware: string
  minFreqHz: number
  maxFreqHz: number
  minPowerDbm: number
  maxPowerDbm: number
}

export const SSG_6000RC_SPEC: SsgModelSpec = {
  model: 'SSG-6000RC',
  serial: '11401230001',
  firmware: 'C4',
  minFreqHz: 25e6,
  maxFreqHz: 6000e6,
  minPowerDbm: -65,
  maxPowerDbm: 14
}

export const SSG_15G_RC_SPEC: SsgModelSpec = {
  model: 'SSG-15G-RC',
  serial: '12001230002',
  firmware: 'A2',
  minFreqHz: 10e6,
  maxFreqHz: 15000e6,
  minPowerDbm: -45,
  maxPowerDbm: 10
}

const UNITS: Record<string, number> = { HZ: 1, KHZ: 1e3, MHZ: 1e6, GHZ: 1e9 }

export class SsgSim {
  frequencyHz: number
  powerDbm: number
  rfOn = false

  constructor(readonly spec: SsgModelSpec) {
    this.frequencyHz = spec.minFreqHz
    this.powerDbm = spec.minPowerDbm
  }

  /** Tek bir SCPI komutunu işler, yanıt metnini döndürür. */
  handle(raw: string): string {
    const cmd = raw.trim().toUpperCase()
    if (cmd === ':MN?') return `MN=${this.spec.model}`
    if (cmd === ':SN?') return `SN=${this.spec.serial}`
    if (cmd === ':FIRMWARE?') return this.spec.firmware
    if (cmd === ':FREQ?') return (this.frequencyHz / 1e6).toFixed(6)
    if (cmd === ':PWR?') return this.powerDbm.toFixed(2)
    if (cmd === ':PWR:RF?') return this.rfOn ? 'ON' : 'OFF'
    if (cmd === ':PWR:RF:ON') {
      this.rfOn = true
      return '1 - Success'
    }
    if (cmd === ':PWR:RF:OFF') {
      this.rfOn = false
      return '1 - Success'
    }
    let m = cmd.match(/^:FREQ:([-+]?\d+(?:\.\d+)?)\s*(HZ|KHZ|MHZ|GHZ)?$/)
    if (m) {
      const hz = Number(m[1]) * UNITS[m[2] ?? 'MHZ']
      if (hz < this.spec.minFreqHz || hz > this.spec.maxFreqHz) return '0 - Frequency out of range'
      this.frequencyHz = Math.round(hz)
      return '1 - Success'
    }
    m = cmd.match(/^:PWR:([-+]?\d+(?:\.\d+)?)$/)
    if (m) {
      const dbm = Number(m[1])
      if (dbm < this.spec.minPowerDbm || dbm > this.spec.maxPowerDbm) return '0 - Power out of range'
      // Cihaz 0,25 dB adımlarla ayarlar
      this.powerDbm = Math.round(dbm * 4) / 4
      return '1 - Success'
    }
    return '0 - Invalid command'
  }
}
