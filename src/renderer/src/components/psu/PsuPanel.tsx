import type { DeviceConfig } from '@shared/types'
import { tr } from '../../i18n/tr'
import { useAppStore } from '../../state/store'

// Task 8'de tam kontrol paneliyle değiştirilecek iskelet.
export function PsuPanel({ device }: { device: DeviceConfig }): React.JSX.Element {
  const snap = useAppStore((s) => s.snapshots[device.id])
  return (
    <div style={{ padding: 24 }}>
      <h2>{device.name}</h2>
      <p style={{ color: 'var(--text-2)' }}>{snap ? tr.state[snap.state] : tr.state.disconnected}</p>
    </div>
  )
}
