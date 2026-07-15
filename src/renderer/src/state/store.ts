import { create } from 'zustand'
import type { DeviceConfig, DeviceSnapshot, ScpiLogEntry } from '@shared/types'
import { pushHistory } from './history'
import { applyTheme, initialTheme, type Theme } from './theme'

// Kullanıcı komutları uzun süre geriye dönük kalsın; yoklama gürültüsü
// kendi tamponunda dönsün ki kullanıcı satırlarını buffer'dan itmesin.
const USER_LOG_LIMIT = 300
const POLL_LOG_LIMIT = 600

export interface DeviceLogs {
  user: ScpiLogEntry[]
  poll: ScpiLogEntry[]
}

interface AppState {
  ready: boolean
  devices: DeviceConfig[]
  snapshots: Record<string, DeviceSnapshot>
  logs: Record<string, DeviceLogs>
  selectedId: string | null
  theme: Theme

  init(): Promise<void>
  refreshDevices(): Promise<void>
  select(id: string | null): void
  addDevice(cfg: Omit<DeviceConfig, 'id'>): Promise<void>
  removeDevice(id: string): Promise<void>
  toggleTheme(): void
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  devices: [],
  snapshots: {},
  logs: {},
  selectedId: null,
  theme: initialTheme(),

  toggleTheme() {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    set({ theme: next })
  },

  async init() {
    if (get().ready) return
    applyTheme(get().theme)
    const [devices, snapshots] = await Promise.all([
      window.deviceApi.listDevices(),
      window.deviceApi.listSnapshots()
    ])
    const snapMap: Record<string, DeviceSnapshot> = {}
    for (const s of snapshots) snapMap[s.id] = s

    window.deviceApi.onSnapshot((s) => {
      pushHistory(s)
      set((st) => ({ snapshots: { ...st.snapshots, [s.id]: s } }))
    })
    window.deviceApi.onLog((e) => {
      set((st) => {
        const cur = st.logs[e.deviceId] ?? { user: [], poll: [] }
        const key = e.source === 'poll' ? 'poll' : 'user'
        const limit = key === 'poll' ? POLL_LOG_LIMIT : USER_LOG_LIMIT
        const list = cur[key]
        const next = list.length >= limit ? [...list.slice(-limit + 1), e] : [...list, e]
        return { logs: { ...st.logs, [e.deviceId]: { ...cur, [key]: next } } }
      })
    })

    set({
      ready: true,
      devices,
      snapshots: snapMap,
      selectedId: devices[0]?.id ?? null
    })
  },

  async refreshDevices() {
    const devices = await window.deviceApi.listDevices()
    set((st) => ({
      devices,
      selectedId:
        st.selectedId && devices.some((d) => d.id === st.selectedId)
          ? st.selectedId
          : (devices[0]?.id ?? null)
    }))
  },

  select(id) {
    set({ selectedId: id })
  },

  async addDevice(cfg) {
    const created = await window.deviceApi.addDevice(cfg)
    await get().refreshDevices()
    set({ selectedId: created.id })
  },

  async removeDevice(id) {
    await window.deviceApi.removeDevice(id)
    await get().refreshDevices()
  }
}))
