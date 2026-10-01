/**
 * Keysight N5745A (N5700 serisi, tek çıkış 30 V / 25 A) SCPI simülatörü.
 *
 * Gerçek cihazın LAN raw-socket (TCP 5025) komut setinin uygulama
 * kapsamındaki alt kümesini konuşur; kanal listesi yoktur (`VOLT 12`).
 * Yanıtlar LF ile biter. Aralıklar N5700 User's Guide'daki 30 V modeline
 * göredir: VOLT 0–31.5 (ve ≤ OVP/1.05), OVP 2–36 (ve ≥ VOLT×1.05).
 *
 * `SIM:` önekli komutlar yalnızca test içindir; gerçek sürücü göndermez.
 */

const V_MAX = 31.5
const I_MAX = 25
const OVP_MIN = 2
const OVP_MAX = 36

const ERR_UNDEF = -113 // Undefined header
const ERR_CONFLICT = -221 // Settings conflict
const ERR_RANGE = -222 // Data out of range

// Questionable Condition register bitleri
const QUES_OV = 1
const QUES_OC = 2

const BOOL = /^(ON|OFF|1|0)$/i

export class N5745aSim {
  vSet = 0
  iSet = 0
  ovp = OVP_MAX
  ocpEnabled = false
  outputOn = false
  ovTripped = false
  ocTripped = false
  /** Trip anındaki çıkış durumu; OUTP:PROT:CLE bunu geri yükler. */
  private outputBeforeTrip = false
  loadOhms = 10
  private errors: number[] = []

  reset(): void {
    const load = this.loadOhms
    Object.assign(this, new N5745aSim())
    this.loadOhms = load
  }

  private get tripped(): boolean {
    return this.ovTripped || this.ocTripped
  }

  private trip(kind: 'ov' | 'oc'): void {
    if (!this.tripped) this.outputBeforeTrip = this.outputOn
    if (kind === 'ov') this.ovTripped = true
    else this.ocTripped = true
    this.outputOn = false
  }

  /** Anlık ölçüm; gerekirse OVP/OCP tripler. */
  private measure(): { v: number; i: number } {
    if (!this.outputOn || this.tripped) return { v: 0, i: 0 }
    let v = this.vSet
    let i = this.loadOhms > 0 ? v / this.loadOhms : Number.POSITIVE_INFINITY
    let cc = false
    if (i > this.iSet) {
      cc = true
      i = this.iSet
      v = this.iSet * this.loadOhms
    }
    if (v > this.ovp) {
      this.trip('ov')
      return { v: 0, i: 0 }
    }
    if (cc && this.ocpEnabled) {
      this.trip('oc')
      return { v: 0, i: 0 }
    }
    return { v, i }
  }

  private fmt(x: number): string {
    return x.toExponential(5).toUpperCase() // ör. "1.20000E+1"
  }

  private set(value: string, min: number, max: number, apply: (x: number) => void): void {
    const x = Number(value)
    if (!Number.isFinite(x) || x < min - 1e-9 || x > max + 1e-9) {
      this.errors.push(ERR_RANGE)
      return
    }
    apply(x)
  }

  handle(rawLine: string): string | null {
    // İsteğe bağlı SOURce: önekini at
    const line = rawLine.trim().replace(/^SOUR(?:ce)?:/i, '')
    if (line === '') return null
    let m: RegExpMatchArray | null

    // --- Test uzantıları ---
    if ((m = line.match(/^SIM:LOAD\s+([\d.]+)$/i))) {
      this.loadOhms = Number(m[1])
      return null
    }
    if ((m = line.match(/^SIM:TRIP\s+(OVP|OCP)$/i))) {
      this.trip(m[1].toUpperCase() === 'OVP' ? 'ov' : 'oc')
      return null
    }

    // --- Ortak ---
    if (/^\*IDN\?$/i.test(line)) return 'Agilent Technologies,N5745A,US17M1234P,A.03.02,A.01.01'
    if (/^\*RST$/i.test(line)) {
      this.reset()
      return null
    }
    if (/^\*CLS$/i.test(line)) {
      this.errors = []
      return null
    }
    if (/^\*OPC\?$/i.test(line)) return '1'
    if (/^SYST(?:em)?:ERR(?:or)?\?$/i.test(line)) {
      const code = this.errors.shift()
      if (code === undefined) return '+0,"No error"'
      const msg =
        code === ERR_RANGE ? 'Data out of range' : code === ERR_CONFLICT ? 'Settings conflict' : 'Undefined header'
      return `${code},"${msg}"`
    }

    // --- Sorgular ---
    if (/^VOLT(?:age)?\?$/i.test(line)) return this.fmt(this.vSet)
    if (/^CURR(?:ent)?\?$/i.test(line)) return this.fmt(this.iSet)
    if (/^VOLT(?:age)?:PROT(?:ection)?(?::LEV(?:el)?)?\?$/i.test(line)) return this.fmt(this.ovp)
    if (/^CURR(?:ent)?:PROT(?:ection)?:STAT(?:e)?\?$/i.test(line)) return this.ocpEnabled ? '1' : '0'
    if (/^OUTP(?:ut)?(?::STAT(?:e)?)?\?$/i.test(line)) {
      this.measure()
      return this.outputOn ? '1' : '0'
    }
    if (/^MEAS(?:ure)?(?::SCAL(?:ar)?)?:VOLT(?:age)?(?::DC)?\?$/i.test(line)) return this.fmt(this.measure().v)
    if (/^MEAS(?:ure)?(?::SCAL(?:ar)?)?:CURR(?:ent)?(?::DC)?\?$/i.test(line)) return this.fmt(this.measure().i)
    if (/^STAT(?:us)?:QUES(?:tionable)?:COND(?:ition)?\?$/i.test(line)) {
      this.measure()
      return String((this.ovTripped ? QUES_OV : 0) | (this.ocTripped ? QUES_OC : 0))
    }

    // --- Ayarlar ---
    if ((m = line.match(/^VOLT(?:age)?\s+([-+\d.eE]+)$/i))) {
      this.set(m[1], 0, Math.min(V_MAX, this.ovp / 1.05), (x) => (this.vSet = x))
      return null
    }
    if ((m = line.match(/^CURR(?:ent)?\s+([-+\d.eE]+)$/i))) {
      this.set(m[1], 0, I_MAX, (x) => (this.iSet = x))
      return null
    }
    if ((m = line.match(/^VOLT(?:age)?:PROT(?:ection)?(?::LEV(?:el)?)?\s+([-+\d.eE]+)$/i))) {
      this.set(m[1], Math.max(OVP_MIN, this.vSet * 1.05), OVP_MAX, (x) => (this.ovp = x))
      return null
    }
    if ((m = line.match(/^CURR(?:ent)?:PROT(?:ection)?:STAT(?:e)?\s+(\S+)$/i)) && BOOL.test(m[1])) {
      this.ocpEnabled = /^(ON|1)$/i.test(m[1])
      return null
    }
    if ((m = line.match(/^OUTP(?:ut)?(?::STAT(?:e)?)?\s+(\S+)$/i)) && BOOL.test(m[1])) {
      const on = /^(ON|1)$/i.test(m[1])
      if (on && this.tripped) this.errors.push(ERR_CONFLICT)
      else this.outputOn = on
      return null
    }
    if (/^OUTP(?:ut)?:PROT(?:ection)?:CLE(?:ar)?$/i.test(line)) {
      if (this.tripped) {
        this.ovTripped = false
        this.ocTripped = false
        this.outputOn = this.outputBeforeTrip
      }
      return null
    }

    this.errors.push(ERR_UNDEF)
    return null
  }
}
