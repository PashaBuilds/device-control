import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { tr } from '../../i18n/tr'
import { getHistory, toCsv } from '../../state/history'
import { useAppStore } from '../../state/store'

interface Props {
  deviceId: string
  deviceName: string
  channelCount: number
}

const WINDOWS = [
  { label: tr.chart.window1m, seconds: 60 },
  { label: tr.chart.window5m, seconds: 300 },
  { label: tr.chart.window30m, seconds: 1800 }
] as const

interface ChartColors {
  volt: string
  amp: string
  axis: string
  grid: string
  tick: string
}

/**
 * Grafik renkleri tema tokenlarından okunur (gerilim camgöbeği, akım amber);
 * tema değişince grafik yeniden kurulur. 2. kanal kesikli çizgiyle ayrışır.
 */
function chartColors(): ChartColors {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string): string => css.getPropertyValue(name).trim()
  return { volt: v('--volt'), amp: v('--amp'), axis: v('--text-3'), grid: v('--line'), tick: v('--line-strong') }
}

/** "#rrggbb" + alfa → canvas'ın anladığı "rgba(r, g, b, a)". */
function withAlpha(hex: string, alpha: number): string {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return hex
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`
}

function buildSeries(channelCount: number, c: ChartColors): uPlot.Series[] {
  const series: uPlot.Series[] = [{}]
  for (let ch = 1; ch <= channelCount; ch++) {
    series.push({
      label: tr.chart.voltage(ch),
      stroke: c.volt,
      width: 1.6,
      dash: ch === 2 ? [6, 4] : undefined,
      // yalnızca düz çizgili 1. kanal alan dolgusu alır — okunaklılık korunur
      fill: ch === 1 ? withAlpha(c.volt, 0.07) : undefined,
      scale: 'V',
      points: { show: false },
      value: (_u, v) => (v == null ? '—' : `${v.toFixed(2)} V`)
    })
    series.push({
      label: tr.chart.current(ch),
      stroke: c.amp,
      width: 1.6,
      dash: ch === 2 ? [6, 4] : undefined,
      fill: ch === 1 ? withAlpha(c.amp, 0.055) : undefined,
      scale: 'A',
      points: { show: false },
      value: (_u, v) => (v == null ? '—' : `${v.toFixed(2)} A`)
    })
  }
  return series
}

function axisStyle(c: ChartColors): Partial<uPlot.Axis> {
  return {
    stroke: c.axis,
    grid: { stroke: withAlpha(c.grid, 0.6), width: 1 },
    ticks: { stroke: c.tick, width: 1 },
    font: '10.5px "IBM Plex Mono"'
  }
}

export function TrendChart({ deviceId, deviceName, channelCount }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const [windowSec, setWindowSec] = useState<number>(300)
  const windowRef = useRef(windowSec)
  windowRef.current = windowSec
  const theme = useAppStore((s) => s.theme)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const colors = chartColors()
    const axis = axisStyle(colors)
    const plot = new uPlot(
      {
        width: el.clientWidth,
        height: 240,
        series: buildSeries(channelCount, colors),
        legend: { live: true },
        cursor: { y: false },
        scales: {
          x: { time: true },
          V: { auto: true, range: (_u, min, max) => [Math.min(0, min), Math.max(1, max * 1.1)] },
          A: { auto: true, range: (_u, min, max) => [Math.min(0, min), Math.max(0.5, max * 1.1)] }
        },
        axes: [
          { ...axis },
          { ...axis, scale: 'V', label: 'V', labelFont: '11px "IBM Plex Mono"' },
          {
            ...axis,
            scale: 'A',
            label: 'A',
            labelFont: '11px "IBM Plex Mono"',
            side: 1,
            grid: { show: false }
          }
        ]
      },
      [[], ...Array.from({ length: channelCount * 2 }, () => [] as number[])] as uPlot.AlignedData,
      el
    )
    plotRef.current = plot

    const refresh = (): void => {
      const h = getHistory(deviceId)
      if (h.timestamps.length === 0) return
      const cutoff = Date.now() - windowRef.current * 1000
      let start = h.timestamps.findIndex((t) => t >= cutoff)
      if (start < 0) start = h.timestamps.length - 1
      const xs = h.timestamps.slice(start).map((t) => t / 1000)
      const data: uPlot.AlignedData = [
        xs,
        ...h.channels.flatMap((c) => [c.voltage.slice(start), c.current.slice(start)])
      ] as uPlot.AlignedData
      plot.setData(data)
    }

    refresh()
    const timer = window.setInterval(refresh, 1000)

    const ro = new ResizeObserver(() => {
      plot.setSize({ width: el.clientWidth, height: 240 })
    })
    ro.observe(el)

    return () => {
      window.clearInterval(timer)
      ro.disconnect()
      plot.destroy()
      plotRef.current = null
    }
  }, [deviceId, channelCount, theme])

  const exportCsv = (): void => {
    const csv = toCsv(deviceId)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${deviceName.replace(/[^\p{L}\p{N}_-]+/gu, '_')}-trend.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="trend-section">
      <div className="trend-head">
        <span className="panel-label">{tr.chart.title}</span>
        <div className="window-picker">
          {WINDOWS.map((w) => (
            <button
              key={w.seconds}
              className={windowSec === w.seconds ? 'active' : ''}
              onClick={() => setWindowSec(w.seconds)}
            >
              {w.label}
            </button>
          ))}
        </div>
        <button className="btn ghost" onClick={exportCsv}>
          {tr.chart.exportCsv}
        </button>
      </div>
      <div className="trend-body" ref={containerRef} />
    </section>
  )
}
