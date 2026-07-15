import type { ChannelSetpoints, LogSource } from '@shared/types'
import { ScpiConnection } from '../scpi/connection'
import type { PsuDriver } from './types'

const LSR_OVP = 0b0100
const LSR_OCP = 0b1000

function parseNum(resp: string): number {
  const n = Number(resp.trim().split(',')[0])
  if (!Number.isFinite(n)) throw new Error(`Sayı ayrıştırılamadı: "${resp}"`)
  return n
}

/**
 * Keysight E36233A (E36200 serisi) sürücüsü — LAN raw-socket, TCP 5025, SCPI.
 *
 * Komutlar kanal-liste `(@n)` sözdizimiyle gönderilir. E36200 serisinde OCP
 * ayrı bir seviye değildir; akım limitinde tetiklenir — bu yüzden `setOcp`
 * yalnızca OCP korumasını etkinleştirir, seviye değeri yok sayılır ve
 * `readSetpoints().ocp` 0 döner (arayüz OCP alanını bu türde göstermez).
 */
export class E36233aDriver implements PsuDriver {
  readonly channelCount = 2

  constructor(
    private readonly conn: ScpiConnection,
    private readonly source: LogSource = 'user'
  ) {}

  private check(ch: number): void {
    if (ch !== 1 && ch !== 2) throw new RangeError(`Geçersiz kanal: ${ch}`)
  }

  async identify(): Promise<string> {
    return this.conn.query('*IDN?', this.source)
  }

  async readChannel(ch: number): Promise<{ voltage: number; current: number; outputOn: boolean }> {
    this.check(ch)
    const [v, i, op] = await Promise.all([
      this.conn.query(`MEAS:VOLT? (@${ch})`, this.source),
      this.conn.query(`MEAS:CURR? (@${ch})`, this.source),
      this.conn.query(`OUTP? (@${ch})`, this.source)
    ])
    return { voltage: parseNum(v), current: parseNum(i), outputOn: op.trim() === '1' }
  }

  async readSetpoints(ch: number): Promise<ChannelSetpoints> {
    this.check(ch)
    const [v, i, ovp] = await Promise.all([
      this.conn.query(`VOLT? (@${ch})`, this.source),
      this.conn.query(`CURR? (@${ch})`, this.source),
      this.conn.query(`VOLT:PROT? (@${ch})`, this.source)
    ])
    return { voltage: parseNum(v), current: parseNum(i), ovp: parseNum(ovp), ocp: 0 }
  }

  async setVoltage(ch: number, volts: number): Promise<void> {
    this.check(ch)
    await this.conn.send(`VOLT ${volts.toFixed(4)},(@${ch})`, this.source)
  }

  async setCurrent(ch: number, amps: number): Promise<void> {
    this.check(ch)
    await this.conn.send(`CURR ${amps.toFixed(4)},(@${ch})`, this.source)
  }

  async setOvp(ch: number, volts: number): Promise<void> {
    this.check(ch)
    await this.conn.send(`VOLT:PROT ${volts.toFixed(4)},(@${ch})`, this.source)
  }

  /** E36200'de OCP seviyesi yoktur; yalnızca korumayı etkinleştiririz. */
  async setOcp(ch: number, _amps: number): Promise<void> {
    this.check(ch)
    await this.conn.send(`CURR:PROT:STAT ON,(@${ch})`, this.source)
  }

  async setOutput(ch: number, on: boolean): Promise<void> {
    this.check(ch)
    await this.conn.send(`OUTP ${on ? 'ON' : 'OFF'},(@${ch})`, this.source)
  }

  async setAllOutputs(on: boolean): Promise<void> {
    await this.conn.send(`OUTP ${on ? 'ON' : 'OFF'},(@1,2)`, this.source)
  }

  async readLsr(ch: number): Promise<number> {
    this.check(ch)
    const [ovp, ocp] = await Promise.all([
      this.conn.query(`VOLT:PROT:TRIP? (@${ch})`, this.source),
      this.conn.query(`CURR:PROT:TRIP? (@${ch})`, this.source)
    ])
    let bits = 0
    if (ovp.trim() === '1') bits |= LSR_OVP
    if (ocp.trim() === '1') bits |= LSR_OCP
    return bits
  }

  async tripReset(): Promise<void> {
    await this.conn.send('OUTP:PROT:CLE (@1,2)', this.source)
  }

  /** E36200 kanal izleme (tracking) modu sunmaz — işlevsiz. */
  async setTracking(_on: boolean): Promise<void> {
    // desteklenmiyor; sessizce yok say (arayüz bu türde tracking göstermez)
  }

  async readTracking(): Promise<boolean> {
    return false
  }

  async readExecutionError(): Promise<number> {
    const resp = await this.conn.query('SYST:ERR?', this.source)
    // "-222,\"Data out of range\"" → mutlak kod (DeviceManager > 0 kontrolü için)
    return Math.abs(parseNum(resp))
  }
}
