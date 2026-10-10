import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeviceConfig, RfState } from '@shared/types'
import { deviceTypeInfo } from '@shared/types'
import { tr } from '../../i18n/tr'
import { useAppStore } from '../../state/store'
import { TopBar } from '../psu/TopBar'
import { SetpointField } from '../psu/SetpointField'
import { ScpiConsole } from '../ScpiConsole'

const EMPTY_RF: RfState = { frequencyHz: 0, powerDbm: 0, outputOn: false }

/** Büyük gösterge için: ≥ 1 GHz ise GHz (kHz çözünürlük), değilse MHz. */
function formatFreq(hz: number): { value: string; unit: string } {
  if (hz >= 1e9) return { value: (hz / 1e9).toFixed(6), unit: 'GHz' }
  return { value: (hz / 1e6).toFixed(3), unit: 'MHz' }
}

/** "2412000000" → "2 412 000 000" (tam Hz değeri, alt satır) */
function groupHz(hz: number): string {
  return Math.round(hz)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}

/** Mini-Circuits SSG sinyal üreteci paneli: frekans, güç, RF aç/kapat. */
export function SigGenPanel({ device }: { device: DeviceConfig }): React.JSX.Element {
  const snapshot = useAppStore((s) => s.snapshots[device.id])
  const typeInfo = deviceTypeInfo(device.kind)
  const limits = typeInfo.rf!
  const [toast, setToast] = useState<string | null>(null)
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

  const api = window.deviceApi
  const connected = snapshot?.state === 'connected'
  const locked = device.locked === true
  const rf = snapshot?.rf ?? EMPTY_RF
  const on = connected && rf.outputOn
  const spDisabled = !connected || locked
  const freq = formatFreq(rf.frequencyHz)

  const toggleLock = useCallback(async () => {
    await api.updateDevice({ ...device, locked: !device.locked })
    await useAppStore.getState().refreshDevices()
  }, [api, device])

  return (
    <div className="psu-panel">
      <TopBar
        device={device}
        snapshot={snapshot}
        onConnect={() => run(() => api.connect(device.id))}
        onDisconnect={() => run(() => api.disconnect(device.id))}
        onAllOutputs={async () => undefined}
        onTracking={async () => undefined}
        onToggleLock={() => run(toggleLock)}
        onRefresh={() => run(() => api.refresh(device.id))}
      />

      <div className="panel-scroll">
        {!connected && (
          <div className="not-connected-note">{snapshot?.error ? snapshot.error : tr.panel.notConnected}</div>
        )}

        <div className="channels">
          <section className={`channel-card rf-card${on ? ' output-on' : ''}${connected ? '' : ' disabled'}`}>
            <div className="channel-head">
              <span className="ch-name">{tr.sigGen.rfOutput}</span>
              <button
                className={`output-toggle${on ? ' on' : ''}`}
                onClick={() => void run(() => api.setRfOutput(device.id, !rf.outputOn))}
                disabled={!connected}
                title={tr.sigGen.rfOutput}
              >
                <span className="dot" />
                {on ? tr.sigGen.rfOn : tr.sigGen.rfOff}
              </button>
            </div>

            <div className="readouts">
              <div className={`readout volt${on ? '' : ' dim'}`}>
                <div className="value">
                  {freq.value}
                  <span className="unit">{freq.unit}</span>
                </div>
                <div className="panel-label ro-label">
                  {tr.sigGen.frequency} · <span className="mono">{groupHz(rf.frequencyHz)} Hz</span>
                </div>
              </div>
              <div className={`readout amp${on ? '' : ' dim'}`}>
                <div className="value">
                  {rf.powerDbm.toFixed(2)}
                  <span className="unit">dBm</span>
                </div>
                <div className="panel-label ro-label">
                  {tr.sigGen.power} · {tr.sigGen.readback}
                </div>
              </div>
            </div>

            <div className={`setpoints${locked ? ' locked' : ''}`}>
              <SetpointField
                label={tr.sigGen.frequency}
                unit="MHz"
                value={rf.frequencyHz / 1e6}
                min={limits.minFreqHz / 1e6}
                max={limits.maxFreqHz / 1e6}
                step={1}
                decimals={6}
                disabled={spDisabled}
                onApply={async (mhz) => {
                  await api.setFrequency(device.id, Math.round(mhz * 1e6)).catch((e) => {
                    showError(e)
                    throw e
                  })
                }}
              />
              <SetpointField
                label={tr.sigGen.power}
                unit="dBm"
                value={rf.powerDbm}
                min={limits.minPowerDbm}
                max={limits.maxPowerDbm}
                step={limits.powerStepDb}
                decimals={2}
                disabled={spDisabled}
                onApply={async (dbm) => {
                  await api.setPower(device.id, dbm).catch((e) => {
                    showError(e)
                    throw e
                  })
                }}
              />
            </div>
            <div className="rf-hint">
              <span>
                {tr.sigGen.range(
                  limits.minFreqHz / 1e6,
                  limits.maxFreqHz / 1e6,
                  limits.minPowerDbm,
                  limits.maxPowerDbm,
                  limits.powerStepDb
                )}
              </span>
              <span>{tr.sigGen.hint}</span>
            </div>
          </section>
        </div>
      </div>

      <div className="console-toggle-row">
        <button className="toggle-btn" onClick={() => setConsoleOpen((o) => !o)}>
          <svg className={`chevron${consoleOpen ? ' open' : ''}`} width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 6.5 5 3.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {tr.console.title}
        </button>
        {consoleOpen && (
          <ScpiConsole
            deviceId={device.id}
            connected={connected}
            onError={showError}
            placeholder={tr.sigGen.consolePlaceholder}
          />
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
