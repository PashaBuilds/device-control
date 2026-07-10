/**
 * Aim-TTi CPX400DP protokol simülatörü.
 *
 * Gerçek cihazın TCP 9221 üzerindeki SCPI-benzeri komut setinin uygulama
 * kapsamındaki alt kümesini konuşur. Kanal başına basit bir omik yük modeli
 * vardır: I = V/R; akım limiti aşılırsa CC moduna geçilir (V = Ilim×R).
 *
 * `SIM:` önekli komutlar yalnızca test içindir (yük değiştirme, zorla trip);
 * gerçek sürücü bu komutları asla göndermez.
 */

const V_MIN = 0
const V_MAX = 60
const I_MIN = 0
const I_MAX = 20
const OVP_MIN = 1
const OVP_MAX = 66
const OCP_MIN = 1
const OCP_MAX = 22

// EER kodları (simülatöre özgü): 100 = tanınmayan komut, 120 = aralık dışı değer,
// 130 = trip devam ederken çıkış açma girişimi
const ERR_UNKNOWN = 100
const ERR_RANGE = 120
const ERR_TRIPPED = 130

// LSR bitleri
const LSR_CV = 0b0001
const LSR_CC = 0b0010
const LSR_OVP = 0b0100
const LSR_OCP = 0b1000

interface ChannelState {
  vSet: number
  iSet: number
  ovp: number
  ocp: number
  deltaV: number
  deltaI: number
  outputOn: boolean
  tripped: 'ovp' | 'ocp' | null
  lsrLatch: number
  loadOhms: number
}

interface SavedSetup {
  vSet: number
  iSet: number
  ovp: number
  ocp: number
}

function defaultChannel(): ChannelState {
  return {
    vSet: 1,
    iSet: 1,
    ovp: OVP_MAX,
    ocp: OCP_MAX,
    deltaV: 0.1,
    deltaI: 0.1,
    outputOn: false,
    tripped: null,
    lsrLatch: 0,
    loadOhms: 8
  }
}

export class Cpx400dpSim {
  channels: [ChannelState, ChannelState] = [defaultChannel(), defaultChannel()]
  config: 0 | 2 = 2
  private errors: number[] = []
  private memory = new Map<string, SavedSetup>()

  reset(): void {
    for (let i = 0; i < 2; i++) {
      const load = this.channels[i].loadOhms
      this.channels[i] = { ...defaultChannel(), loadOhms: load }
    }
    this.config = 2
    this.errors = []
  }

  /** Kanalın anlık ölçümlerini yük modelinden hesaplar, gerekirse trip tetikler. */
  private measure(ch: ChannelState): { v: number; i: number; mode: 'cv' | 'cc' | 'off' } {
    if (!ch.outputOn || ch.tripped) return { v: 0, i: 0, mode: 'off' }
    let v = ch.vSet
    let i = ch.loadOhms > 0 ? ch.vSet / ch.loadOhms : Number.POSITIVE_INFINITY
    let mode: 'cv' | 'cc' = 'cv'
    if (i > ch.iSet) {
      mode = 'cc'
      i = ch.iSet
      v = ch.iSet * ch.loadOhms
      ch.lsrLatch |= LSR_CC
    } else {
      ch.lsrLatch |= LSR_CV
    }
    if (v > ch.ovp) {
      this.trip(ch, 'ovp')
      return { v: 0, i: 0, mode: 'off' }
    }
    if (i > ch.ocp) {
      this.trip(ch, 'ocp')
      return { v: 0, i: 0, mode: 'off' }
    }
    return { v, i, mode }
  }

  private trip(ch: ChannelState, kind: 'ovp' | 'ocp'): void {
    ch.tripped = kind
    ch.outputOn = false
    ch.lsrLatch |= kind === 'ovp' ? LSR_OVP : LSR_OCP
  }

  private lsrRead(ch: ChannelState): number {
    // Ölçüm hesapla ki canlı CV/CC bitleri mandala işlensin
    this.measure(ch)
    let value = ch.lsrLatch
    if (ch.tripped === 'ovp') value |= LSR_OVP
    if (ch.tripped === 'ocp') value |= LSR_OCP
    ch.lsrLatch = 0
    return value
  }

  private chan(n: string): ChannelState | null {
    const idx = Number(n) - 1
    return idx === 0 || idx === 1 ? this.channels[idx] : null
  }

  private setInRange(value: number, min: number, max: number, apply: (v: number) => void): void {
    if (!Number.isFinite(value) || value < min || value > max) {
      this.errors.push(ERR_RANGE)
      return
    }
    apply(value)
  }

  /**
   * Tek komut satırını işler. Yanıt gerektiren komutlarda yanıt metni,
   * gerektirmeyenlerde null döner.
   */
  handle(rawLine: string): string | null {
    const line = rawLine.trim()
    if (line === '') return null
    let m: RegExpMatchArray | null

    // --- Test uzantıları ---
    if ((m = line.match(/^SIM:LOAD([12])\s+([\d.]+)$/i))) {
      const ch = this.chan(m[1])!
      ch.loadOhms = Number(m[2])
      return null
    }
    if ((m = line.match(/^SIM:TRIP([12])\s+(OVP|OCP)$/i))) {
      const ch = this.chan(m[1])!
      this.trip(ch, m[2].toLowerCase() as 'ovp' | 'ocp')
      return null
    }

    // --- Ortak sistem komutları ---
    if (/^\*IDN\?$/i.test(line)) return 'THURLBY THANDAR, CPX400DP, 0, 1.00'
    if (/^\*RST$/i.test(line)) {
      this.reset()
      return null
    }
    if (/^\*CLS$/i.test(line)) {
      this.errors = []
      for (const ch of this.channels) ch.lsrLatch = 0
      return null
    }
    if (/^\*OPC\??$/i.test(line)) return line.endsWith('?') ? '1' : null
    if (/^\*STB\?$/i.test(line)) return '0'
    if (/^\*TST\?$/i.test(line)) return '0'
    if (/^\*WAI$/i.test(line)) return null
    if (/^EER\?$/i.test(line)) return String(this.errors.shift() ?? 0)
    if (/^QER\?$/i.test(line)) return '0'
    if (/^LOCAL$/i.test(line)) return null
    if (/^IFLOCK$/i.test(line)) return '1'
    if (/^IFLOCK\?$/i.test(line)) return '1'
    if (/^IFUNLOCK$/i.test(line)) return '0'
    if (/^TRIPRST$/i.test(line)) {
      for (const ch of this.channels) {
        ch.tripped = null
        ch.lsrLatch &= ~(LSR_OVP | LSR_OCP)
      }
      return null
    }
    if (/^CONFIG\?$/i.test(line)) return String(this.config)
    if ((m = line.match(/^CONFIG\s+([02])$/i))) {
      this.config = Number(m[1]) as 0 | 2
      return null
    }
    if ((m = line.match(/^OPALL\s+([01])$/i))) {
      for (const ch of this.channels) {
        if (m[1] === '1') {
          if (ch.tripped) this.errors.push(ERR_TRIPPED)
          else ch.outputOn = true
        } else {
          ch.outputOn = false
        }
      }
      return null
    }

    // --- Kanal komutları ---
    if ((m = line.match(/^V([12])\?$/i))) {
      const ch = this.chan(m[1])!
      return `V${m[1]} ${ch.vSet.toFixed(3)}`
    }
    if ((m = line.match(/^I([12])\?$/i))) {
      const ch = this.chan(m[1])!
      return `I${m[1]} ${ch.iSet.toFixed(3)}`
    }
    if ((m = line.match(/^V([12])O\?$/i))) {
      const ch = this.chan(m[1])!
      return `${this.measure(ch).v.toFixed(3)}V`
    }
    if ((m = line.match(/^I([12])O\?$/i))) {
      const ch = this.chan(m[1])!
      return `${this.measure(ch).i.toFixed(3)}A`
    }
    if ((m = line.match(/^V([12])V?\s+(-?[\d.]+)$/i))) {
      const ch = this.chan(m[1])!
      this.setInRange(Number(m[2]), V_MIN, V_MAX, (v) => (ch.vSet = v))
      return null
    }
    if ((m = line.match(/^I([12])\s+(-?[\d.]+)$/i))) {
      const ch = this.chan(m[1])!
      this.setInRange(Number(m[2]), I_MIN, I_MAX, (v) => (ch.iSet = v))
      return null
    }
    if ((m = line.match(/^OVP([12])\?$/i))) {
      const ch = this.chan(m[1])!
      return `VP${m[1]} ${ch.ovp.toFixed(3)}`
    }
    if ((m = line.match(/^OCP([12])\?$/i))) {
      const ch = this.chan(m[1])!
      return `CP${m[1]} ${ch.ocp.toFixed(3)}`
    }
    if ((m = line.match(/^OVP([12])\s+(-?[\d.]+)$/i))) {
      const ch = this.chan(m[1])!
      this.setInRange(Number(m[2]), OVP_MIN, OVP_MAX, (v) => (ch.ovp = v))
      return null
    }
    if ((m = line.match(/^OCP([12])\s+(-?[\d.]+)$/i))) {
      const ch = this.chan(m[1])!
      this.setInRange(Number(m[2]), OCP_MIN, OCP_MAX, (v) => (ch.ocp = v))
      return null
    }
    if ((m = line.match(/^OP([12])\?$/i))) {
      const ch = this.chan(m[1])!
      return ch.outputOn ? '1' : '0'
    }
    if ((m = line.match(/^OP([12])\s+([01])$/i))) {
      const ch = this.chan(m[1])!
      if (m[2] === '1') {
        if (ch.tripped) this.errors.push(ERR_TRIPPED)
        else ch.outputOn = true
      } else {
        ch.outputOn = false
      }
      return null
    }
    if ((m = line.match(/^LSR([12])\?$/i))) {
      const ch = this.chan(m[1])!
      return String(this.lsrRead(ch))
    }
    if ((m = line.match(/^DELTAV([12])\?$/i))) {
      const ch = this.chan(m[1])!
      return `DELTAV${m[1]} ${ch.deltaV.toFixed(3)}`
    }
    if ((m = line.match(/^DELTAI([12])\?$/i))) {
      const ch = this.chan(m[1])!
      return `DELTAI${m[1]} ${ch.deltaI.toFixed(3)}`
    }
    if ((m = line.match(/^DELTAV([12])\s+([\d.]+)$/i))) {
      const ch = this.chan(m[1])!
      this.setInRange(Number(m[2]), 0, V_MAX, (v) => (ch.deltaV = v))
      return null
    }
    if ((m = line.match(/^DELTAI([12])\s+([\d.]+)$/i))) {
      const ch = this.chan(m[1])!
      this.setInRange(Number(m[2]), 0, I_MAX, (v) => (ch.deltaI = v))
      return null
    }
    if ((m = line.match(/^INCV([12])V?$/i))) {
      const ch = this.chan(m[1])!
      ch.vSet = Math.min(V_MAX, ch.vSet + ch.deltaV)
      return null
    }
    if ((m = line.match(/^DECV([12])V?$/i))) {
      const ch = this.chan(m[1])!
      ch.vSet = Math.max(V_MIN, ch.vSet - ch.deltaV)
      return null
    }
    if ((m = line.match(/^INCI([12])$/i))) {
      const ch = this.chan(m[1])!
      ch.iSet = Math.min(I_MAX, ch.iSet + ch.deltaI)
      return null
    }
    if ((m = line.match(/^DECI([12])$/i))) {
      const ch = this.chan(m[1])!
      ch.iSet = Math.max(I_MIN, ch.iSet - ch.deltaI)
      return null
    }
    if ((m = line.match(/^SAV([12])\s+([0-9])$/i))) {
      const ch = this.chan(m[1])!
      this.memory.set(`${m[1]}:${m[2]}`, { vSet: ch.vSet, iSet: ch.iSet, ovp: ch.ovp, ocp: ch.ocp })
      return null
    }
    if ((m = line.match(/^RCL([12])\s+([0-9])$/i))) {
      const ch = this.chan(m[1])!
      const saved = this.memory.get(`${m[1]}:${m[2]}`)
      if (!saved) {
        this.errors.push(ERR_RANGE)
        return null
      }
      ch.vSet = saved.vSet
      ch.iSet = saved.iSet
      ch.ovp = saved.ovp
      ch.ocp = saved.ocp
      return null
    }

    this.errors.push(ERR_UNKNOWN)
    return null
  }
}

