import type { DeviceSnapshot } from '@shared/types'

/** ~30 dk @ 500ms yoklama */
export const HISTORY_CAPACITY = 3600

export interface ChannelHistory {
  voltage: number[]
  current: number[]
}

export interface DeviceHistory {
  timestamps: number[]
  channels: ChannelHistory[]
}

const histories = new Map<string, DeviceHistory>()

function ensure(id: string, channelCount: number): DeviceHistory {
  let h = histories.get(id)
  if (!h) {
    h = {
      timestamps: [],
      channels: Array.from({ length: channelCount }, () => ({ voltage: [], current: [] }))
    }
    histories.set(id, h)
  }
  return h
}

/** Bağlı cihaz snapshot'ından bir örnek ekler; kapasite aşımında en eskiyi düşürür. */
export function pushHistory(s: DeviceSnapshot): void {
  if (s.state !== 'connected') return
  const h = ensure(s.id, s.channels.length)
  h.timestamps.push(s.timestamp)
  s.channels.forEach((c, i) => {
    h.channels[i].voltage.push(c.voltage)
    h.channels[i].current.push(c.current)
  })
  if (h.timestamps.length > HISTORY_CAPACITY) {
    const drop = h.timestamps.length - HISTORY_CAPACITY
    h.timestamps.splice(0, drop)
    for (const c of h.channels) {
      c.voltage.splice(0, drop)
      c.current.splice(0, drop)
    }
  }
}

export function getHistory(id: string): DeviceHistory {
  return histories.get(id) ?? { timestamps: [], channels: [] }
}

export function clearHistory(id: string): void {
  histories.delete(id)
}

/** `zaman;k1_gerilim_v;k1_akim_a;...` başlıklı CSV üretir. */
export function toCsv(id: string): string {
  const h = getHistory(id)
  const chCount = h.channels.length
  const header = [
    'zaman',
    ...Array.from({ length: chCount }, (_, i) => [`k${i + 1}_gerilim_v`, `k${i + 1}_akim_a`]).flat()
  ].join(';')
  const rows = h.timestamps.map((ts, row) => {
    const cells = [new Date(ts).toISOString()]
    for (const c of h.channels) {
      cells.push(String(c.voltage[row]), String(c.current[row]))
    }
    return cells.join(';')
  })
  return [header, ...rows].join('\n') + '\n'
}
