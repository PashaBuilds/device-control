import type { ConnectionState, DeviceConfig, DeviceSnapshot } from '@shared/types'
import { tr } from '../../i18n/tr'

interface Props {
  device: DeviceConfig
  snapshot: DeviceSnapshot | undefined
  onConnect: () => Promise<void>
  onDisconnect: () => Promise<void>
  onAllOutputs: (on: boolean) => Promise<void>
  onTracking: (on: boolean) => Promise<void>
}

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

export function TopBar({ device, snapshot, onConnect, onDisconnect, onAllOutputs, onTracking }: Props): React.JSX.Element {
  const state = snapshot?.state ?? 'disconnected'
  const connected = state === 'connected'
  const busy = state === 'connecting' || state === 'reconnecting'

  return (
    <header className="topbar">
      <div className="title-block">
        <h1>{device.name}</h1>
        <div className="idn">{connected && snapshot?.identity ? snapshot.identity : `${device.host}:${device.port}`}</div>
      </div>

      {connected && (
        <>
          <button
            className="switch-label"
            title={tr.panel.trackingHint}
            onClick={() => void onTracking(!snapshot?.tracking)}
          >
            <span className={`switch${snapshot?.tracking ? ' on' : ''}`} />
            {tr.panel.tracking}
          </button>
          <button className="btn" onClick={() => void onAllOutputs(true)}>
            {tr.panel.allOn}
          </button>
          <button className="btn" onClick={() => void onAllOutputs(false)}>
            {tr.panel.allOff}
          </button>
        </>
      )}

      <span className="conn-state">
        <span className={ledClass(state)} />
        {tr.state[state]}
      </span>

      {connected || busy ? (
        <button className="btn ghost" onClick={() => void onDisconnect()}>
          {tr.panel.disconnect}
        </button>
      ) : (
        <button className="btn primary" onClick={() => void onConnect()}>
          {tr.panel.connect}
        </button>
      )}
    </header>
  )
}
