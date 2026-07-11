import type { ChannelMeasurement, ChannelSetpoints, DeviceTypeInfo } from '@shared/types'
import { tr } from '../../i18n/tr'
import { SetpointField } from './SetpointField'

interface Props {
  channel: number
  typeInfo: DeviceTypeInfo
  measurement: ChannelMeasurement
  setpoints: ChannelSetpoints
  connected: boolean
  /** Ayar kilidi: setpoint alanlarını devre dışı bırakır, çıkış anahtarı çalışır */
  locked: boolean
  onSetVoltage: (v: number) => Promise<void>
  onSetCurrent: (a: number) => Promise<void>
  onSetOvp: (v: number) => Promise<void>
  onSetOcp: (a: number) => Promise<void>
  onToggleOutput: (on: boolean) => Promise<void>
}

export function ChannelCard(props: Props): React.JSX.Element {
  const { channel, typeInfo, measurement: m, setpoints: sp, connected, locked } = props
  const on = connected && m.outputOn
  const spDisabled = !connected || locked

  return (
    <section className={`channel-card${on ? ' output-on' : ''}${connected ? '' : ' disabled'}`}>
      <div className="channel-head">
        <span className="ch-name">{tr.panel.channel(channel)}</span>
        <span className={`mode-badge ${m.mode}`}>{tr.panel.mode[m.mode]}</span>
        <button
          className={`output-toggle${on ? ' on' : ''}`}
          onClick={() => void props.onToggleOutput(!m.outputOn)}
          disabled={!connected}
          title={tr.panel.output}
        >
          <span className="dot" />
          {on ? tr.panel.outputOn : tr.panel.outputOff}
        </button>
      </div>

      <div className="readouts">
        <div className={`readout volt${on ? '' : ' dim'}`}>
          <div className="value">
            {m.voltage.toFixed(2)}
            <span className="unit">V</span>
          </div>
          <div className="panel-label ro-label">{tr.panel.measured}</div>
        </div>
        <div className={`readout amp${on ? '' : ' dim'}`}>
          <div className="value">
            {m.current.toFixed(2)}
            <span className="unit">A</span>
          </div>
          <div className="panel-label ro-label">{tr.panel.measured}</div>
        </div>
        <div className={`readout watt${on ? '' : ' dim'}`}>
          <div className="value">
            {m.power.toFixed(1)}
            <span className="unit">W</span>
          </div>
          <div className="panel-label ro-label">Güç</div>
        </div>
      </div>

      <div className={`setpoints${locked ? ' locked' : ''}`}>
        <SetpointField
          label={tr.panel.vSet}
          unit="V"
          value={sp.voltage}
          min={0}
          max={typeInfo.maxVoltage}
          step={0.1}
          disabled={spDisabled}
          onApply={props.onSetVoltage}
        />
        <SetpointField
          label={tr.panel.iSet}
          unit="A"
          value={sp.current}
          min={0}
          max={typeInfo.maxCurrent}
          step={0.01}
          disabled={spDisabled}
          onApply={props.onSetCurrent}
        />
        <SetpointField
          label={tr.panel.ovp}
          unit="V"
          value={sp.ovp}
          min={1}
          max={typeInfo.maxOvp}
          step={0.1}
          disabled={spDisabled}
          onApply={props.onSetOvp}
        />
        <SetpointField
          label={tr.panel.ocp}
          unit="A"
          value={sp.ocp}
          min={1}
          max={typeInfo.maxOcp}
          step={0.1}
          disabled={spDisabled}
          onApply={props.onSetOcp}
        />
      </div>
    </section>
  )
}
