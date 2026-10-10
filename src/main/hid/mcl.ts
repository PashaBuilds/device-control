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
  // latin1: baytlar birebir korunur (ikili yanıtı ayırt edip hex gösterebilmek için)
  return Buffer.from(data.subarray(1, end)).toString('latin1').trim()
}

/** SCPI yanıtı yazdırılabilir ASCII metindir; değilse cihaz ikili (eski) protokol konuşuyor. */
export function isTextReply(reply: string): boolean {
  return /^[\x20-\x7e]*$/.test(reply)
}

/** Metin olarak çözülmüş yanıtın baytları (hex, ilk n bayt). */
export function replyHex(reply: string, n = 16): string {
  return [...Buffer.from(reply, 'latin1').subarray(0, n)].map((b) => b.toString(16).padStart(2, '0')).join(' ')
}

/** SCPI sorgusu; yanıt metin değilse (ikili protokollü cihaz) anlaşılır hata fırlatır. */
async function scpiQueryText(handle: HidDeviceHandle, cmd: string, timeoutMs: number): Promise<string> {
  const reply = await mclTransact(handle, cmd, timeoutMs)
  if (!isTextReply(reply)) {
    throw new Error(`SCPI yerine ikili yanıt (eski USB protokolü) [${replyHex(reply)}]`)
  }
  return reply
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
      const hid = (await load()) as NodeHid & { getHidapiVersion?: () => string }
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
    let step = 'açılamadı'
    try {
      handle = await backend.open(entry.path)
      step = ':MN? yanıtsız'
      const model = stripTag(await scpiQueryText(handle, ':MN?', timeoutMs), 'MN')
      step = ':SN? yanıtsız'
      const serial = stripTag(await scpiQueryText(handle, ':SN?', timeoutMs), 'SN')
      found.push({
        path: entry.path,
        productId: entry.productId,
        model,
        serial,
        kind: kindForModel(model),
        inUse: false
      })
    } catch (err) {
      // Açılamayan ya da USB üzerinden SCPI'ye yanıt vermeyen cihaz: tanınmadı olarak
      // listelenir ki sahada "cihaz görünüyor ama konuşmuyor" ayrımı yapılabilsin
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

// ---- Tanılama ----

const hex4 = (n: number | undefined): string =>
  n === undefined ? '?' : `0x${n.toString(16).padStart(4, '0').toUpperCase()}`

function hexBytes(data: Uint8Array, n = 24): string {
  return [...data.subarray(0, n)].map((b) => b.toString(16).padStart(2, '0')).join(' ')
}

function printable(data: Uint8Array): string {
  return Buffer.from(data.subarray(1))
    .toString('latin1')
    .replace(/\0[\s\S]*$/, '')
    .replace(/[^\x20-\x7e]/g, '.')
}

/** Ham bir rapor yazar, gelen ilk raporu (koduna bakmadan) döndürür; süre dolarsa null. */
async function rawExchange(handle: HidDeviceHandle, body: number[], timeoutMs: number): Promise<Uint8Array | null> {
  for (let i = 0; i < 8; i++) {
    if (!(await handle.read(0))) break
  }
  const buf = Buffer.alloc(MCL_REPORT_SIZE + 1)
  Buffer.from(body).copy(buf, 1)
  await handle.write(buf)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return null
    const data = await handle.read(Math.min(remaining, 250))
    if (data) return data
  }
}

/**
 * Sahada "cihaz bulunamadı" durumunu ayırt etmek için metin rapor: HID kitaplığı,
 * Mini-Circuits'e benzeyen tüm HID arayüzleri, her birinin açılıp açılmadığı ve
 * `:MN?` / `:SN?` ile salt-okur model/seri kodlarına (40/41) verdiği ham yanıtlar.
 */
export async function diagnoseMcl(
  backend: HidBackend,
  inUse: Map<string, UsbDeviceInfo>,
  timeoutMs = 1000
): Promise<string> {
  const out: string[] = []
  try {
    out.push(`HID kitaplığı: ${await backend.describe()}`)
  } catch (err) {
    out.push(`HID kitaplığı YÜKLENEMEDİ: ${(err as Error).message}`)
    return out.join('\n')
  }
  let all: HidDeviceEntry[]
  try {
    all = await backend.enumerateAll()
  } catch (err) {
    out.push(`HID cihazları listelenemedi: ${(err as Error).message}`)
    return out.join('\n')
  }
  const looksMcl = (d: HidDeviceEntry): boolean =>
    d.vendorId === MCL_VENDOR_ID || /mini.?circuits|\bssg\b|ssg-/i.test(`${d.manufacturer ?? ''} ${d.product ?? ''}`)
  const mcl = all.filter(looksMcl)
  out.push(`Toplam HID arayüzü: ${all.length}; Mini-Circuits (VID 0x20CE ya da adı uyan): ${mcl.length}`)
  if (mcl.length === 0) {
    const vendors = [...new Set(all.map((d) => `${hex4(d.vendorId)} ${d.manufacturer ?? ''}`.trim()))]
    out.push(`Görülen üreticiler: ${vendors.join(' | ') || '—'}`)
    out.push('→ Cihaz USB HID olarak görünmüyor: kablo/güç, Aygıt Yöneticisi > İnsan Arabirim Aygıtları.')
  }
  for (const [i, d] of mcl.entries()) {
    out.push('')
    out.push(
      `#${i + 1} VID ${hex4(d.vendorId)} PID ${hex4(d.productId)} · "${d.manufacturer ?? ''}" "${d.product ?? ''}" · ` +
        `USB SN "${d.serialNumber ?? ''}" · usagePage ${hex4(d.usagePage)} usage ${hex4(d.usage)} · arayüz ${d.interface ?? '?'}`
    )
    out.push(`   yol: ${d.path}`)
    const known = inUse.get(d.path)
    if (known) {
      out.push(`   bu uygulamada bağlı (${known.model} SN ${known.serial}) — test edilmedi`)
      continue
    }
    let handle: HidDeviceHandle | null = null
    try {
      handle = await backend.open(d.path)
      out.push('   açıldı ✓')
    } catch (err) {
      out.push(`   AÇILAMADI: ${(err as Error).message}`)
      continue
    }
    try {
      for (const cmd of [':MN?', ':SN?']) {
        try {
          const reply = await mclTransact(handle, cmd, timeoutMs)
          out.push(
            isTextReply(reply)
              ? `   ${cmd} → "${reply}"`
              : `   ${cmd} → İKİLİ yanıt (SCPI değil): [${replyHex(reply, 63)}]`
          )
        } catch (err) {
          out.push(`   ${cmd} → ${(err as Error).message}`)
        }
      }
      for (const code of [40, 41]) {
        try {
          const r = await rawExchange(handle, [code], timeoutMs)
          out.push(
            r ? `   kod ${code} → [${hexBytes(r)}] "${printable(r)}"` : `   kod ${code} → yanıt yok (${timeoutMs} ms)`
          )
        } catch (err) {
          out.push(`   kod ${code} → HATA: ${(err as Error).message}`)
        }
      }
    } finally {
      await handle.close().catch(() => undefined)
    }
  }
  return out.join('\n')
}
