import { useState } from 'react'
import { tr } from '../i18n/tr'
import { AddDeviceDialog } from './AddDeviceDialog'

export function EmptyState(): React.JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <div className="empty-state">
      <div className="inner">
        <div className="glyph">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
            <rect x="2" y="6" width="24" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
            <path
              className="wave"
              d="M6 14h4l2-4 3 8 2-4h5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <h2>{tr.empty.title}</h2>
        <p>{tr.empty.body}</p>
        <button className="btn primary" onClick={() => setDialogOpen(true)}>
          {tr.empty.action}
        </button>
      </div>
      {dialogOpen && <AddDeviceDialog onClose={() => setDialogOpen(false)} />}
    </div>
  )
}
