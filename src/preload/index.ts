import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNEL, IPC_INVOKE_METHODS, type IpcInvokeMethod } from '@shared/ipc'
import type { DeviceSnapshot, ScpiLogEntry } from '@shared/types'

type AnyFn = (...args: unknown[]) => Promise<unknown>

const api: Record<string, unknown> = {}

for (const method of IPC_INVOKE_METHODS) {
  api[method] = ((...args: unknown[]) =>
    ipcRenderer.invoke(IPC_CHANNEL.invoke(method as IpcInvokeMethod), ...args)) as AnyFn
}

api.listSnapshots = () => ipcRenderer.invoke('dc:listSnapshots')

api.onSnapshot = (cb: (s: DeviceSnapshot) => void) => {
  const listener = (_e: unknown, s: DeviceSnapshot): void => cb(s)
  ipcRenderer.on(IPC_CHANNEL.snapshot, listener)
  return () => ipcRenderer.off(IPC_CHANNEL.snapshot, listener)
}

api.onLog = (cb: (e: ScpiLogEntry) => void) => {
  const listener = (_e: unknown, entry: ScpiLogEntry): void => cb(entry)
  ipcRenderer.on(IPC_CHANNEL.log, listener)
  return () => ipcRenderer.off(IPC_CHANNEL.log, listener)
}

contextBridge.exposeInMainWorld('deviceApi', api)
