import { contextBridge } from 'electron'

// DeviceApi köprüsü Task 6'da eklenecek; iskelet aşamasında boş nesne.
contextBridge.exposeInMainWorld('deviceApi', {})
