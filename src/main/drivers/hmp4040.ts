import type { ChannelSetpoints, LogSource } from '@shared/types'
import { ScpiConnection } from '../scpi/connection'
import type { PsuDriver } from './types'

const LSR_OVP = 0b0100
const LSR_OCP = 0b1000
const CHANNELS = [1, 2, 3, 4]

function parseNum(resp: string): number {
  const n = Number(resp.trim().split(',')[0])
  if (!Number.isFinite(n)) throw new Error(`Sayı ayrıştırılamadı: "${resp}"`)
  return n
}

const isOn = (resp: string): boolean => resp.trim() === '1'

/**
 * Rohde & Schwarz HMP4040 sürücüsü — LAN (HO732), SCPI soketi TCP 5025.
 *
 * HMP'de komutlar **seçili kanala** gider (`INST:NSEL n`). Arka plan yoklaması
 * araya girip kanal seçimini değiştirmesin diye her işlem "seç + komutlar" grubu
 * olarak bağlantı kuyruğuna aynı anda (tek tikte) eklenir; kuyruk FIFO olduğundan
 * grup bölünmez. Kılavuzun önerdiği gibi her komut ayrı satırda gider.
 *
 * Çıkış iki katmanlıdır: kanal bazında `OUTP:SEL` (kanal etkin) ve cihaz genelinde
 * `OUTP:GEN` (ana çıkış); kanal ancak ikisi de açıkken çıkış verir. OCP ayrı seviye
 * değil, akım limitinde açan elektronik sigortadır (`FUSE`) — arayüzde gizli.
 */
export class Hmp4040Driver implements PsuDriver {
  readonly channelCount = 4

  constructor(
    private readonly conn: ScpiConnection,
    private readonly source: LogSource = 'user'
  ) {}

  private check(ch: number): void {
    if (!CHANNELS.includes(ch)) throw new RangeError(`Geçersiz kanal: ${ch}`)
  }

  /** Kanalı seçip sorguları aynı grupta gönderir; yanıtları sırayla döndürür. */
  private async queryOn(ch: number, queries: string[]): Promise<string[]> {
    this.check(ch)
    const sel = this.conn.send(`INST:NSEL ${ch}`, this.source)
    const replies = queries.map((q) => this.conn.query(q, this.source))
    const [, ...out] = await Promise.all([sel, ...replies])
    return out
  }

  /** Komut grubunu (seçimler dahil) bölünmeden kuyruğa ekler. */
  private async sendGroup(cmds: string[]): Promise<void> {
    await Promise.all(cmds.map((c) => this.conn.send(c, this.source)))
  }

  async identify(): Promise<string> {
    const idn = await this.conn.query('*IDN?', this.source)
    // Karma mod: uzaktan kontrol sırasında ön panel de kullanılabilir kalsın
    await this.conn.send('SYST:MIX', this.source)
    // Eski ürün yazılımı SYST:MIX'i tanımıyorsa oluşan hatayı kuyruktan temizle
    // (yoksa ilk set komutunun hata denetimine karışır)
    for (let i = 0; i < 5; i++) {
      if (parseNum(await this.conn.query('SYST:ERR?', this.source)) === 0) break
    }
    return idn
  }

  async readChannel(ch: number): Promise<{ voltage: number; current: number; outputOn: boolean }> {
    const [v, i, sel, gen] = await this.queryOn(ch, ['MEAS:VOLT?', 'MEAS:CURR?', 'OUTP:SEL?', 'OUTP:GEN?'])
    return { voltage: parseNum(v), current: parseNum(i), outputOn: isOn(sel) && isOn(gen) }
  }

  async readSetpoints(ch: number): Promise<ChannelSetpoints> {
    const [v, i, ovp] = await this.queryOn(ch, ['VOLT?', 'CURR?', 'VOLT:PROT?'])
    return { voltage: parseNum(v), current: parseNum(i), ovp: parseNum(ovp), ocp: 0 }
  }

  async setVoltage(ch: number, volts: number): Promise<void> {
    this.check(ch)
    await this.sendGroup([`INST:NSEL ${ch}`, `VOLT ${volts.toFixed(3)}`])
  }

  async setCurrent(ch: number, amps: number): Promise<void> {
    this.check(ch)
    await this.sendGroup([`INST:NSEL ${ch}`, `CURR ${amps.toFixed(4)}`])
  }

  async setOvp(ch: number, volts: number): Promise<void> {
    this.check(ch)
    await this.sendGroup([`INST:NSEL ${ch}`, `VOLT:PROT ${volts.toFixed(2)}`])
  }

  /** HMP'de OCP seviyesi yok; akım limitinde açan elektronik sigortayı etkinleştirir. */
  async setOcp(ch: number, _amps: number): Promise<void> {
    this.check(ch)
    await this.sendGroup([`INST:NSEL ${ch}`, 'FUSE ON'])
  }

  /**
   * Açarken: ana çıkış kapalıysa önce diğer kanalların "etkin" işareti kaldırılır —
   * ön panelden etkin bırakılmış bir kanal ana çıkışla birlikte istemeden açılmasın.
   * Kapatırken yalnızca bu kanal devre dışı kalır; diğerleri etkilenmez.
   */
  async setOutput(ch: number, on: boolean): Promise<void> {
    this.check(ch)
    if (!on) {
      await this.sendGroup([`INST:NSEL ${ch}`, 'OUTP:SEL OFF'])
      return
    }
    const general = isOn(await this.conn.query('OUTP:GEN?', this.source))
    const cmds: string[] = []
    if (!general) {
      for (const other of CHANNELS.filter((c) => c !== ch)) cmds.push(`INST:NSEL ${other}`, 'OUTP:SEL OFF')
    }
    cmds.push(`INST:NSEL ${ch}`, 'OUTP:SEL ON', 'OUTP:GEN ON')
    await this.sendGroup(cmds)
  }

  async setAllOutputs(on: boolean): Promise<void> {
    if (!on) {
      await this.sendGroup(['OUTP:GEN OFF'])
      return
    }
    const cmds = CHANNELS.flatMap((c) => [`INST:NSEL ${c}`, 'OUTP:SEL ON'])
    cmds.push('OUTP:GEN ON')
    await this.sendGroup(cmds)
  }

  async readLsr(ch: number): Promise<number> {
    const [ovp, fuse] = await this.queryOn(ch, ['VOLT:PROT:TRIP?', 'FUSE:TRIP?'])
    let bits = 0
    if (isOn(ovp)) bits |= LSR_OVP
    if (isOn(fuse)) bits |= LSR_OCP
    return bits
  }

  /** OVP tripleri temizlenir; sigorta tripi kanal yeniden etkinleştirilince kalkar. */
  async tripReset(): Promise<void> {
    await this.sendGroup(CHANNELS.flatMap((c) => [`INST:NSEL ${c}`, 'VOLT:PROT:CLE']))
  }

  /** HMP'de kanal izleme (tracking) uzaktan sunulmuyor — işlevsiz. */
  async setTracking(_on: boolean): Promise<void> {
    // desteklenmiyor; arayüz bu türde tracking göstermez
  }

  async readTracking(): Promise<boolean> {
    return false
  }

  async readExecutionError(): Promise<number> {
    // '0, "No error"' / '-222, "Data out of range"' → mutlak kod
    return Math.abs(parseNum(await this.conn.query('SYST:ERR?', this.source)))
  }
}
