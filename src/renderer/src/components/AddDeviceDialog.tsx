import { createPortal } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEVICE_TYPES,
  normalizeHost,
  type DeviceCategory,
  type DeviceKind,
  type UsbDeviceInfo
} from '@shared/types'
import { tr } from '../i18n/tr'
import { useAppStore } from '../state/store'

const HOST_RE = /^(?:(?:\d{1,3}\.){3}\d{1,3}|[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*)$/

const CATEGORY_ORDER: DeviceCategory[] = ['power-supply', 'signal-generator', 'debug-probe']

function validIpv4(host: string): boolean {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return true // IP değilse sunucu adı kuralına bakılır
  return host.split('.').every((p) => Number(p) <= 255)
}

function hexPid(pid: number): string {
  return `0x${pid.toString(16).padStart(4, '0').toUpperCase()}`
}

export function AddDeviceDialog({
  onClose,
  initialCategory
}: {
  onClose: () => void
  /** Verilirse bu kategorinin ilk türü seçili gelir */
  initialCategory?: DeviceCategory
}): React.JSX.Element {
  const addDevice = useAppStore((s) => s.addDevice)
  const [kind, setKind] = useState<DeviceKind>(
    () => (DEVICE_TYPES.find((t) => t.category === initialCategory) ?? DEVICE_TYPES[0]).kind
  )
  const typeInfo = DEVICE_TYPES.find((t) => t.kind === kind)!
  const isUsb = typeInfo.transport === 'usb'
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(String(typeInfo.defaultPort))
  const [usbSerial, setUsbSerial] = useState('')
  const [usbList, setUsbList] = useState<UsbDeviceInfo[] | null>(null)
  const [usbError, setUsbError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [diag, setDiag] = useState<string | null>(null)
  const [diagBusy, setDiagBusy] = useState(false)
  const [diagCopied, setDiagCopied] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; host?: string; port?: string }>({})
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => nameRef.current?.focus(), [])

  // Tür değişince o türün varsayılan portunu getir
  useEffect(() => {
    setPort(String(typeInfo.defaultPort))
  }, [typeInfo.defaultPort])

  const scan = useCallback(async () => {
    setScanning(true)
    setUsbError(null)
    try {
      setUsbList(await window.deviceApi.listUsbDevices())
    } catch (err) {
      setUsbList([])
      setUsbError(tr.addDialog.usbScanError(err instanceof Error ? err.message : String(err)))
    } finally {
      setScanning(false)
    }
  }, [])

  const runDiagnostics = useCallback(async () => {
    setDiagBusy(true)
    setDiagCopied(false)
    try {
      setDiag(await window.deviceApi.usbDiagnostics())
    } catch (err) {
      setDiag(tr.addDialog.usbScanError(err instanceof Error ? err.message : String(err)))
    } finally {
      setDiagBusy(false)
    }
  }, [])

  const copyDiagnostics = async (): Promise<void> => {
    if (!diag) return
    await navigator.clipboard.writeText(diag)
    setDiagCopied(true)
  }

  // USB türü seçilince takılı cihazları tara (bir kez; "Yeniden tara" ile tekrar)
  useEffect(() => {
    if (isUsb && usbList === null && !scanning) void scan()
  }, [isUsb, usbList, scanning, scan])

  // Tür değişince önceki türün seri seçimi geçersiz
  useEffect(() => setUsbSerial(''), [kind])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const errs: typeof errors = {}
    const trimmedName = name.trim()
    const trimmedHost = normalizeHost(host)
    const portNum = Number(port)
    if (!trimmedName) errs.name = tr.addDialog.errors.nameRequired
    if (!isUsb) {
      if (!trimmedHost || !HOST_RE.test(trimmedHost) || !validIpv4(trimmedHost))
        errs.host = tr.addDialog.errors.hostInvalid
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)
        errs.port = tr.addDialog.errors.portInvalid
    }
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    setBusy(true)
    try {
      await addDevice(
        isUsb
          ? { name: trimmedName, kind, host: '', port: 0, ...(usbSerial ? { usbSerial } : {}) }
          : { name: trimmedName, kind, host: trimmedHost, port: portNum }
      )
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const sameKind = (usbList ?? []).filter((d) => d.kind === kind)
  const otherModels = (usbList ?? []).filter((d) => d.model && d.kind !== kind)
  const unrecognized = (usbList ?? []).filter((d) => !d.model)

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={(e) => void submit(e)}>
        <div className="dialog-head">
          <h3>{tr.addDialog.title}</h3>
        </div>
        <div className="dialog-body">
          <div className="field">
            <label htmlFor="dev-type">{tr.addDialog.type}</label>
            <select id="dev-type" value={kind} onChange={(e) => setKind(e.target.value as DeviceKind)}>
              {CATEGORY_ORDER.map((cat) => (
                <optgroup key={cat} label={tr.categories[cat]}>
                  {DEVICE_TYPES.filter((t) => t.category === cat).map((t) => (
                    <option key={t.kind} value={t.kind}>
                      {t.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="dev-name">{tr.addDialog.name}</label>
            <input
              id="dev-name"
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                typeInfo.category === 'signal-generator'
                  ? tr.addDialog.namePlaceholderSigGen
                  : tr.addDialog.namePlaceholder
              }
            />
            {errors.name && <span className="error-text">{errors.name}</span>}
          </div>
          {isUsb ? (
            <div className="field">
              <label htmlFor="dev-usb">{tr.addDialog.usbDevice}</label>
              <div className="usb-pick">
                <select
                  id="dev-usb"
                  className="mono"
                  value={usbSerial}
                  onChange={(e) => setUsbSerial(e.target.value)}
                >
                  <option value="">{tr.addDialog.usbFirst(typeInfo.label)}</option>
                  {sameKind
                    .filter((d) => d.serial)
                    .map((d) => (
                      <option key={d.path} value={d.serial}>
                        {tr.addDialog.usbOption(d.model, d.serial, d.inUse)}
                      </option>
                    ))}
                </select>
                <button type="button" className="btn ghost" onClick={() => void scan()} disabled={scanning}>
                  {tr.addDialog.usbScan}
                </button>
              </div>
              <div className="usb-status">
                {scanning ? (
                  <span>{tr.addDialog.usbScanning}</span>
                ) : usbError ? (
                  <span className="error-text">{usbError}</span>
                ) : usbList !== null ? (
                  <>
                    {sameKind.length > 0 ? (
                      <span className="ok-text">{tr.addDialog.usbFoundCount(sameKind.length)}</span>
                    ) : (
                      <span>{tr.addDialog.usbNoneOfKind(typeInfo.label)}</span>
                    )}
                    {otherModels.map((d) => (
                      <span key={d.path}>{tr.addDialog.usbOtherModel(d.model)}</span>
                    ))}
                    {unrecognized.map((d) => (
                      <span key={d.path} className="warn-text">
                        {tr.addDialog.usbUnrecognized(hexPid(d.productId))}
                        {d.error ? ` (${d.error})` : ''}
                      </span>
                    ))}
                  </>
                ) : null}
              </div>
              <div className="usb-diag-row">
                <button
                  type="button"
                  className="btn ghost tiny"
                  onClick={() => void runDiagnostics()}
                  disabled={diagBusy}
                >
                  {diagBusy ? tr.addDialog.usbDiagRunning : tr.addDialog.usbDiag}
                </button>
                {diag && (
                  <button type="button" className="btn ghost tiny" onClick={() => void copyDiagnostics()}>
                    {diagCopied ? tr.addDialog.usbDiagCopied : tr.addDialog.usbDiagCopy}
                  </button>
                )}
              </div>
              {diag && (
                <>
                  <pre className="usb-diag">{diag}</pre>
                  <span className="usb-diag-hint">{tr.addDialog.usbDiagHint}</span>
                </>
              )}
            </div>
          ) : (
            <div className="row-2">
              <div className="field">
                <label htmlFor="dev-host">{tr.addDialog.host}</label>
                <input
                  id="dev-host"
                  className="mono"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder={tr.addDialog.hostPlaceholder}
                  spellCheck={false}
                />
                {errors.host && <span className="error-text">{errors.host}</span>}
              </div>
              <div className="field">
                <label htmlFor="dev-port">{tr.addDialog.port}</label>
                <input
                  id="dev-port"
                  className="mono"
                  value={port}
                  onChange={(e) => setPort(e.target.value.replace(/[^\d]/g, ''))}
                  inputMode="numeric"
                />
                {errors.port && <span className="error-text">{errors.port}</span>}
              </div>
            </div>
          )}
        </div>
        <div className="dialog-foot">
          <button type="button" className="btn ghost" onClick={onClose}>
            {tr.addDialog.cancel}
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {tr.addDialog.add}
          </button>
        </div>
      </form>
    </div>,
    document.body
  )
}
