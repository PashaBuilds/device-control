import { beforeEach, describe, expect, it } from 'vitest'
import { pushHistory, getHistory, clearHistory, toCsv, HISTORY_CAPACITY } from '../src/renderer/src/state/history'
import type { DeviceSnapshot } from '../src/shared/types'

function snap(id: string, ts: number, v1: number, i1: number): DeviceSnapshot {
  return {
    id,
    state: 'connected',
    identity: null,
    error: null,
    channels: [
      { voltage: v1, current: i1, power: v1 * i1, outputOn: true, mode: 'cv' },
      { voltage: 0, current: 0, power: 0, outputOn: false, mode: 'off' }
    ],
    setpoints: [
      { voltage: v1, current: i1, ovp: 66, ocp: 22 },
      { voltage: 0, current: 0, ovp: 66, ocp: 22 }
    ],
    tracking: false,
    trips: [],
    timestamp: ts
  }
}

describe('history halka tamponu', () => {
  beforeEach(() => clearHistory('d1'))

  it('örnekleri sırayla biriktirir', () => {
    pushHistory(snap('d1', 1000, 5, 1))
    pushHistory(snap('d1', 1500, 6, 2))
    const h = getHistory('d1')
    expect(h.timestamps).toEqual([1000, 1500])
    expect(h.channels[0].voltage).toEqual([5, 6])
    expect(h.channels[0].current).toEqual([1, 2])
  })

  it('kapasiteyi aşınca en eskiyi düşürür', () => {
    for (let i = 0; i < HISTORY_CAPACITY + 10; i++) {
      pushHistory(snap('d1', i, i, 0))
    }
    const h = getHistory('d1')
    expect(h.timestamps.length).toBe(HISTORY_CAPACITY)
    expect(h.timestamps[0]).toBe(10)
  })

  it('bağlantı yokken (state !== connected) örnek almaz', () => {
    const s = snap('d1', 1000, 5, 1)
    pushHistory({ ...s, state: 'disconnected' })
    expect(getHistory('d1').timestamps.length).toBe(0)
  })

  it('toCsv başlık ve satırları noktalı virgülle üretir', () => {
    pushHistory(snap('d1', 1710000000000, 5, 1.25))
    const csv = toCsv('d1')
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('zaman;k1_gerilim_v;k1_akim_a;k2_gerilim_v;k2_akim_a')
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2}T.*;5;1.25;0;0$/)
  })
})
