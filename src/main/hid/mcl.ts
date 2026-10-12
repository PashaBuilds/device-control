import { DEVICE_TYPES, type DeviceKind, type UsbDeviceInfo } from '@shared/types'

/**
 * Mini-Circuits USB (HID) çerçevelemesi — Signal Generators Programming Manual (C3),
 * bölüm 5 "USB Control via Direct Programming".
 *
 * Cihazlar sürücü gerektirmeyen HID cihazlarıdır (VID 0x20CE). Her komut 64 baytlık bir
 * çıkış raporudur: bayt 0 kesme (interrupt) kodu, sonrası komuta özgü ikili veri. Cihaz
 * bayt 0'ı aynı kod olan 64 baytlık bir giriş raporuyla yanıtlar.
 *
 * Rapor numarası kullanılmadığı için yazılan tampon başına 0x00 rapor kimliği eklenir
 * (hidapi kuralı; Windows'ta zorunlu, Linux/macOS'ta çekirdek atar).
 */
export const MCL_VENDOR_ID = 0x20ce
export const MCL_REPORT_SIZE = 64

/** Kesme kodları (kılavuz bölüm 5.2). */
export const MCL_CODE = {
  MODEL_NAME: 40,
  SERIAL_NUMBER: 41,
  FIRMWARE: 99,
  SET_FREQUENCY: 101,
  SET_POWER: 102,
  SET_RF: 104,
  OUTPUT_STATUS: 105,
  /** SSG-6000RC / SSG-6001RC */
  SCPI_6000: 121,
  /** SSG-6000 dışındaki modeller (ör. SSG-15G-RC) */
  SCPI_XG: 42
} as const

/** Rapor gövdesini yazılacak HID tamponuna çevirir (rapor kimliği + 64 bayt, 0 dolgu). */
export function encodeReport(body: ArrayLike<number>): Buffer {
  if (body.length === 0 || body.length > MCL_REPORT_SIZE) {
    throw new Error(`Rapor gövdesi 1–${MCL_REPORT_SIZE} bayt olmalı (${body.length})`)
  }
  const buf = Buffer.alloc(MCL_REPORT_SIZE + 1)
  for (let i = 0; i < body.length; i++) buf[i + 1] = body[i] & 0xff
  return buf
}

/** `start` baytından ilk NUL'a kadar olan metin (baytlar latin1 ile birebir korunur). */
export function asciiz(data: Uint8Array, start: number): string {
  let end = start
  while (end < data.length && data[end] !== 0) end++
  return Buffer.from(data.subarray(start, end)).toString('latin1')
}

/** Yazdırılabilir ASCII mi (ikili/bozuk yanıtı ayırt etmek için). */
export function isPrintable(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text)
}

/** Raporun ilk n baytı, hex. */
export function hexBytes(data: Uint8Array, n = 16): string {
  return [...data.subarray(0, n)].map((b) => b.toString(16).padStart(2, '0')).join(' ')
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

/** Model adından cihaz türünü bulur (ör. "SSG-6000RC" → ssg6000rc). */
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
  /** USB tanımlayıcı metinleri (tanılama raporu için) */
  manufacturer?: string
  product?: string
  serialNumber?: string
  usagePage?: number
  usage?: number
  interface?: number
}

/** İşletim sistemi HID erişimi. Testlerde ve DC_FAKE_HID ile sahte arka uç kullanılır. */
export interface HidBackend {
  /** Yalnızca Mini-Circuits (VID 0x20CE) arayüzleri */
  enumerate(): Promise<HidDeviceEntry[]>
  /** Sistemdeki tüm HID arayüzleri (tanılama raporu için) */
  enumerateAll(): Promise<HidDeviceEntry[]>
  /** Kitaplık sürümü vb. (tanılama raporu için) */
  describe(): Promise<string>
  open(path: string): Promise<HidDeviceHandle>
}

/** node-hid tabanlı gerçek arka uç. Yerel modül ilk kullanımda yüklenir. */
export function createNodeHidBackend(): HidBackend {
  type NodeHid = Pick<typeof import('node-hid'), 'devicesAsync' | 'HIDAsync' | 'getHidapiVersion'>
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
  const enumerateAll = async (): Promise<HidDeviceEntry[]> => {
    const hid = await load()
    const list = await hid.devicesAsync()
    return list
      .filter((d) => typeof d.path === 'string')
      .map((d) => ({
        path: d.path!,
        vendorId: d.vendorId,
        productId: d.productId,
        manufacturer: d.manufacturer,
        product: d.product,
        serialNumber: d.serialNumber,
        usagePage: d.usagePage,
        usage: d.usage,
        interface: d.interface
      }))
  }
  return {
    enumerateAll,
    async enumerate() {
      return (await enumerateAll()).filter((d) => d.vendorId === MCL_VENDOR_ID)
    },
    async describe() {
      const hid = await load()
      return `node-hid yüklü, hidapi ${hid.getHidapiVersion?.() ?? '?'}`
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
 * USB sürücü çağrısı (aç/oku/yaz/kapat) süresinde dönmedi. Cihaz güç kaybederken ya da
 * çıkarılırken işletim sistemi tarafında takılan çağrılar kuyruğu sonsuza dek kilitlemesin
 * diye her çağrı süre sınırıyla beklenir; bu hata G/Ç hatası sayılır (bağlantı kapanır,
 * yeniden bağlanma başlar). Cihazın kendisinin yanıt vermemesi ise `MclTimeoutError`'dur.
 */
export class HidStallError extends Error {
  constructor(label: string, ms: number) {
    super(`USB sürücüsü yanıt vermiyor (${label}, ${ms} ms)`)
    this.name = 'HidStallError'
  }
}

/** Sürücü çağrısını süre sınırıyla bekler; aşılırsa `HidStallError`. */
export function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new HidStallError(label, ms)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

/** Sürücü çağrısı payı: okumanın kendi bekleme süresinin üstüne eklenen tampon. */
const DRIVER_SLACK_MS = 1000

/** Aygıtı süre sınırıyla açar. */
export function openWithDeadline(backend: HidBackend, path: string): Promise<HidDeviceHandle> {
  return withDeadline(backend.open(path), 2000, 'aç')
}

/** Aygıtı kapatır; takılırsa ya da hata verirse beklemez (eski tutamaç bırakılır). */
export async function closeQuietly(handle: HidDeviceHandle | null): Promise<void> {
  if (!handle) return
  await withDeadline(handle.close(), DRIVER_SLACK_MS, 'kapat').catch(() => undefined)
}

export class MclTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`timeout: ${label} ${timeoutMs}ms içinde yanıtlanmadı`)
    this.name = 'MclTimeoutError'
  }
}

/**
 * Tek bir komut raporu gönderir ve bayt 0'ı aynı kod olan yanıt raporunu bekler.
 * Önce tamponda kalmış eski raporlar boşaltılır ki yanıt bir öncekiyle karışmasın.
 * Zaman aşımında `MclTimeoutError`, G/Ç hatasında (ör. kablo çekildi) özgün hata fırlar.
 */
export async function mclRequest(
  handle: HidDeviceHandle,
  body: ArrayLike<number>,
  timeoutMs: number
): Promise<Uint8Array> {
  const read = (ms: number): Promise<Uint8Array | null> =>
    withDeadline(handle.read(ms), ms + DRIVER_SLACK_MS, 'oku')
  for (let i = 0; i < 8; i++) {
    if (!(await read(0))) break
  }
  const code = body[0]
  await withDeadline(handle.write(encodeReport(body)), DRIVER_SLACK_MS, 'yaz')
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new MclTimeoutError(`kod ${code}`, timeoutMs)
    const data = await read(Math.min(remaining, 250))
    if (data && data[0] === code) return data
  }
}

/** Kod 40/41 ile model adı ve seri numarası (kılavuz 5.2.1–5.2.2). */
export async function identifyMcl(
  handle: HidDeviceHandle,
  timeoutMs: number
): Promise<{ model: string; serial: string }> {
  const modelReply = await mclRequest(handle, [MCL_CODE.MODEL_NAME], timeoutMs)
  const model = stripTag(asciiz(modelReply, 1), 'MN')
  if (!model || !isPrintable(model)) {
    throw new Error(`model adı okunamadı [${hexBytes(modelReply)}]`)
  }
  const serialReply = await mclRequest(handle, [MCL_CODE.SERIAL_NUMBER], timeoutMs)
  const serial = stripTag(asciiz(serialReply, 1), 'SN')
  return { model, serial: isPrintable(serial) ? serial : '' }
}

/**
 * Takılı Mini-Circuits cihazlarını açıp model adı ve seri numarasıyla tanır.
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
    let step = 'açılamadı'
    try {
      handle = await openWithDeadline(backend, entry.path)
      step = 'tanınamadı'
      const { model, serial } = await identifyMcl(handle, timeoutMs)
      found.push({
        path: entry.path,
        productId: entry.productId,
        model,
        serial,
        kind: kindForModel(model),
        inUse: false
      })
    } catch (err) {
      // Açılamayan ya da yanıt vermeyen cihaz: tanınmadı olarak listelenir ki sahada
      // "cihaz görünüyor ama konuşmuyor" ayrımı yapılabilsin
      found.push({
        path: entry.path,
        productId: entry.productId,
        model: '',
        serial: '',
        kind: null,
        inUse: false,
        error: `${step}: ${(err as Error).message}`
      })
    } finally {
      await closeQuietly(handle)
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
