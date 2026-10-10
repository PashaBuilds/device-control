import { app, BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { DeviceManager } from './deviceManager'
import { registerIpcHandlers } from './ipcHandlers'

// Paket yalnız tr.pak içerir: sistem dili ne olursa olsun Chromium Türkçe yerel ayarı kullansın
app.commandLine.appendSwitch('lang', 'tr')

let manager: DeviceManager | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0a0d12',
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

app.whenReady().then(async () => {
  // DC_FAKE_HID=1: USB cihazları yerine simülatör (donanımsız arayüz denemesi / e2e)
  const hidBackend = process.env.DC_FAKE_HID
    ? (await import('../../tools/simulator/ssg-hid')).createDemoFakeHidBackend()
    : undefined
  // DC_DATA_DIR: test/otomasyon için veri dizini override'ı
  manager = new DeviceManager({ dataDir: process.env.DC_DATA_DIR || app.getPath('userData'), hidBackend })
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
