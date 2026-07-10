import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DeviceConfig } from '@shared/types'

/** Cihaz listesini `<dataDir>/devices.json` dosyasında saklar. */
export class Store {
  private readonly file: string

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true })
    this.file = join(dataDir, 'devices.json')
  }

  load(): DeviceConfig[] {
    if (!existsSync(this.file)) return []
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'))
      return Array.isArray(parsed) ? parsed : []
    } catch {
      // bozuk dosya: boş listeyle devam et, ilk kayıtta üzerine yazılır
      return []
    }
  }

  save(devices: DeviceConfig[]): void {
    writeFileSync(this.file, JSON.stringify(devices, null, 2), 'utf8')
  }
}
