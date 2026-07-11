import { useEffect, useRef, useState } from 'react'
import { tr } from '../i18n/tr'
import { useAppStore } from '../state/store'

interface Props {
  deviceId: string
  connected: boolean
  onError: (err: unknown) => void
  /** Girdi ipucu; verilmezse SCPI metni kullanılır */
  placeholder?: string
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

export function ScpiConsole({ deviceId, connected, onError, placeholder }: Props): React.JSX.Element {
  const deviceLogs = useAppStore((s) => s.logs[deviceId])
  const [showPolling, setShowPolling] = useState(false)
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const logRef = useRef<HTMLDivElement>(null)

  const userLogs = deviceLogs?.user ?? []
  const pollLogs = deviceLogs?.poll ?? []
  // Varsayılan: yalnızca kullanıcı trafiği. Açılırsa iki tampon zamana göre birleşir.
  const logs = showPolling
    ? [...userLogs, ...pollLogs].sort((a, b) => a.timestamp - b.timestamp)
    : userLogs

  // Yeni satır geldikçe en alta kaydır
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs.length, showPolling])

  const send = async (): Promise<void> => {
    const cmd = input.trim()
    if (!cmd) return
    setHistory((h) => [cmd, ...h.slice(0, 49)])
    setHistIdx(-1)
    setInput('')
    try {
      await window.deviceApi.sendRaw(deviceId, cmd)
    } catch (err) {
      onError(err)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') void send()
    else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.min(histIdx + 1, history.length - 1)
      if (next >= 0 && history[next] !== undefined) {
        setHistIdx(next)
        setInput(history[next])
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = histIdx - 1
      setHistIdx(next)
      setInput(next >= 0 ? history[next] : '')
    }
  }

  return (
    <div className="scpi-console">
      <div className="scpi-log" ref={logRef}>
        {logs.length === 0 ? (
          <div className="empty-note">{tr.console.empty}</div>
        ) : (
          logs.map((l, i) => (
            <div key={i} className={`scpi-line ${l.dir}${l.source === 'poll' ? ' poll' : ''}`}>
              <span className="ts">{fmtTime(l.timestamp)}</span>
              <span className="dir">{l.dir === 'tx' ? '→' : '←'}</span>
              <span className="body">{l.line}</span>
            </div>
          ))
        )}
      </div>
      <div className="scpi-input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? tr.console.placeholder}
          disabled={!connected}
          spellCheck={false}
        />
        <label className="poll-toggle" title={tr.console.showPollingHint}>
          <input
            type="checkbox"
            checked={showPolling}
            onChange={(e) => setShowPolling(e.target.checked)}
          />
          {tr.console.showPolling}
        </label>
      </div>
    </div>
  )
}
