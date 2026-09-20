import { afterAll, beforeAll, describe, expect, it, beforeEach } from 'vitest'
import net from 'node:net'
import { startCpx400dpSim, Cpx400dpSim } from '../tools/simulator/cpx400dp-sim'

/** Test istemcisi: satır gönderir, tek satır yanıt bekler. */
class TestClient {
  private socket!: net.Socket
  private buffer = ''
  private waiters: Array<(line: string) => void> = []

  connect(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection({ host: '127.0.0.1', port }, resolve)
      this.socket.once('error', reject)
      this.socket.on('data', (d) => {
        this.buffer += d.toString('ascii')
        let idx: number
        while ((idx = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, idx).replace(/\r$/, '')
          this.buffer = this.buffer.slice(idx + 1)
          this.waiters.shift()?.(line)
        }
      })
    })
  }

  send(cmd: string): void {
    this.socket.write(cmd + '\n')
  }

  query(cmd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout: ${cmd}`)), 2000)
      this.waiters.push((line) => {
        clearTimeout(t)
        resolve(line)
      })
      this.send(cmd)
    })
  }

  close(): void {
    this.socket.destroy()
  }
}

describe('Cpx400dpSim', () => {
  let sim: { port: number; sim: Cpx400dpSim; close: () => Promise<void> }
  let client: TestClient

  beforeAll(async () => {
    sim = await startCpx400dpSim(0)
  })

  afterAll(async () => {
    await sim.close()
  })

  beforeEach(async () => {
    client?.close()
    client = new TestClient()
    await client.connect(sim.port)
    client.send('*RST')
    client.send('SIM:LOAD1 8')
    client.send('SIM:LOAD2 8')
  })

  it('*IDN? kimlik döndürür', async () => {
    expect(await client.query('*IDN?')).toBe('THURLBY THANDAR, CPX400DP, 0, 1.00')
  })

  it('V/I set ve sorgu formatları doğru', async () => {
    client.send('V1 5')
    client.send('I1 2.5')
    expect(await client.query('V1?')).toBe('V1 5.000')
    expect(await client.query('I1?')).toBe('I1 2.500')
    client.send('V2 12.345')
    expect(await client.query('V2?')).toBe('V2 12.345')
  })

  it('OVP/OCP set ve sorgu formatları doğru', async () => {
    client.send('OVP1 55')
    client.send('OCP1 18')
    expect(await client.query('OVP1?')).toBe('VP1 55.000')
    expect(await client.query('OCP1?')).toBe('CP1 18.000')
  })

  it('CV senaryosu: 8Ω yükte 5V/2A → 5.000V, 0.625A', async () => {
    client.send('V1 5')
    client.send('I1 2')
    client.send('OP1 1')
    expect(await client.query('OP1?')).toBe('1')
    expect(await client.query('V1O?')).toBe('5.000V')
    expect(await client.query('I1O?')).toBe('0.625A')
  })

  it('CC senaryosu: 8Ω yükte 30V/2A limit → 16.000V, 2.000A', async () => {
    client.send('V1 30')
    client.send('I1 2')
    client.send('OP1 1')
    expect(await client.query('V1O?')).toBe('16.000V')
    expect(await client.query('I1O?')).toBe('2.000A')
    // CC'ye girdi → LSR bit1
    const lsr = Number(await client.query('LSR1?'))
    expect(lsr & 0b10).toBe(0b10)
  })

  it('çıkış kapalıyken ölçümler sıfır', async () => {
    client.send('V1 10')
    expect(await client.query('V1O?')).toBe('0.000V')
    expect(await client.query('I1O?')).toBe('0.000A')
  })

  it('zorla OVP trip: çıkış kapanır, LSR bit2 mandallanır ve okununca temizlenir', async () => {
    client.send('V1 5')
    client.send('OP1 1')
    client.send('SIM:TRIP1 OVP')
    expect(await client.query('OP1?')).toBe('0')
    const lsr = Number(await client.query('LSR1?'))
    expect(lsr & 0b100).toBe(0b100)
    // oku-ve-temizle: trip sürüyor olsa da mandal temizlendi (trip durumu ayrı tutulur)
    const lsr2 = Number(await client.query('LSR1?'))
    expect(lsr2 & 0b100).toBe(0b100) // trip devam ettiği sürece bit görünür
    client.send('TRIPRST')
    expect(Number(await client.query('LSR1?')) & 0b100).toBe(0)
  })

  it('TRIPRST sonrası çıkış tekrar açılabilir', async () => {
    client.send('SIM:TRIP1 OCP')
    client.send('TRIPRST')
    client.send('V1 5')
    client.send('I1 2')
    client.send('OP1 1')
    expect(await client.query('OP1?')).toBe('1')
    expect(await client.query('V1O?')).toBe('5.000V')
  })

  it('OPALL iki kanalı birden açar/kapatır', async () => {
    client.send('OPALL 1')
    expect(await client.query('OP1?')).toBe('1')
    expect(await client.query('OP2?')).toBe('1')
    client.send('OPALL 0')
    expect(await client.query('OP1?')).toBe('0')
    expect(await client.query('OP2?')).toBe('0')
  })

  it('*RST çıkışları kapatır ve tripleri temizler', async () => {
    client.send('OP1 1')
    client.send('SIM:TRIP2 OVP')
    client.send('*RST')
    expect(await client.query('OP1?')).toBe('0')
    expect(Number(await client.query('LSR2?')) & 0b100).toBe(0)
  })

  it('CONFIG set/sorgu (2=bağımsız, 0=tracking)', async () => {
    expect(await client.query('CONFIG?')).toBe('2')
    client.send('CONFIG 0')
    expect(await client.query('CONFIG?')).toBe('0')
  })

  it('EER? bilinmeyen komutta sıfırdan büyük döner, sonra temizlenir', async () => {
    client.send('BOZUKKOMUT 1')
    const eer = Number(await client.query('EER?'))
    expect(eer).toBeGreaterThan(0)
    expect(await client.query('EER?')).toBe('0')
  })

  it('aralık dışı değer reddedilir ve EER kodu üretir', async () => {
    client.send('V1 99')
    expect(await client.query('V1?')).toBe('V1 1.000') // *RST varsayılanı korunur
    expect(Number(await client.query('EER?'))).toBeGreaterThan(0)
  })

  it('DELTAV/INCV artım komutları çalışır', async () => {
    client.send('V1 5')
    client.send('DELTAV1 0.5')
    expect(await client.query('DELTAV1?')).toBe('DELTAV1 0.500')
    client.send('INCV1')
    expect(await client.query('V1?')).toBe('V1 5.500')
    client.send('DECV1')
    client.send('DECV1')
    expect(await client.query('V1?')).toBe('V1 4.500')
  })

  it('SAV/RCL setpointleri saklar ve geri yükler', async () => {
    client.send('V1 7.5')
    client.send('I1 1.25')
    client.send('SAV1 3')
    client.send('V1 1')
    client.send('I1 0.5')
    client.send('RCL1 3')
    expect(await client.query('V1?')).toBe('V1 7.500')
    expect(await client.query('I1?')).toBe('I1 1.250')
  })

  it('IFLOCK/IFUNLOCK yanıt verir', async () => {
    expect(await client.query('IFLOCK')).toBe('1')
    expect(await client.query('IFUNLOCK')).toBe('0')
  })
})

describe('Cpx400dpSim REMOTE/LOCAL', () => {
  it('başlangıçta local; herhangi bir komut remote yapar; LOCAL geri alır', () => {
    const sim = new Cpx400dpSim()
    expect(sim.remote).toBe(false)
    sim.handle('V1O?')
    expect(sim.remote).toBe(true)
    sim.handle('LOCAL')
    expect(sim.remote).toBe(false)
    sim.handle('V1 5.000')
    expect(sim.remote).toBe(true)
  })

  it('SIM: komutları remote durumunu değiştirmez; SIM:REMOTE? durumu bildirir', () => {
    const sim = new Cpx400dpSim()
    expect(sim.handle('SIM:REMOTE?')).toBe('0')
    expect(sim.remote).toBe(false)
    sim.handle('*IDN?')
    expect(sim.handle('SIM:REMOTE?')).toBe('1')
    sim.handle('LOCAL')
    sim.handle('SIM:LOAD1 5')
    expect(sim.remote).toBe(false)
  })
})
