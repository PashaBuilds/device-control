import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import { DEVICE_TYPES, type DiscoveredDevice } from '@shared/types'
import { tr } from '../i18n/tr'
import { useAppStore } from '../state/store'

function categoryOf(kind: string): string {
  const cat = DEVICE_TYPES.find((t) => t.kind === kind)?.category
  return cat ? tr.categories[cat] : ''
}

export function DiscoverDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const devices = useAppStore((s) => s.devices)
  const addDevice = useAppStore((s) => s.addDevice)
  const [scanning, setScanning] = useState(false)
  const [ran, setRan] = useState(false)
  const [found, setFound] = useState<DiscoveredDevice[]>([])
  const [adding, setAdding] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const scan = async (): Promise<void> => {
    setScanning(true)
    try {
      const results = await window.deviceApi.discover()
      setFound(results)
      setRan(true)
    } finally {
      setScanning(false)
    }
  }

  // Açılışta otomatik bir tarama başlat
  useEffect(() => {
    void scan()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const isAdded = (d: DiscoveredDevice): boolean =>
    devices.some((dev) => dev.host === d.host && dev.port === d.port)

  const add = async (d: DiscoveredDevice): Promise<void> => {
    const key = `${d.host}:${d.port}`
    setAdding(key)
    try {
      await addDevice({ name: `${d.label} (${d.host})`, kind: d.kind, host: d.host, port: d.port })
    } finally {
      setAdding(null)
    }
  }

  return createPortal(
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog discover-dialog">
        <div className="dialog-head discover-head">
          <div>
            <h3>{tr.discover.title}</h3>
            <div className="discover-sub">
              {scanning
                ? tr.discover.subtitle
                : ran
                  ? tr.discover.countFound(found.length)
                  : tr.discover.idle}
            </div>
          </div>
          {scanning && <span className="scan-spinner" aria-hidden />}
        </div>

        <div className="discover-body">
          {scanning && found.length === 0 && (
            <div className="discover-scanning">
              <div className="radar" aria-hidden>
                <span />
                <span />
                <span />
              </div>
            </div>
          )}

          {!scanning && ran && found.length === 0 && (
            <div className="discover-empty">{tr.discover.empty}</div>
          )}

          {found.map((d) => {
            const added = isAdded(d)
            const key = `${d.host}:${d.port}`
            return (
              <div className={`discovered-row${added ? ' is-added' : ''}`} key={key}>
                <span className={`led on kind-${d.kind}`} />
                <div className="disc-info">
                  <div className="disc-title">
                    <span className="disc-label">{d.label}</span>
                    <span className="disc-cat">{categoryOf(d.kind)}</span>
                  </div>
                  <div className="disc-meta mono">
                    {d.host}:{d.port}
                    {d.mac ? <span className="disc-mac"> · {tr.discover.mac} {d.mac}</span> : null}
                  </div>
                </div>
                {added ? (
                  <span className="disc-added">✓ {tr.discover.added}</span>
                ) : (
                  <button className="btn primary" disabled={adding === key} onClick={() => void add(d)}>
                    {tr.discover.add}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div className="dialog-foot">
          <button className="btn ghost" onClick={onClose}>
            {tr.discover.close}
          </button>
          <button className="btn" disabled={scanning} onClick={() => void scan()}>
            {scanning ? tr.discover.scanning : ran ? tr.discover.rescan : tr.discover.scan}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
