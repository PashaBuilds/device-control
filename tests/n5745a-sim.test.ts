import { describe, expect, it } from 'vitest'
import { N5745aSim } from '../tools/simulator/n5745a-model'

const num = (s: string | null): number => Number(s)

describe('N5745aSim', () => {
  it('kimlik ve fabrika durumu', () => {
    const sim = new N5745aSim()
    expect(sim.handle('*IDN?')).toMatch(/^Agilent Technologies,N5745A,/)
    expect(num(sim.handle('VOLT?'))).toBe(0)
    expect(num(sim.handle('VOLT:PROT?'))).toBe(36)
    expect(sim.handle('OUTP?')).toBe('0')
    expect(sim.handle('SYST:ERR?')).toBe('+0,"No error"')
  })

  it('omik yükte CV ölçümü; kısa ve uzun biçimler', () => {
    const sim = new N5745aSim()
    sim.handle('VOLTAGE 12')
    sim.handle('SOUR:CURR 5')
    sim.handle('OUTPUT ON')
    expect(num(sim.handle('MEAS:VOLT?'))).toBeCloseTo(12)
    expect(num(sim.handle('MEASURE:CURRENT:DC?'))).toBeCloseTo(1.2) // 10 Ω
    expect(sim.handle('STAT:QUES:COND?')).toBe('0')
  })

  it('akım limitinde CC; OCP açıksa çıkışı keser ve OC bitini kurar', () => {
    const sim = new N5745aSim()
    sim.handle('VOLT 12')
    sim.handle('CURR 0.5')
    sim.handle('OUTP ON')
    expect(num(sim.handle('MEAS:CURR?'))).toBeCloseTo(0.5)
    expect(num(sim.handle('MEAS:VOLT?'))).toBeCloseTo(5)
    sim.handle('CURR:PROT:STAT ON')
    expect(sim.handle('CURR:PROT:STAT?')).toBe('1')
    expect(sim.handle('STAT:QUES:COND?')).toBe('2')
    expect(sim.handle('OUTP?')).toBe('0')
    sim.handle('CURR 5')
    sim.handle('OUTP:PROT:CLE')
    expect(sim.handle('STAT:QUES:COND?')).toBe('0')
    expect(sim.handle('OUTP?')).toBe('1') // temizleme önceki çıkış durumunu geri getirir
  })

  it('SIM:TRIP OVP → OV biti; trip sürerken OUTP ON reddedilir', () => {
    const sim = new N5745aSim()
    sim.handle('SIM:TRIP OVP')
    expect(sim.handle('STAT:QUES:COND?')).toBe('1')
    sim.handle('OUTP ON')
    expect(sim.handle('OUTP?')).toBe('0')
    expect(sim.handle('SYST:ERR?')).toMatch(/^-221,/)
  })

  it('aralık ve OVP bağlaşımı: VOLT ≤ OVP/1.05, OVP ≥ VOLT×1.05, OVP 2–36', () => {
    const sim = new N5745aSim()
    sim.handle('VOLT 32')
    expect(sim.handle('SYST:ERR?')).toMatch(/^-222,/)
    sim.handle('VOLT:PROT 10')
    sim.handle('VOLT 10') // 10 > 10/1.05
    expect(sim.handle('SYST:ERR?')).toMatch(/^-222,/)
    sim.handle('VOLT 9')
    expect(num(sim.handle('VOLT?'))).toBe(9)
    sim.handle('VOLT:PROT 9') // 9 < 9×1.05
    expect(sim.handle('SYST:ERR?')).toMatch(/^-222,/)
    sim.handle('VOLT:PROT 40')
    expect(sim.handle('SYST:ERR?')).toMatch(/^-222,/)
    sim.handle('CURR 26')
    expect(sim.handle('SYST:ERR?')).toMatch(/^-222,/)
  })

  it('tanınmayan komut -113; kanal listeli E36200 sözdizimi tanınmaz', () => {
    const sim = new N5745aSim()
    sim.handle('VOLT 5,(@1)')
    expect(sim.handle('SYST:ERR?')).toMatch(/^-113,/)
  })
})
