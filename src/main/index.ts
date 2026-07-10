import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { DeviceManager } from './deviceManager'
import { registerIpcHandlers } from './ipcHandlers'

let manager: DeviceManager | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b0e14',
    autoHideMenuBar: true,
    title: 'Cihaz Kontrol',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  // DC_DATA_DIR: test/otomasyon için veri dizini override'ı
  manager = new DeviceManager({ dataDir: process.env.DC_DATA_DIR || app.getPath('userData') })
  registerIpcHandlers(manager)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void manager?.dispose()
})
