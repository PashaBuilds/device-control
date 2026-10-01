import type { ChannelSetpoints, LogSource } from '@shared/types'
import { ScpiConnection } from '../scpi/connection'
import type { PsuDriver } from './types'

const LSR_OVP = 0b0100
const LSR_OCP = 0b1000
// STATus:QUEStionable:CONDition bitleri
const QUES_OV = 1
const QUES_OC = 2

function parseNum(resp: string): number {
  const n = Number(resp.trim().split(',')[0])
  if (!Number.isFinite(n)) throw new Error(`Sayı ayrıştırılamadı: "${resp}"`)
  return n
}

/**
 * Keysight N5700 serisi (ör. N5745A) tek çıkışlı sistem güç kaynağı sürücüsü —
 * LAN raw-socket, TCP 5025, kanal listesiz SCPI.
 *
 * OCP ayrı bir seviye değil, aç/kapat korumadır (CC'ye girince çıkışı keser);
 * arayüz bu türde OCP alanı göstermez, `setOcp` işlem yapmaz. Trip durumu
 * `STAT:QUES:COND?` bitlerinden okunup ortak LSR bit düzenine çevrilir.
 */
export class N5700Driver implements PsuDriver {
  readonly channelCount = 1

  constructor(
    private readonly conn: ScpiConnection,
    private readonly source: LogSource = 'user'
  ) {}

  private check(ch: number): void {
    if (ch !== 1) throw new RangeError(`Geçersiz kanal: ${ch}`)
  }

  async identify(): Promise<string> {
    return this.conn.query('*IDN?', this.source)
  }

  async readChannel(ch: number): Promise<{ voltage: number; current: number; outputOn: boolean }> {
    this.check(ch)
    const [v, i, op] = await Promise.all([
      this.conn.query('MEAS:VOLT?', this.source),
      this.conn.query('MEAS:CURR?', this.source),
      this.conn.query('OUTP?', this.source)
    ])
    return { voltage: parseNum(v), current: parseNum(i), outputOn: op.trim() === '1' }
  }

  async readSetpoints(ch: number): Promise<ChannelSetpoints> {
    this.check(ch)
    const [v, i, ovp] = await Promise.all([
      this.conn.query('VOLT?', this.source),
      this.conn.query('CURR?', this.source),
      this.conn.query('VOLT:PROT?', this.source)
    ])
    return { voltage: parseNum(v), current: parseNum(i), ovp: parseNum(ovp), ocp: 0 }
  }

  async setVoltage(ch: number, volts: number): Promise<void> {
    this.check(ch)
    await this.conn.send(`VOLT ${volts.toFixed(4)}`, this.source)
  }

  async setCurrent(ch: number, amps: number): Promise<void> {
    this.check(ch)
    await this.conn.send(`CURR ${amps.toFixed(4)}`, this.source)
  }

  async setOvp(ch: number, volts: number): Promise<void> {
    this.check(ch)
    await this.conn.send(`VOLT:PROT ${volts.toFixed(4)}`, this.source)
  }

  /** N5700'de OCP seviyesi yok; arayüzde alan da yok — işlem yapılmaz. */
  async setOcp(ch: number, _amps: number): Promise<void> {
    this.check(ch)
  }

  async setOutput(ch: number, on: boolean): Promise<void> {
    this.check(ch)
    await this.conn.send(`OUTP ${on ? 'ON' : 'OFF'}`, this.source)
  }

  async setAllOutputs(on: boolean): Promise<void> {
    await this.conn.send(`OUTP ${on ? 'ON' : 'OFF'}`, this.source)
  }

  async readLsr(ch: number): Promise<number> {
    this.check(ch)
    const cond = parseNum(await this.conn.query('STAT:QUES:COND?', this.source))
    let bits = 0
    if (cond & QUES_OV) bits |= LSR_OVP
    if (cond & QUES_OC) bits |= LSR_OCP
    return bits
  }

  async tripReset(): Promise<void> {
    await this.conn.send('OUTP:PROT:CLE', this.source)
  }

  /** N5700 kanal izleme modu sunmaz — işlevsiz. */
  async setTracking(_on: boolean): Promise<void> {
    // desteklenmiyor (arayüz bu türde tracking göstermez)
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
