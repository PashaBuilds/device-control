import { useEffect, useRef, useState } from 'react'
import { tr } from '../../i18n/tr'

interface Props {
  label: string
  unit: string
  /** Cihazdan okunan doğrulanmış değer */
  value: number
  min: number
  max: number
  step: number
  disabled?: boolean
  /** Gösterilen en çok ondalık basamak (varsayılan 3) */
  decimals?: number
  onApply: (value: number) => Promise<void>
}

function fmtNum(v: number, decimals = 3): string {
  return v.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '.0')
}

/**
 * Setpoint girişi: yazarak (Enter/blur ile uygula) veya adım düğmeleriyle.
 * Girilen değer cihazdakinden farklıyken amber "bekleyen değişiklik" vurgusu alır.
 */
export function SetpointField({
  label,
  unit,
  value,
  min,
  max,
  step,
  disabled,
  decimals = 3,
  onApply
}: Props): React.JSX.Element {
  const fmt = (v: number): string => fmtNum(v, decimals)
  const [text, setText] = useState(fmt(value))
  const [error, setError] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const lastValue = useRef(value)

  // Cihaz değeri değişince (ve kullanıcı yazmıyorken) alanı senkronla
  useEffect(() => {
    if (!focused && value !== lastValue.current) {
      setText(fmt(value))
      setError(null)
    }
    lastValue.current = value
  }, [value, focused])

  const parse = (raw: string): number | null => {
    const n = Number(raw.trim().replace(',', '.'))
    if (!Number.isFinite(n)) return null
    return n
  }

  const apply = async (raw: string): Promise<void> => {
    const n = parse(raw)
    if (n === null || n < min || n > max) {
      setError(tr.errors.range(min, max, unit))
      return
    }
    setError(null)
    try {
      await onApply(n)
      setText(fmt(n))
    } catch {
      // toast üst bileşende gösterilir; alanı cihaz değerine döndür
      setText(fmt(value))
    }
  }

  const nudge = async (dir: 1 | -1): Promise<void> => {
    const base = parse(text) ?? value
    const next = Math.min(max, Math.max(min, Number((base + dir * step).toFixed(decimals))))
    setText(fmt(next))
    await apply(String(next))
  }

  const pending = !disabled && parse(text) !== null && parse(text) !== value

  return (
    <div className="setpoint">
      <div className="sp-head">
        <span className="panel-label">{label}</span>
        {error && <span className="sp-error">{error}</span>}
      </div>
      <div className={`sp-control${pending ? ' pending' : ''}`}>
        <input
          value={text}
          disabled={disabled}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            if (parse(text) !== value) void apply(text)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void apply(text)
            else if (e.key === 'ArrowUp') {
              e.preventDefault()
              void nudge(1)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              void nudge(-1)
            }
          }}
          aria-label={`${label} (${unit})`}
        />
        <span className="sp-unit">{unit}</span>
        <span className="stepper">
          <button type="button" tabIndex={-1} disabled={disabled} onClick={() => void nudge(1)} aria-label="Artır">
            ▲
          </button>
          <button type="button" tabIndex={-1} disabled={disabled} onClick={() => void nudge(-1)} aria-label="Azalt">
            ▼
          </button>
        </span>
      </div>
    </div>
  )
}
