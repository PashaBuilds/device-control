import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeviceConfig } from '@shared/types'
import { deviceTypeInfo } from '@shared/types'
import { tr } from '../../i18n/tr'
import { useAppStore } from '../../state/store'
import { TopBar } from './TopBar'
import { ChannelCard } from './ChannelCard'
import { TrendChart } from './TrendChart'
import { ScpiConsole } from '../ScpiConsole'

export function PsuPanel({ device }: { device: DeviceConfig }): React.JSX.Element {
  const snapshot = useAppStore((s) => s.snapshots[device.id])
  const typeInfo = deviceTypeInfo(device.kind)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    },
    []
  )

  const showError = useCallback((err: unknown) => {
    const msg = err instanceof Error ? err.message : tr.errors.generic
    setToast(msg)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 4500)
  }, [])

  /** Cihaz komutunu çalıştırır; hata olursa toast gösterir (fırlatmaz). */
  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      try {
        await fn()
      } catch (err) {
        showError(err)
      }
    },
    [showError]
  )

  const connected = snapshot?.state === 'connected'
  const api = window.deviceApi
  const [consoleOpen, setConsoleOpen] = useState(false)

  return (
    <div className="psu-panel">
      <TopBar
        device={device}
        snapshot={snapshot}
        onConnect={() => run(() => api.connect(device.id))}
        onDisconnect={() => run(() => api.disconnect(device.id))}
        onAllOutputs={(on) => run(() => api.setAllOutputs(device.id, on))}
        onTracking={(on) => run(() => api.setTracking(device.id, on))}
      />

      {snapshot && snapshot.trips.length > 0 && (
        <div className="trip-banner" role="alert">
          <div className="msgs">
            {snapshot.trips.map((t) => (
              <span key={`${t.channel}-${t.kind}`}>{tr.panel.trip[t.kind](t.channel)}</span>
            ))}
          </div>
          <button className="btn danger" onClick={() => void run(() => api.tripReset(device.id))}>
            {tr.panel.trip.reset}
          </button>
        </div>
      )}

      <div className="panel-scroll">
      {!connected && (
        <div className="not-connected-note">
          {snapshot?.error ? snapshot.error : tr.panel.notConnected}
        </div>
      )}

      <div className="channels">
        {Array.from({ length: typeInfo.channelCount }, (_, i) => i + 1).map((ch) => (
          <ChannelCard
            key={ch}
            channel={ch}
            typeInfo={typeInfo}
            connected={connected}
            measurement={
              snapshot?.channels[ch - 1] ?? {
                voltage: 0,
                current: 0,
                power: 0,
                outputOn: false,
                mode: 'off'
              }
            }
            setpoints={snapshot?.setpoints[ch - 1] ?? { voltage: 0, current: 0, ovp: 0, ocp: 0 }}
            onSetVoltage={async (v) => {
              await api.setVoltage(device.id, ch, v).catch((e) => {
                showError(e)
                throw e
              })
            }}
            onSetCurrent={async (a) => {
              await api.setCurrent(device.id, ch, a).catch((e) => {
                showError(e)
                throw e
              })
            }}
            onSetOvp={async (v) => {
              await api.setOvp(device.id, ch, v).catch((e) => {
                showError(e)
                throw e
              })
            }}
            onSetOcp={async (a) => {
              await api.setOcp(device.id, ch, a).catch((e) => {
                showError(e)
                throw e
              })
            }}
            onToggleOutput={(on) => run(() => api.setOutput(device.id, ch, on))}
          />
        ))}
      </div>

      <TrendChart deviceId={device.id} deviceName={device.name} channelCount={typeInfo.channelCount} />
      </div>

      <div className="console-toggle-row">
        <button className="toggle-btn" onClick={() => setConsoleOpen((o) => !o)}>
          <svg
            className={`chevron${consoleOpen ? ' open' : ''}`}
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
          >
            <path d="M2 6.5 5 3.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {tr.console.title}
        </button>
        {consoleOpen && (
          <ScpiConsole deviceId={device.id} connected={connected} onError={showError} />
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
