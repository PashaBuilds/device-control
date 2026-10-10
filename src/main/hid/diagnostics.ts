import { DEVICE_TYPES, type UsbDeviceInfo } from '@shared/types'
import {
  MCL_CODE,
  MCL_VENDOR_ID,
  asciiz,
  hexBytes,
  isPrintable,
  kindForModel,
  mclRequest,
  type HidBackend,
  type HidDeviceEntry,
  type HidDeviceHandle
} from './mcl'
import { decodeFirmware, decodeOutputStatus, decodeScpiReply, describeStatus, encodeScpi } from './ssgProtocol'

const hex4 = (n: number | undefined): string =>
  n === undefined ? '?' : `0x${n.toString(16).padStart(4, '0').toUpperCase()}`

/**
 * Sahada "cihaz bulunamadı" durumunu ayırt etmek için metin rapor: HID kitaplığı,
 * Mini-Circuits'e benzeyen tüm HID arayüzleri, her birinin açılıp açılmadığı ve
 * yalnızca okuyan komutlara (40 model, 41 seri, 99 ürün yazılımı, 105 durum, SCPI :MN?)
 * verdiği yanıtlar (çözülmüş + ham hex). Cihazın ayarlarını değiştiren komut gönderilmez.
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
      const ask = async (code: number, label: string, decode: (r: Uint8Array) => string): Promise<Uint8Array | null> => {
        try {
          const r = await mclRequest(handle!, [code], timeoutMs)
          out.push(`   [${code}] ${label} → ${decode(r)}  [${hexBytes(r)}]`)
          return r
        } catch (err) {
          out.push(`   [${code}] ${label} → ${(err as Error).message}`)
          return null
        }
      }
      const text = (r: Uint8Array): string => {
        const t = asciiz(r, 1)
        return isPrintable(t) ? `"${t}"` : 'İKİLİ/okunamadı'
      }
      const modelReply = await ask(MCL_CODE.MODEL_NAME, 'model adı', text)
      await ask(MCL_CODE.SERIAL_NUMBER, 'seri no', text)
      await ask(MCL_CODE.FIRMWARE, 'ürün yazılımı', (r) => `"${decodeFirmware(r)}"`)
      await ask(MCL_CODE.OUTPUT_STATUS, 'durum', (r) => describeStatus(decodeOutputStatus(r)))
      // SCPI kodu modele göre değişir; model tanınmadıysa (yanlış kod başka bir komut olabilir) denenmez
      const kind = modelReply ? kindForModel(asciiz(modelReply, 1)) : null
      const series = kind ? DEVICE_TYPES.find((t) => t.kind === kind)?.rf?.usbSeries : undefined
      if (series) {
        const body = encodeScpi(series, ':MN?')
        try {
          const r = await mclRequest(handle, body, timeoutMs)
          out.push(`   SCPI :MN? [kod ${body[0]}] → "${decodeScpiReply(series, r)}"  [${hexBytes(r)}]`)
        } catch (err) {
          out.push(`   SCPI :MN? [kod ${body[0]}] → ${(err as Error).message}`)
        }
      } else {
        out.push('   SCPI denenmedi (model tanınmadı)')
      }
    } finally {
      await handle.close().catch(() => undefined)
    }
  }
  return out.join('\n')
}
