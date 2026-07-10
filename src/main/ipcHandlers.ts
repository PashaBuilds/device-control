import { ipcMain, BrowserWindow } from 'electron'
import { IPC_CHANNEL, IPC_INVOKE_METHODS } from '@shared/ipc'
import type { DeviceSnapshot, ScpiLogEntry } from '@shared/types'
import { DeviceManager } from './deviceManager'

/** DeviceManager'ı IPC'ye bağlar: invoke kanalları + olay yayını. */
export function registerIpcHandlers(manager: DeviceManager): void {
  for (const method of IPC_INVOKE_METHODS) {
    ipcMain.handle(IPC_CHANNEL.invoke(method), (_event, ...args: unknown[]) => {
      const fn = manager[method] as (...a: unknown[]) => Promise<unknown>
      return fn.apply(manager, args)
    })
  }

  // UI ilk açılışta mevcut cihazların durumunu ister
  ipcMain.handle('dc:listSnapshots', () => manager.listSnapshots())

  const broadcast = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, payload)
    }
  }

  manager.on('snapshot', (s: DeviceSnapshot) => broadcast(IPC_CHANNEL.snapshot, s))
  manager.on('log', (e: ScpiLogEntry) => broadcast(IPC_CHANNEL.log, e))
}
