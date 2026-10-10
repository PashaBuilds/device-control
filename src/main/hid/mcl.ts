import { DEVICE_TYPES, type DeviceKind, type UsbDeviceInfo } from '@shared/types'

/**
 * Mini-Circuits USB (HID) çerçevelemesi.
 *
 * Mini-Circuits cihazları sürücü gerektirmeyen HID cihazlarıdır (VID 0x20CE).
 * Her komut 64 baytlık bir çıkış raporudur: bayt 0 kesme (interrupt) kodu,
 * sonrası veri. Kod 1 "SCPI komutu gönder" demektir: bayt 1'den itibaren ASCII
 * komut, kalanı 0 dolgu. Cihaz aynı kodla başlayan 64 baytlık bir giriş
 * raporuyla yanıtlar; yanıt metni bayt 1'den ilk NUL'a kadardır.
 *
 * Rapor numarası kullanılmadığı için yazılan tampon başına 0x00 rapor kimliği
 * eklenir (hidapi kuralı; Windows'ta zorunlu, Linux/macOS'ta çekirdek atar).
 */
export const MCL_VENDOR_ID = 0x20ce
export const MCL_REPORT_SIZE = 64
export const MCL_SCPI_CODE = 1

/** Bir SCPI komutunu yazılacak HID tamponuna çevirir (rapor kimliği + 64 bayt). */
export function encodeScpiReport(cmd: string): Buffer {
  const body = Buffer.from(cmd, 'ascii')
  if (body.length > MCL_REPORT_SIZE - 1) {
    throw new Error(`Komut çok uzun (${body.length} bayt; en çok ${MCL_REPORT_SIZE - 1})`)
  }
  const buf = Buffer.alloc(MCL_REPORT_SIZE + 1)
  buf[0] = 0x00
  buf[1] = MCL_SCPI_CODE
  body.copy(buf, 2)
  return buf
}

/** Giriş raporundan SCPI yanıt metnini çıkarır; SCPI yanıtı değilse null. */
export function decodeScpiReport(data: Uint8Array): string | null {
  if (data.length === 0 || data[0] !== MCL_SCPI_CODE) return null
  let end = 1
  while (end < data.length && data[end] !== 0) end++
  return Buffer.from(data.subarray(1, end)).toString('ascii').trim()
}

/**
 * Mini-Circuits sorgu yanıtları bazen etiketli gelir ("MN=SSG-6000RC",
 * "SN=11401230001"); etiketi ve çevresindeki boşlukları atar.
 */
export function stripTag(reply: string, tag: string): string {
  const t = reply.trim()
  const m = t.match(new RegExp(`^${tag}\\s*[=:]\\s*(.*)$`, 'i'))
  return (m ? m[1] : t).trim()
}

/** `:MN?` yanıtından cihaz türünü bulur (ör. "SSG-6000RC" → ssg6000rc). */
export function kindForModel(model: string): DeviceKind | null {
  const m = model.trim().toUpperCase()
  // En uzun önek önce: ileride benzer adlı modeller eklenirse yanlış eşleşmesin
  const candidates = DEVICE_TYPES.filter((t) => t.rf).sort(
    (a, b) => b.rf!.modelPrefix.length - a.rf!.modelPrefix.length
  )
  return candidates.find((t) => m.startsWith(t.rf!.modelPrefix.toUpperCase()))?.kind ?? null
}

// ---- HID arka ucu ----

export interface HidDeviceHandle {
  write(data: Buffer): Promise<void>
  /** Bir giriş raporu bekler; süre dolarsa null. */
  read(timeoutMs: number): Promise<Uint8Array | null>
  close(): Promise<void>
}

export interface HidDeviceEntry {
  path: string
  vendorId: number
  productId: number
}

/** İşletim sistemi HID erişimi. Testlerde ve DC_FAKE_HID ile sahte arka uç kullanılır. */
export interface HidBackend {
  enumerate(): Promise<HidDeviceEntry[]>
  open(path: string): Promise<HidDeviceHandle>
}

/** node-hid tabanlı gerçek arka uç. Yerel modül ilk kullanımda yüklenir. */
export function createNodeHidBackend(): HidBackend {
  type NodeHid = Pick<typeof import('node-hid'), 'devicesAsync' | 'HIDAsync'>
  let mod: NodeHid | null = null
  const load = async (): Promise<NodeHid> => {
    if (!mod) {
      try {
        const m: NodeHid & { default?: NodeHid } = await import('node-hid')
        // CJS paketi: derlenmiş ana süreçte ad alanı `default` altında gelebilir
        mod = m.default ?? m
      } catch (err) {
        throw new Error(`USB (HID) kitaplığı yüklenemedi: ${(err as Error).message}`)
      }
    }
    return mod
  }
  return {
    async enumerate() {
      const hid = await load()
      const list = await hid.devicesAsync()
      return list
        .filter((d) => d.vendorId === MCL_VENDOR_ID && typeof d.path === 'string')
        .map((d) => ({ path: d.path!, vendorId: d.vendorId, productId: d.productId }))
    },
    async open(path) {
      const hid = await load()
      const dev = await hid.HIDAsync.open(path)
      return {
        async write(data) {
          await dev.write(data)
        },
        async read(timeoutMs) {
          const data = await dev.read(timeoutMs)
          return data && data.length > 0 ? data : null
        },
        async close() {
          await dev.close()
        }
      }
    }
  }
}

// ---- İstek/yanıt ----

/**
 * Tek bir SCPI komutunu gönderir ve yanıtını bekler. Önce tamponda kalmış eski
 * raporlar boşaltılır ki yanıt bir önceki komutunkiyle karışmasın.
 * Zaman aşımında `MclTimeoutError`, G/Ç hatasında (ör. kablo çekildi) özgün hata fırlar.
 */
export async function mclTransact(handle: HidDeviceHandle, cmd: string, timeoutMs: number): Promise<string> {
  for (let i = 0; i < 8; i++) {
    if (!(await handle.read(0))) break
  }
  await handle.write(encodeScpiReport(cmd))
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new MclTimeoutError(cmd, timeoutMs)
    const data = await handle.read(Math.min(remaining, 250))
    if (!data) continue
    const text = decodeScpiReport(data)
    if (text !== null) return text
  }
}

export class MclTimeoutError extends Error {
  constructor(cmd: string, timeoutMs: number) {
    super(`timeout: "${cmd}" ${timeoutMs}ms içinde yanıtlanmadı`)
    this.name = 'MclTimeoutError'
  }
}

/**
 * Takılı Mini-Circuits cihazlarını açıp `:MN?` / `:SN?` ile tanır.
 * `inUse` içindeki yollar açılmaz (o cihazla süren trafiği bozmamak için);
 * bunlar için verilen bilgi aynen döner.
 */
export async function discoverMclDevices(
  backend: HidBackend,
  inUse: Map<string, UsbDeviceInfo>,
  timeoutMs = 1000
): Promise<UsbDeviceInfo[]> {
  const entries = await backend.enumerate()
  const found: UsbDeviceInfo[] = []
  for (const entry of entries) {
    const known = inUse.get(entry.path)
    if (known) {
      found.push({ ...known, inUse: true })
      continue
    }
    let handle: HidDeviceHandle | null = null
    try {
      handle = await backend.open(entry.path)
      const model = stripTag(await mclTransact(handle, ':MN?', timeoutMs), 'MN')
      const serial = stripTag(await mclTransact(handle, ':SN?', timeoutMs), 'SN')
      found.push({
        path: entry.path,
        productId: entry.productId,
        model,
        serial,
        kind: kindForModel(model),
        inUse: false
      })
    } catch {
      // Açılamayan ya da USB üzerinden SCPI'ye yanıt vermeyen cihaz: tanınmadı olarak
      // listelenir ki sahada "cihaz görünüyor ama konuşmuyor" ayrımı yapılabilsin
      found.push({ path: entry.path, productId: entry.productId, model: '', serial: '', kind: null, inUse: false })
    } finally {
      await handle?.close().catch(() => undefined)
    }
  }
  // Aynı cihaz birden çok HID yoluyla görünebilir: seri numarasına göre tekilleştir
  const seen = new Set<string>()
  return found.filter((d) => {
    const key = d.serial ? `${d.model}#${d.serial}` : d.path
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
