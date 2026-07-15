import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectionState, DeviceConfig } from '@shared/types'
import { deviceTypeInfo } from '@shared/types'
import { tr } from '../../i18n/tr'
import { useAppStore } from '../../state/store'
import { ScpiConsole } from '../ScpiConsole'

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

/** Debug probu (Xilinx SmartLynq / hw_server) paneli. */
export function ProbePanel({ device }: { device: DeviceConfig }): React.JSX.Element {
  const snapshot = useAppStore((s) => s.snapshots[device.id])
  const [toast, setToast] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [consoleOpen, setConsoleOpen] = useState(false)
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

  const state = snapshot?.state ?? 'disconnected'
  const connected = state === 'connected'
  const busy = state === 'connecting' || state === 'reconnecting'
  const probe = snapshot?.probe ?? null
  const api = window.deviceApi
  const address = `${device.host}:${device.port}`

  const copyAddress = async (): Promise<void> => {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="psu-panel">
      <header className="topbar">
        <div className="title-block">
          <div className="title-row">
            <h1>{device.name}</h1>
            <span className="model-chip">{deviceTypeInfo(device.kind).label}</span>
          </div>
          <div className="idn">{connected && snapshot?.identity ? snapshot.identity : address}</div>
        </div>

        <span className="conn-state">
          <span className={ledClass(state)} />
          {tr.state[state]}
        </span>

        {connected || busy ? (
          <button className="btn ghost" onClick={() => void run(() => api.disconnect(device.id))}>
            {tr.panel.disconnect}
          </button>
        ) : (
          <button className="btn primary" onClick={() => void run(() => api.connect(device.id))}>
            {tr.panel.connect}
          </button>
        )}
      </header>

      <div className="panel-scroll">
        {!connected && (
          <div className="not-connected-note">
            {snapshot?.error ? snapshot.error : tr.panel.notConnected}
          </div>
        )}

        <div className="info-grid">
          <section className={`info-card${connected ? '' : ' dim'}`}>
            <div className="panel-label">{tr.probe.vivado}</div>
            <div className="info-value-row">
              <span className="mono info-value">{address}</span>
              <button className="btn ghost" onClick={() => void copyAddress()}>
                {copied ? tr.probe.copied : tr.probe.copy}
              </button>
            </div>
            <div className="info-hint">{tr.probe.vivadoHint}</div>
          </section>

          <section className={`info-card${connected ? '' : ' dim'}`}>
            <div className="panel-label">{tr.probe.agent}</div>
            <div className="info-value-row">
              <span className="mono info-value">{probe?.agentId ?? '—'}</span>
            </div>
          </section>

          <section className={`info-card wide jtag-card${connected ? '' : ' dim'}`}>
            <div className="jtag-header">
              <span className="panel-label">{tr.probe.jtag}</span>
              {probe && probe.jtagTargets.length > 0 && (
                <span className="jtag-health">
                  <span className="led on" />
                  {tr.probe.jtagHealthy} · {tr.probe.jtagCount(probe.jtagTargets.length)}
                </span>
              )}
            </div>
            {probe && probe.jtagTargets.length > 0 ? (
              <div className="jtag-chain">
                <span className="jtag-port">TDI</span>
                <span className="jtag-wire" />
                {probe.jtagTargets.map((t, i) => (
                  <div key={t.name} className="jtag-node-group">
                    <div className="jtag-node" style={{ animationDelay: `${i * 80}ms` }}>
                      <div className="jtag-node-name">{t.name}</div>
                      {t.idCode && (
                        <div className="jtag-node-attr">
                          <span className="k">{tr.probe.idcode}</span>
                          <span className="v mono">{t.idCode}</span>
                        </div>
                      )}
                      {t.irLen != null && (
                        <div className="jtag-node-attr">
                          <span className="k">{tr.probe.irlen}</span>
                          <span className="v mono">{t.irLen} bit</span>
                        </div>
                      )}
                    </div>
                    <span className="jtag-wire" />
                  </div>
                ))}
                <span className="jtag-port">TDO</span>
              </div>
            ) : (
              <div className="info-hint">{connected ? tr.probe.jtagEmpty : tr.probe.servicesEmpty}</div>
            )}
          </section>

          <section className={`info-card wide${connected ? '' : ' dim'}`}>
            <div className="panel-label">{tr.probe.services}</div>
            {probe && probe.services.length > 0 ? (
              <div className="chip-row">
                {probe.services.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <div className="info-hint">{tr.probe.servicesEmpty}</div>
            )}
          </section>
        </div>
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
          {tr.probe.consoleTitle}
        </button>
        {consoleOpen && (
          <ScpiConsole
            deviceId={device.id}
            connected={connected}
            onError={showError}
            placeholder={tr.probe.consolePlaceholder}
          />
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
