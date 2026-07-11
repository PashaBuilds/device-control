import { useState } from 'react'
import { DEVICE_TYPES, type ConnectionState, type DeviceCategory } from '@shared/types'
import { tr } from '../i18n/tr'
import { useAppStore } from '../state/store'
import { AddDeviceDialog } from './AddDeviceDialog'
import { DiscoverDialog } from './DiscoverDialog'

function ledClass(state: ConnectionState | undefined): string {
  switch (state) {
    case 'connected':
      return 'led on'
    case 'connecting':
    case 'reconnecting':
      return 'led busy'
    case 'error':
      return 'led err'
    default:
      return 'led'
  }
}

const CATEGORY_ORDER: DeviceCategory[] = ['power-supply', 'debug-probe']

export function Sidebar(): React.JSX.Element {
  const { devices, snapshots, selectedId, select, removeDevice } = useAppStore()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [discoverOpen, setDiscoverOpen] = useState(false)

  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    items: devices.filter((d) => DEVICE_TYPES.find((t) => t.kind === d.kind)?.category === cat)
  }))

  const onRemove = async (e: React.MouseEvent, id: string, name: string): Promise<void> => {
    e.stopPropagation()
    if (window.confirm(tr.sidebar.removeConfirm(name))) {
      await removeDevice(id)
    }
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="logo">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M1 8h3l2-5 3 10 2-5h4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div>
          <div className="name">{tr.appName}</div>
          <div className="sub">{tr.appSubtitle}</div>
        </div>
      </div>

      <button className="discover-btn" onClick={() => setDiscoverOpen(true)}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="7" cy="7" r="1.6" fill="currentColor" />
        </svg>
        {tr.sidebar.discover}
      </button>

      <div className="sidebar-body">
        {byCategory.map(({ cat, items }) => (
          <div className="category" key={cat}>
            <div className="category-head">
              <span className="panel-label">{tr.categories[cat]}</span>
              <span className="count">{items.length}</span>
            </div>

            {items.map((d) => {
              const snap = snapshots[d.id]
              return (
                <button
                  key={d.id}
                  className={`device-row${selectedId === d.id ? ' selected' : ''}`}
                  onClick={() => select(d.id)}
                  title={`${d.host}:${d.port}`}
                >
                  <span className={ledClass(snap?.state)} />
                  <span className="info">
                    <span className="dev-name">{d.name}</span>
                    <div className="dev-addr">
                      {d.host}:{d.port}
                    </div>
                  </span>
                  <span
                    role="button"
                    tabIndex={-1}
                    className="remove"
                    title={tr.sidebar.removeDevice}
                    onClick={(e) => void onRemove(e, d.id, d.name)}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                    </svg>
                  </span>
                </button>
              )
            })}

            <button className="add-device" onClick={() => setDialogOpen(true)}>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              {tr.sidebar.addDevice}
            </button>
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        <span>{typeof __APP_VERSION__ !== 'undefined' ? `v${__APP_VERSION__}` : ''}</span>
        <span>TCP/IP</span>
      </div>

      {dialogOpen && <AddDeviceDialog onClose={() => setDialogOpen(false)} />}
      {discoverOpen && <DiscoverDialog onClose={() => setDiscoverOpen(false)} />}
    </aside>
  )
}
