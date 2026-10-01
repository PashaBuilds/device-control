import { useEffect, useState } from 'react'
import type { ConnectionState, DeviceConfig, DeviceSnapshot } from '@shared/types'
import { deviceTypeInfo } from '@shared/types'
import { tr } from '../../i18n/tr'

interface Props {
  device: DeviceConfig
  snapshot: DeviceSnapshot | undefined
  onConnect: () => Promise<void>
  onDisconnect: () => Promise<void>
  onAllOutputs: (on: boolean) => Promise<void>
  onTracking: (on: boolean) => Promise<void>
  onToggleLock: () => Promise<void>
  onRefresh: () => Promise<void>
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

/** Saniyede bir yenilenen "şimdi" değeri (son okuma yaşını göstermek için). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  return now
}

export function TopBar({
  device,
  snapshot,
  onConnect,
  onDisconnect,
  onAllOutputs,
  onTracking,
  onToggleLock,
  onRefresh
}: Props): React.JSX.Element {
  const state = snapshot?.state ?? 'disconnected'
  const connected = state === 'connected'
  const busy = state === 'connecting' || state === 'reconnecting'
  const locked = device.locked === true
  const typeInfo = deviceTypeInfo(device.kind)
  const hasTracking = typeInfo.hasTracking
  // Ön paneli serbest bırakan türlerde (CPX) okuma seyrek: tazelik rozeti + Yenile
  const panelRelease = typeInfo.idleCommand !== undefined
  const now = useNow()
  const ageSec = snapshot ? Math.max(0, Math.round((now - snapshot.timestamp) / 1000)) : 0

  return (
    <header className="topbar">
      <div className="title-block">
        <div className="title-row">
          <h1>{device.name}</h1>
          <span className="model-chip">{deviceTypeInfo(device.kind).label}</span>
        </div>
        <div className="idn">{connected && snapshot?.identity ? snapshot.identity : `${device.host}:${device.port}`}</div>
      </div>

      <button
        className={`lock-btn${locked ? ' locked' : ''}`}
        title={locked ? tr.panel.lockHintOn : tr.panel.lockHintOff}
        onClick={() => void onToggleLock()}
        aria-pressed={locked}
      >
        {locked ? (
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <rect x="2.5" y="6" width="9" height="6.5" rx="1.5" fill="currentColor" opacity="0.25" />
            <rect x="2.5" y="6" width="9" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M4.5 6V4.5a2.5 2.5 0 0 1 5 0V6" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="7" cy="9.2" r="1.1" fill="currentColor" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <rect x="2.5" y="6" width="9" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M9.5 6V4.5a2.5 2.5 0 0 0-5 0" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        )}
        {locked ? tr.panel.locked : tr.panel.lock}
      </button>

      {connected && (
        <>
          {panelRelease && (
            <span className="fresh-chip" title={tr.panel.panelFreeHint(typeInfo.pollIntervalMs / 1000)}>
              <span className="led on" />
              {tr.panel.panelFree} · {tr.panel.lastRead(ageSec)}
              <button className="btn ghost tiny" title={tr.panel.refreshHint} onClick={() => void onRefresh()}>
                {tr.panel.refresh}
              </button>
            </span>
          )}
          {hasTracking && (
            <button
              className="switch-label"
              title={locked ? tr.panel.lockHintOn : tr.panel.trackingHint}
              onClick={() => void onTracking(!snapshot?.tracking)}
              disabled={locked}
            >
              <span className={`switch${snapshot?.tracking ? ' on' : ''}`} />
              {tr.panel.tracking}
            </button>
          )}
          {/* Tek kanallı cihazda kanal kartındaki çıkış düğmesi yeterli */}
          {typeInfo.channelCount > 1 && (
            <>
              <button className="btn" onClick={() => void onAllOutputs(true)}>
                {tr.panel.allOn}
              </button>
              <button className="btn" onClick={() => void onAllOutputs(false)}>
                {tr.panel.allOff}
              </button>
            </>
          )}
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
