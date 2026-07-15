import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import net from 'node:net'
import { AddressInfo } from 'node:net'
import { startE36233aSim, E36233aSim } from '../tools/simulator/e36233a-sim'

/** Basit satır bazlı test istemcisi (LF sonlandırma). */
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

describe('E36233aSim (Keysight E36200 TCF/SCPI taklidi)', () => {
  let sim: { port: number; sim: E36233aSim; close: () => Promise<void> }
  let client: TestClient

  beforeAll(async () => {
    sim = await startE36233aSim(0)
  })
  afterAll(async () => {
    await sim.close()
  })
  beforeEach(async () => {
    client?.close()
    client = new TestClient()
    await client.connect(sim.port)
    client.send('*RST')
    client.send('SIM:LOAD1 10')
    client.send('SIM:LOAD2 10')
  })

  it('*IDN? Keysight kimliği döndürür', async () => {
    expect(await client.query('*IDN?')).toMatch(/Keysight Technologies,E36233A/)
  })

  it('kanal-liste sözdizimiyle V/I set ve sorgu', async () => {
    client.send('VOLT 12.5,(@1)')
    client.send('CURR 3.25,(@1)')
    expect(Number(await client.query('VOLT? (@1)'))).toBeCloseTo(12.5, 3)
    expect(Number(await client.query('CURR? (@1)'))).toBeCloseTo(3.25, 3)
    // kanal 2 bağımsız
    expect(Number(await client.query('VOLT? (@2)'))).toBeCloseTo(0, 3)
  })

  it('OVP set/sorgu', async () => {
    client.send('VOLT:PROT 28,(@1)')
    expect(Number(await client.query('VOLT:PROT? (@1)'))).toBeCloseTo(28, 3)
  })

  it('CV senaryosu: 10Ω, 5V/2A → MEAS 5.0V / 0.5A', async () => {
    client.send('VOLT 5,(@1)')
    client.send('CURR 2,(@1)')
    client.send('OUTP ON,(@1)')
    expect(await client.query('OUTP? (@1)')).toBe('1')
    expect(Number(await client.query('MEAS:VOLT? (@1)'))).toBeCloseTo(5, 2)
    expect(Number(await client.query('MEAS:CURR? (@1)'))).toBeCloseTo(0.5, 2)
  })

  it('CC senaryosu: 10Ω, 20V/1A limit → MEAS 10V / 1A', async () => {
    client.send('VOLT 20,(@1)')
    client.send('CURR 1,(@1)')
    client.send('OUTP ON,(@1)')
    expect(Number(await client.query('MEAS:VOLT? (@1)'))).toBeCloseTo(10, 2)
    expect(Number(await client.query('MEAS:CURR? (@1)'))).toBeCloseTo(1, 2)
  })

  it('çıkış kapalıyken ölçüm sıfır', async () => {
    client.send('VOLT 10,(@1)')
    expect(Number(await client.query('MEAS:VOLT? (@1)'))).toBeCloseTo(0, 3)
  })

  it('OVP trip: çıkış kapanır, VOLT:PROT:TRIP? = 1, temizlenince açılabilir', async () => {
    client.send('VOLT 5,(@1)')
    client.send('OUTP ON,(@1)')
    client.send('SIM:TRIP1 OVP')
    expect(await client.query('OUTP? (@1)')).toBe('0')
    expect(await client.query('VOLT:PROT:TRIP? (@1)')).toBe('1')
    client.send('OUTP:PROT:CLE (@1)')
    expect(await client.query('VOLT:PROT:TRIP? (@1)')).toBe('0')
    client.send('OUTP ON,(@1)')
    expect(await client.query('OUTP? (@1)')).toBe('1')
  })

  it('OCP: etkinken CC moduna girince tetiklenir', async () => {
    client.send('CURR:PROT:STAT ON,(@1)')
    client.send('VOLT 20,(@1)')
    client.send('CURR 1,(@1)')
    client.send('OUTP ON,(@1)')
    // ilk ölçüm CC'yi tespit edip OCP tripler
    await client.query('MEAS:CURR? (@1)')
    expect(await client.query('CURR:PROT:TRIP? (@1)')).toBe('1')
    expect(await client.query('OUTP? (@1)')).toBe('0')
  })

  it('OUTP çoklu kanal-liste (@1,2) ikisini birden açar', async () => {
    client.send('OUTP ON,(@1,2)')
    expect(await client.query('OUTP? (@1)')).toBe('1')
    expect(await client.query('OUTP? (@2)')).toBe('1')
    client.send('OUTP OFF,(@1,2)')
    expect(await client.query('OUTP? (@1)')).toBe('0')
  })

  it('SYST:ERR? sırasız komutta hata kodu, sonra No error', async () => {
    client.send('VOLT 999,(@1)') // aralık dışı
    const err = await client.query('SYST:ERR?')
    expect(err).toMatch(/-2\d\d/) // -222 Data out of range benzeri
    expect(await client.query('SYST:ERR?')).toMatch(/\+0,"No error"/)
  })

  it('*RST çıkışları kapatır ve tripleri temizler', async () => {
    client.send('OUTP ON,(@1)')
    client.send('SIM:TRIP2 OVP')
    client.send('*RST')
    expect(await client.query('OUTP? (@1)')).toBe('0')
    expect(await client.query('VOLT:PROT:TRIP? (@2)')).toBe('0')
  })
})

// startE36233aSim döndürdüğü nesnenin şekli
export type { AddressInfo }
