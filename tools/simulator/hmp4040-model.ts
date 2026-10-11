/**
 * Rohde & Schwarz HMP4040 (HMP serisi, 4 × 32 V / 10 A) SCPI simülatörü.
 *
 * "SCPI Commands HMP series" kılavuzundaki komut setinin uygulama kapsamındaki alt
 * kümesini konuşur. HMP'de komutlar **seçili kanala** gider (`INST:NSEL n` /
 * `INST OUTn`); çıkış iki katmanlıdır: kanal bazında `OUTP:SEL` (kanal etkin) ve
 * tüm cihaz için `OUTP:GEN` (ana çıkış). Bir kanal ancak ikisi de açıkken çıkış verir.
 * `OUTP ON` = seçili kanalı etkinleştir + ana çıkışı aç; `OUTP OFF` = yalnızca seçili
 * kanalı devre dışı bırak. Yanıtlar LF ile biter.
 *
 * `SIM:` önekli komutlar yalnızca test içindir (yük, zorla trip); sürücü göndermez.
 */

const V_MAX = 32.05
const I_MIN = 0.001
const I_MAX = 10.01
const OVP_MIN = 0.1
const OVP_MAX = 32.5

const ERR_UNDEF = -113 // Undefined header
const ERR_RANGE = -222 // Data out of range

export interface HmpChannelState {
  vSet: number
  iSet: number
  ovp: number
  fuse: boolean
  /** OUTP:SEL — kanal etkin (ana çıkış açıkken çıkış verir) */
  selected: boolean
  ovpTripped: boolean
  fuseTripped: boolean
  loadOhms: number
}

function defaultChannel(): HmpChannelState {
  return {
    vSet: 0,
    iSet: 0.1,
    ovp: OVP_MAX,
    fuse: false,
    selected: false,
    ovpTripped: false,
    fuseTripped: false,
    loadOhms: 10
  }
}

const BOOL = '(ON|OFF|1|0)'
const NUM = '([-+]?\\d+(?:\\.\\d+)?(?:[eE][-+]?\\d+)?)'
const re = (s: string): RegExp => new RegExp(`^${s}$`, 'i')

export class Hmp4040Sim {
  channels: HmpChannelState[] = [defaultChannel(), defaultChannel(), defaultChannel(), defaultChannel()]
  /** OUTP:GEN — ana çıkış */
  general = false
  /** Seçili kanal (1–4) */
  current = 1
  /** SYST:LOC/REM/MIX/RWL son durumu (test için) */
  mode = 'LOC'
  private errors: number[] = []

  reset(): void {
    const loads = this.channels.map((c) => c.loadOhms)
    this.channels = loads.map((l) => ({ ...defaultChannel(), loadOhms: l }))
    this.general = false
    this.current = 1
    this.errors = []
  }

  private get ch(): HmpChannelState {
    return this.channels[this.current - 1]
  }

  /** Kanal çıkış veriyor mu (etkin + ana çıkış + trip yok). */
  active(c: HmpChannelState): boolean {
    return c.selected && this.general && !c.ovpTripped && !c.fuseTripped
  }

  /** Anlık ölçüm; gerekirse OVP / elektronik sigorta tripler. */
  private measure(c: HmpChannelState): { v: number; i: number } {
    if (!this.active(c)) return { v: 0, i: 0 }
    let v = c.vSet
    let i = c.loadOhms > 0 ? c.vSet / c.loadOhms : Number.POSITIVE_INFINITY
    let cc = false
    if (i > c.iSet) {
      cc = true
      i = c.iSet
      v = c.iSet * c.loadOhms
    }
    if (v > c.ovp) {
      c.ovpTripped = true
      c.selected = false
      return { v: 0, i: 0 }
    }
    if (cc && c.fuse) {
      c.fuseTripped = true
      c.selected = false
      return { v: 0, i: 0 }
    }
    return { v, i }
  }

  private inRange(x: number, min: number, max: number, apply: (x: number) => void): void {
    if (!Number.isFinite(x) || x < min || x > max) {
      this.errors.push(ERR_RANGE)
      return
    }
    apply(x)
  }

  /** Bir komut satırını işler; sorguysa yanıt, değilse null döndürür. */
  handle(rawLine: string): string | null {
    const line = rawLine.trim().replace(/^SOUR(?:ce)?:/i, '')
    if (line === '') return null
    const on = (s: string): boolean => /^(ON|1)$/i.test(s)
    let m: RegExpMatchArray | null

    // --- Test uzantıları ---
    if ((m = line.match(/^SIM:LOAD([1-4])\s+([\d.]+)$/i))) {
      this.channels[Number(m[1]) - 1].loadOhms = Number(m[2])
      return null
    }
    if ((m = line.match(/^SIM:TRIP([1-4])\s+(OVP|FUSE)$/i))) {
      const c = this.channels[Number(m[1]) - 1]
      if (m[2].toUpperCase() === 'OVP') c.ovpTripped = true
      else c.fuseTripped = true
      c.selected = false
      return null
    }

    // --- Ortak / sistem ---
    if (/^\*IDN\?$/i.test(line)) return 'ROHDE&SCHWARZ,HMP4040,104567,HW50020003/SW2.51'
    if (/^\*RST$/i.test(line)) {
      this.reset()
      return null
    }
    if (/^\*CLS$/i.test(line)) {
      this.errors = []
      return null
    }
    if (/^\*OPC\?$/i.test(line)) return '1'
    if ((m = line.match(/^SYST(?:em)?:(LOC(?:al)?|REM(?:ote)?|MIX|RWL(?:ock)?)$/i))) {
      this.mode = m[1].slice(0, 3).toUpperCase()
      return null
    }
    if (/^SYST(?:em)?:ERR(?:or)?(?::NEXT)?\?$/i.test(line)) {
      const code = this.errors.shift()
      if (code === undefined) return '0, "No error"'
      return `${code}, "${code === ERR_RANGE ? 'Data out of range' : 'Undefined header'}"`
    }

    // --- Kanal seçimi ---
    if ((m = line.match(/^INST(?:rument)?:NSEL(?:ect)?\s+([1-4])$/i))) {
      this.current = Number(m[1])
      return null
    }
    if (/^INST(?:rument)?:NSEL(?:ect)?\?$/i.test(line)) return String(this.current)
    if ((m = line.match(/^INST(?:rument)?(?::SEL(?:ect)?)?\s+OUT(?:put)?([1-4])$/i))) {
      this.current = Number(m[1])
      return null
    }
    if (/^INST(?:rument)?(?::SEL(?:ect)?)?\?$/i.test(line)) return `OUTP${this.current}`

    // --- Seçili kanal sorguları ---
    const c = this.ch
    if (/^VOLT(?:age)?\?$/i.test(line)) return c.vSet.toFixed(3)
    if (/^CURR(?:ent)?\?$/i.test(line)) return c.iSet.toFixed(4)
    if (/^APPL(?:y)?\?$/i.test(line)) return `${c.vSet.toFixed(3)},${c.iSet.toFixed(4)}`
    if (/^VOLT(?:age)?:PROT(?:ection)?(?::LEV(?:el)?)?\?$/i.test(line)) return c.ovp.toFixed(3)
    if (/^VOLT(?:age)?:PROT(?:ection)?:TRIP(?:ped)?\?$/i.test(line)) return c.ovpTripped ? '1' : '0'
    if (/^FUSE(?::STAT(?:e)?)?\?$/i.test(line)) return c.fuse ? '1' : '0'
    if (/^FUSE:TRIP(?:ped)?\?$/i.test(line)) return c.fuseTripped ? '1' : '0'
    if (/^OUTP(?:ut)?:SEL(?:ect)?\?$/i.test(line)) return c.selected ? '1' : '0'
    if (/^OUTP(?:ut)?:GEN(?:eral)?\?$/i.test(line)) return this.general ? '1' : '0'
    if (/^OUTP(?:ut)?(?::STAT(?:e)?)?\?$/i.test(line)) return this.active(c) ? '1' : '0'
    if (/^MEAS(?:ure)?(?::SCAL(?:ar)?)?(?::VOLT(?:age)?)?(?::DC)?\?$/i.test(line)) return this.measure(c).v.toFixed(3)
    if (/^MEAS(?:ure)?(?::SCAL(?:ar)?)?:CURR(?:ent)?(?::DC)?\?$/i.test(line)) return this.measure(c).i.toFixed(4)

    // --- Seçili kanal ayarları ---
    if ((m = line.match(re(`VOLT(?:age)?(?::LEV(?:el)?)?(?::IMM(?:ediate)?)?(?::AMPL(?:itude)?)?\\s+${NUM}`)))) {
      this.inRange(Number(m[1]), 0, V_MAX, (x) => (c.vSet = x))
      return null
    }
    if ((m = line.match(re(`CURR(?:ent)?(?::LEV(?:el)?)?(?::IMM(?:ediate)?)?(?::AMPL(?:itude)?)?\\s+${NUM}`)))) {
      this.inRange(Number(m[1]), I_MIN, I_MAX, (x) => (c.iSet = x))
      return null
    }
    if ((m = line.match(re(`APPL(?:y)?\\s+${NUM}\\s*,\\s*${NUM}`)))) {
      this.inRange(Number(m[1]), 0, V_MAX, (x) => (c.vSet = x))
      this.inRange(Number(m[2]), I_MIN, I_MAX, (x) => (c.iSet = x))
      return null
    }
    if ((m = line.match(re(`VOLT(?:age)?:PROT(?:ection)?(?::LEV(?:el)?)?\\s+${NUM}`)))) {
      this.inRange(Number(m[1]), OVP_MIN, OVP_MAX, (x) => (c.ovp = x))
      return null
    }
    if (/^VOLT(?:age)?:PROT(?:ection)?:CLE(?:ar)?$/i.test(line)) {
      c.ovpTripped = false
      return null
    }
    if ((m = line.match(re(`FUSE(?::STAT(?:e)?)?\\s+${BOOL}`)))) {
      c.fuse = on(m[1])
      if (!c.fuse) c.fuseTripped = false
      return null
    }
    if ((m = line.match(re(`OUTP(?:ut)?:SEL(?:ect)?\\s+${BOOL}`)))) {
      c.selected = on(m[1])
      // Kanalı yeniden etkinleştirmek sigorta tripini temizler
      if (c.selected) c.fuseTripped = false
      return null
    }
    if ((m = line.match(re(`OUTP(?:ut)?:GEN(?:eral)?\\s+${BOOL}`)))) {
      this.general = on(m[1])
      return null
    }
    if ((m = line.match(re(`OUTP(?:ut)?(?::STAT(?:e)?)?\\s+${BOOL}`)))) {
      if (on(m[1])) {
        c.selected = true
        c.fuseTripped = false
        this.general = true
      } else {
        c.selected = false
      }
      return null
    }

    this.errors.push(ERR_UNDEF)
    return null
  }
}
