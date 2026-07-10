import { useEffect, useRef, useState } from 'react'
import { DEVICE_TYPES, type DeviceKind } from '@shared/types'
import { tr } from '../i18n/tr'
import { useAppStore } from '../state/store'

const HOST_RE = /^(?:(?:\d{1,3}\.){3}\d{1,3}|[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*)$/

function validIpv4(host: string): boolean {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return true // IP değilse sunucu adı kuralına bakılır
  return host.split('.').every((p) => Number(p) <= 255)
}

export function AddDeviceDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const addDevice = useAppStore((s) => s.addDevice)
  const [kind, setKind] = useState<DeviceKind>(DEVICE_TYPES[0].kind)
  const typeInfo = DEVICE_TYPES.find((t) => t.kind === kind)!
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(String(typeInfo.defaultPort))
  const [errors, setErrors] = useState<{ name?: string; host?: string; port?: string }>({})
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => nameRef.current?.focus(), [])

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
    const trimmedHost = host.trim()
    const portNum = Number(port)
    if (!trimmedName) errs.name = tr.addDialog.errors.nameRequired
    if (!trimmedHost || !HOST_RE.test(trimmedHost) || !validIpv4(trimmedHost))
      errs.host = tr.addDialog.errors.hostInvalid
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)
      errs.port = tr.addDialog.errors.portInvalid
    setErrors(errs)
    if (Object.keys(errs).length > 0) return

    setBusy(true)
    try {
      await addDevice({ name: trimmedName, kind, host: trimmedHost, port: portNum })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={(e) => void submit(e)}>
        <div className="dialog-head">
          <h3>{tr.addDialog.title}</h3>
        </div>
        <div className="dialog-body">
          <div className="field">
            <label htmlFor="dev-type">{tr.addDialog.type}</label>
            <select id="dev-type" value={kind} onChange={(e) => setKind(e.target.value as DeviceKind)}>
              {DEVICE_TYPES.map((t) => (
                <option key={t.kind} value={t.kind}>
                  {t.label}
                </option>
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
              placeholder={tr.addDialog.namePlaceholder}
            />
            {errors.name && <span className="error-text">{errors.name}</span>}
          </div>
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
    </div>
  )
}
