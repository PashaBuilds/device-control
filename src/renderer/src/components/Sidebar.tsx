import { useState } from 'react'
import { DEVICE_TYPES, deviceTypeInfo, type ConnectionState, type DeviceCategory } from '@shared/types'
import { tr } from '../i18n/tr'
import { useAppStore } from '../state/store'
import { AddDeviceDialog } from './AddDeviceDialog'

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
  const { devices, snapshots, selectedId, select, removeDevice, theme, toggleTheme } = useAppStore()
  const [dialogOpen, setDialogOpen] = useState(false)

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
                    <div className="dev-model">{deviceTypeInfo(d.kind).label}</div>
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
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          title={theme === 'dark' ? tr.theme.toLight : tr.theme.toDark}
          aria-label={theme === 'dark' ? tr.theme.toLight : tr.theme.toDark}
        >
          {theme === 'dark' ? (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="3.4" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M2.9 2.9l1.1 1.1M12 12l1.1 1.1M13.1 2.9L12 4M4 12l-1.1 1.1"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path
                d="M13.5 9.2A5.6 5.6 0 0 1 6.8 2.5 5.6 5.6 0 1 0 13.5 9.2Z"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
          )}
          <span>{theme === 'dark' ? tr.theme.light : tr.theme.dark}</span>
        </button>
      </div>

      {dialogOpen && <AddDeviceDialog onClose={() => setDialogOpen(false)} />}
    </aside>
  )
}
