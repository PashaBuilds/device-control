import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { tr } from '../../i18n/tr'
import { getHistory, toCsv } from '../../state/history'

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

// Kanal serisi renkleri: gerilim soğuk (camgöbeği), akım sıcak (amber);
// 2. kanal kesikli çizgiyle ayrışır.
const V_COLOR = '#5ec1f2'
const A_COLOR = '#f2b356'

function buildSeries(channelCount: number): uPlot.Series[] {
  const series: uPlot.Series[] = [{}]
  for (let ch = 1; ch <= channelCount; ch++) {
    series.push({
      label: tr.chart.voltage(ch),
      stroke: V_COLOR,
      width: 1.6,
      dash: ch === 2 ? [6, 4] : undefined,
      // yalnızca düz çizgili 1. kanal alan dolgusu alır — okunaklılık korunur
      fill: ch === 1 ? 'rgba(94, 193, 242, 0.07)' : undefined,
      scale: 'V',
      points: { show: false },
      value: (_u, v) => (v == null ? '—' : `${v.toFixed(2)} V`)
    })
    series.push({
      label: tr.chart.current(ch),
      stroke: A_COLOR,
      width: 1.6,
      dash: ch === 2 ? [6, 4] : undefined,
      fill: ch === 1 ? 'rgba(242, 179, 86, 0.055)' : undefined,
      scale: 'A',
      points: { show: false },
      value: (_u, v) => (v == null ? '—' : `${v.toFixed(2)} A`)
    })
  }
  return series
}

const AXIS_STYLE: Partial<uPlot.Axis> = {
  stroke: '#55637c',
  grid: { stroke: 'rgba(148, 170, 200, 0.07)', width: 1 },
  ticks: { stroke: 'rgba(148, 170, 200, 0.15)', width: 1 },
  font: '10.5px "IBM Plex Mono"'
}

export function TrendChart({ deviceId, deviceName, channelCount }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const [windowSec, setWindowSec] = useState<number>(300)
  const windowRef = useRef(windowSec)
  windowRef.current = windowSec

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const plot = new uPlot(
      {
        width: el.clientWidth,
        height: 240,
        series: buildSeries(channelCount),
        legend: { live: true },
        cursor: { y: false },
        scales: {
          x: { time: true },
          V: { auto: true, range: (_u, min, max) => [Math.min(0, min), Math.max(1, max * 1.1)] },
          A: { auto: true, range: (_u, min, max) => [Math.min(0, min), Math.max(0.5, max * 1.1)] }
        },
        axes: [
          { ...AXIS_STYLE },
          { ...AXIS_STYLE, scale: 'V', label: 'V', labelFont: '11px "IBM Plex Mono"' },
          {
            ...AXIS_STYLE,
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
  }, [deviceId, channelCount])

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
