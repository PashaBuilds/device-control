import net from 'node:net'
import type { AddressInfo } from 'node:net'

/**
 * Keysight E36233A (E36200 serisi) çift çıkış güç kaynağı SCPI simülatörü.
 *
 * Gerçek cihazın LAN raw-socket (TCP 5025) üzerindeki SCPI komut setinin
 * uygulama kapsamındaki alt kümesini, kanal-liste `(@n)` sözdizimiyle konuşur.
 * Yanıtlar LF (`\n`) ile sonlandırılır.
 *
 * `SIM:` önekli komutlar yalnızca test içindir (yük değiştirme, zorla trip);
 * gerçek sürücü asla `SIM:` göndermez.
 */

const V_MAX = 30
const I_MAX = 10
const OVP_MIN = 0
const OVP_MAX = 33

// SCPI hata kuyruğu kodları (E36200 tarzı, negatif)
const ERR_UNDEF = -113 // Undefined header
const ERR_RANGE = -222 // Data out of range

interface ChannelState {
  vSet: number
  iSet: number
  ovp: number
  ocpEnabled: boolean
  outputOn: boolean
  ovpTripped: boolean
  ocpTripped: boolean
  loadOhms: number
}

function defaultChannel(): ChannelState {
  return {
    vSet: 0,
    iSet: I_MAX,
    ovp: OVP_MAX,
    ocpEnabled: false,
    outputOn: false,
    ovpTripped: false,
    ocpTripped: false,
    loadOhms: 10
  }
}

export class E36233aSim {
  channels: [ChannelState, ChannelState] = [defaultChannel(), defaultChannel()]
  private errors: number[] = []

  reset(): void {
    for (let i = 0; i < 2; i++) {
      const load = this.channels[i].loadOhms
      this.channels[i] = { ...defaultChannel(), loadOhms: load }
    }
    this.errors = []
  }

  private chan(n: number): ChannelState | null {
    return n === 1 || n === 2 ? this.channels[n - 1] : null
  }

  /** Kanalın anlık ölçümü; gerekirse OVP/OCP tripler. */
  private measure(ch: ChannelState): { v: number; i: number; cc: boolean } {
    if (!ch.outputOn || ch.ovpTripped || ch.ocpTripped) return { v: 0, i: 0, cc: false }
    let v = ch.vSet
    let i = ch.loadOhms > 0 ? ch.vSet / ch.loadOhms : Number.POSITIVE_INFINITY
    let cc = false
    if (i > ch.iSet) {
      cc = true
      i = ch.iSet
      v = ch.iSet * ch.loadOhms
    }
    if (v > ch.ovp) {
      ch.ovpTripped = true
      ch.outputOn = false
      return { v: 0, i: 0, cc: false }
    }
    if (cc && ch.ocpEnabled) {
      ch.ocpTripped = true
      ch.outputOn = false
      return { v: 0, i: 0, cc: false }
    }
    return { v, i, cc }
  }

  private setInRange(v: number, min: number, max: number, apply: (x: number) => void): void {
    if (!Number.isFinite(v) || v < min || v > max) {
      this.errors.push(ERR_RANGE)
      return
    }
    apply(v)
  }

  /** `(@1)` / `(@1,2)` kanal listesini ayıklar; kalan komut metnini de döndürür. */
  private parseChannels(line: string): { channels: number[]; rest: string } {
    const m = line.match(/\(@([\d,]+)\)/)
    if (!m) return { channels: [], rest: line.trim() }
    const channels = m[1].split(',').map((s) => Number(s.trim()))
    const rest = line.replace(m[0], '').replace(/,\s*$/, '').trim()
    return { channels, rest }
  }

  /** Bir komut satırını işler; yanıt (sorgu) ya da null döndürür. */
  handle(rawLine: string): string | null {
    const line = rawLine.trim()
    if (line === '') return null
    let m: RegExpMatchArray | null

    // --- Test uzantıları ---
    if ((m = line.match(/^SIM:LOAD([12])\s+([\d.]+)$/i))) {
      this.chan(Number(m[1]))!.loadOhms = Number(m[2])
      return null
    }
    if ((m = line.match(/^SIM:TRIP([12])\s+(OVP|OCP)$/i))) {
      const ch = this.chan(Number(m[1]))!
      if (m[2].toUpperCase() === 'OVP') ch.ovpTripped = true
      else ch.ocpTripped = true
      ch.outputOn = false
      return null
    }

    // --- Ortak ---
    if (/^\*IDN\?$/i.test(line)) return 'Keysight Technologies,E36233A,MY59230001,1.2.3-1.0.5'
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
      const msg = code === ERR_RANGE ? 'Data out of range' : 'Undefined header'
      return `${code},"${msg}"`
    }

    // --- Kanal komutları (kanal-liste ayıklanır) ---
    const { channels, rest } = this.parseChannels(line)
    const targets = channels.length > 0 ? channels : [1]

    // Sorgular tek kanal varsayar (ilk hedef)
    const first = this.chan(targets[0])

    if (/^VOLT(?:age)?\?$/i.test(rest)) return first ? first.vSet.toFixed(4) : '0'
    if (/^CURR(?:ent)?\?$/i.test(rest)) return first ? first.iSet.toFixed(4) : '0'
    if (/^VOLT(?:age)?:PROT(?:ection)?(?::LEV(?:el)?)?\?$/i.test(rest))
      return first ? first.ovp.toFixed(4) : '0'
    if (/^VOLT(?:age)?:PROT(?:ection)?:TRIP(?:ped)?\?$/i.test(rest))
      return first?.ovpTripped ? '1' : '0'
    if (/^CURR(?:ent)?:PROT(?:ection)?:TRIP(?:ped)?\?$/i.test(rest))
      return first?.ocpTripped ? '1' : '0'
    if (/^CURR(?:ent)?:PROT(?:ection)?:STAT(?:e)?\?$/i.test(rest))
      return first?.ocpEnabled ? '1' : '0'
    if (/^OUTP(?:ut)?\?$/i.test(rest)) return first?.outputOn ? '1' : '0'
    if (/^MEAS(?:ure)?:VOLT(?:age)?(?::DC)?\?$/i.test(rest))
      return first ? this.measure(first).v.toFixed(6) : '0'
    if (/^MEAS(?:ure)?:CURR(?:ent)?(?::DC)?\?$/i.test(rest))
      return first ? this.measure(first).i.toFixed(6) : '0'

    // Set komutları (tüm hedef kanallara uygulanır)
    if ((m = rest.match(/^VOLT(?:age)?\s+([-\d.eE+]+)$/i))) {
      for (const t of targets) {
        const ch = this.chan(t)
        if (ch) this.setInRange(Number(m[1]), 0, V_MAX, (x) => (ch.vSet = x))
      }
      return null
    }
    if ((m = rest.match(/^CURR(?:ent)?\s+([-\d.eE+]+)$/i))) {
      for (const t of targets) {
        const ch = this.chan(t)
        if (ch) this.setInRange(Number(m[1]), 0, I_MAX, (x) => (ch.iSet = x))
      }
      return null
    }
    if ((m = rest.match(/^VOLT(?:age)?:PROT(?:ection)?(?::LEV(?:el)?)?\s+([-\d.eE+]+)$/i))) {
      for (const t of targets) {
        const ch = this.chan(t)
        if (ch) this.setInRange(Number(m[1]), OVP_MIN, OVP_MAX, (x) => (ch.ovp = x))
      }
      return null
    }
    if ((m = rest.match(/^CURR(?:ent)?:PROT(?:ection)?:STAT(?:e)?\s+(ON|OFF|1|0)$/i))) {
      const on = /^(ON|1)$/i.test(m[1])
      for (const t of targets) {
        const ch = this.chan(t)
        if (ch) ch.ocpEnabled = on
      }
      return null
    }
    if ((m = rest.match(/^OUTP(?:ut)?\s+(ON|OFF|1|0)$/i))) {
      const on = /^(ON|1)$/i.test(m[1])
      for (const t of targets) {
        const ch = this.chan(t)
        if (!ch) continue
        if (on) {
          if (ch.ovpTripped || ch.ocpTripped) this.errors.push(ERR_RANGE)
          else ch.outputOn = true
        } else {
          ch.outputOn = false
        }
      }
      return null
    }
    if (/^OUTP(?:ut)?:PROT(?:ection)?:CLE(?:ar)?$/i.test(rest)) {
      for (const t of targets) {
        const ch = this.chan(t)
        if (ch) {
          ch.ovpTripped = false
          ch.ocpTripped = false
        }
      }
      return null
    }

    this.errors.push(ERR_UNDEF)
    return null
  }
}

export interface E36233aSimHandle {
  port: number
  sim: E36233aSim
  close: () => Promise<void>
}

export function startE36233aSim(
  port: number,
  onLog?: (msg: string) => void
): Promise<E36233aSimHandle> {
  const sim = new E36233aSim()
  const sockets = new Set<net.Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => sockets.delete(socket))
    let buf = ''
    socket.on('data', (d) => {
      buf += d.toString('ascii')
      let idx: number
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '')
        buf = buf.slice(idx + 1)
        onLog?.(`rx: ${line}`)
        const resp = sim.handle(line)
        if (resp !== null) {
          onLog?.(`tx: ${resp}`)
          socket.write(resp + '\n')
        }
      }
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        sim,
        close: () =>
          new Promise((r) => {
            for (const s of sockets) s.destroy()
            server.close(() => r())
          })
      })
    })
  })
}
