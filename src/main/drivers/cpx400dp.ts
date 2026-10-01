import type { DeviceKind, ChannelSetpoints, LogSource } from '@shared/types'
import { ScpiConnection } from '../scpi/connection'
import type { PsuDriver } from './types'
import { E36233aDriver } from './e36233a'
import { N5700Driver } from './n5700'

/** `"V1 5.000"` / `"DELTAV1 0.500"` biçimindeki yanıtlardan sayıyı ayıklar. */
export function parseNamedValue(resp: string): number {
  const m = resp.trim().match(/^\S+\s+(-?[\d.]+)$/)
  if (!m) throw new Error(`Beklenmeyen yanıt biçimi: "${resp}"`)
  const value = Number(m[1])
  if (!Number.isFinite(value)) throw new Error(`Sayı ayrıştırılamadı: "${resp}"`)
  return value
}

/** `"5.001V"` / `"0.625A"` biçimindeki ölçüm yanıtlarından sayıyı ayıklar. */
export function parseSuffixed(resp: string): number {
  const m = resp.trim().match(/^(-?[\d.]+)\s*[VA]$/i)
  if (!m) throw new Error(`Beklenmeyen ölçüm yanıtı: "${resp}"`)
  const value = Number(m[1])
  if (!Number.isFinite(value)) throw new Error(`Sayı ayrıştırılamadı: "${resp}"`)
  return value
}

/** Aim-TTi CPX400DP sürücüsü (LAN, TCP 9221). */
export class Cpx400dpDriver implements PsuDriver {
  readonly channelCount = 2

  /** source: bu sürücü örneğinin ürettiği trafiğin log etiketi (kullanıcı/yoklama) */
  constructor(
    private readonly conn: ScpiConnection,
    private readonly source: LogSource = 'user'
  ) {}

  private checkChannel(ch: number): void {
    if (ch !== 1 && ch !== 2) throw new RangeError(`Geçersiz kanal: ${ch}`)
  }

  async identify(): Promise<string> {
    return this.conn.query('*IDN?', this.source)
  }

  async readChannel(ch: number): Promise<{ voltage: number; current: number; outputOn: boolean }> {
    this.checkChannel(ch)
    const [v, i, op] = await Promise.all([
      this.conn.query(`V${ch}O?`, this.source),
      this.conn.query(`I${ch}O?`, this.source),
      this.conn.query(`OP${ch}?`, this.source)
    ])
    return { voltage: parseSuffixed(v), current: parseSuffixed(i), outputOn: op.trim() === '1' }
  }

  async readSetpoints(ch: number): Promise<ChannelSetpoints> {
    this.checkChannel(ch)
    const [v, i, ovp, ocp] = await Promise.all([
      this.conn.query(`V${ch}?`, this.source),
      this.conn.query(`I${ch}?`, this.source),
      this.conn.query(`OVP${ch}?`, this.source),
      this.conn.query(`OCP${ch}?`, this.source)
    ])
    return {
      voltage: parseNamedValue(v),
      current: parseNamedValue(i),
      ovp: parseNamedValue(ovp),
      ocp: parseNamedValue(ocp)
    }
  }

  async setVoltage(ch: number, volts: number): Promise<void> {
    this.checkChannel(ch)
    await this.conn.send(`V${ch} ${volts.toFixed(3)}`, this.source)
  }

  async setCurrent(ch: number, amps: number): Promise<void> {
    this.checkChannel(ch)
    await this.conn.send(`I${ch} ${amps.toFixed(3)}`, this.source)
  }

  async setOvp(ch: number, volts: number): Promise<void> {
    this.checkChannel(ch)
    await this.conn.send(`OVP${ch} ${volts.toFixed(3)}`, this.source)
  }

  async setOcp(ch: number, amps: number): Promise<void> {
    this.checkChannel(ch)
    await this.conn.send(`OCP${ch} ${amps.toFixed(3)}`, this.source)
  }

  async setOutput(ch: number, on: boolean): Promise<void> {
    this.checkChannel(ch)
    await this.conn.send(`OP${ch} ${on ? 1 : 0}`, this.source)
  }

  async setAllOutputs(on: boolean): Promise<void> {
    await this.conn.send(`OPALL ${on ? 1 : 0}`, this.source)
  }

  async readLsr(ch: number): Promise<number> {
    this.checkChannel(ch)
    const resp = await this.conn.query(`LSR${ch}?`, this.source)
    const value = Number(resp.trim())
    if (!Number.isFinite(value)) throw new Error(`Beklenmeyen LSR yanıtı: "${resp}"`)
    return value
  }

  async tripReset(): Promise<void> {
    await this.conn.send('TRIPRST', this.source)
  }

  async setTracking(on: boolean): Promise<void> {
    // CONFIG 0 = izleme (tracking), CONFIG 2 = bağımsız çift çıkış
    await this.conn.send(`CONFIG ${on ? 0 : 2}`, this.source)
  }

  async readTracking(): Promise<boolean> {
    const resp = await this.conn.query('CONFIG?', this.source)
    return resp.trim() === '0'
  }

  async readExecutionError(): Promise<number> {
    const resp = await this.conn.query('EER?', this.source)
    return Number(resp.trim())
  }
}

export function createDriver(
  kind: DeviceKind,
  conn: ScpiConnection,
  source: LogSource = 'user'
): PsuDriver {
  switch (kind) {
    case 'cpx400dp':
      return new Cpx400dpDriver(conn, source)
    case 'e36233a':
      return new E36233aDriver(conn, source)
    case 'n5745a':
      return new N5700Driver(conn, source)
    default:
      throw new Error(`SCPI güç kaynağı sürücüsü olmayan cihaz türü: ${kind}`)
  }
}
