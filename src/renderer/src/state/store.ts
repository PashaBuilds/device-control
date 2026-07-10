import { create } from 'zustand'
import type { DeviceConfig, DeviceSnapshot, ScpiLogEntry } from '@shared/types'
import { pushHistory } from './history'

const LOG_LIMIT = 500

interface AppState {
  ready: boolean
  devices: DeviceConfig[]
  snapshots: Record<string, DeviceSnapshot>
  logs: Record<string, ScpiLogEntry[]>
  selectedId: string | null

  init(): Promise<void>
  refreshDevices(): Promise<void>
  select(id: string | null): void
  addDevice(cfg: Omit<DeviceConfig, 'id'>): Promise<void>
  removeDevice(id: string): Promise<void>
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  devices: [],
  snapshots: {},
  logs: {},
  selectedId: null,

  async init() {
    if (get().ready) return
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
        const list = st.logs[e.deviceId] ?? []
        const next = list.length >= LOG_LIMIT ? [...list.slice(-LOG_LIMIT + 1), e] : [...list, e]
        return { logs: { ...st.logs, [e.deviceId]: next } }
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
