import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(__dirname, '../src/renderer/src/styles/global.css'), 'utf8')
const CHART = readFileSync(join(__dirname, '../src/renderer/src/components/psu/TrendChart.tsx'), 'utf8')

/** Seçicinin ilk bloğundaki `--token: değer;` çiftleri. */
function block(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`blok yok: ${selector}`)
  const body = CSS.slice(start, CSS.indexOf('}', start))
  const vars: Record<string, string> = {}
  for (const m of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim()
  return vars
}

type RGBA = [number, number, number, number]
function parse(c: string): RGBA {
  let m = c.match(/^#([0-9a-f]{6})$/i)
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)).concat(1) as RGBA
  m = c.match(/^rgba?\(([^)]+)\)$/)
  if (m) {
    const p = m[1].split(',').map((s) => Number(s.trim()))
    return [p[0], p[1], p[2], p[3] ?? 1]
  }
  throw new Error(`renk ayrıştırılamadı: ${c}`)
}
const over = (fg: RGBA, bg: RGBA): RGBA =>
  [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1) as RGBA
const lum = (c: RGBA): number => {
  const [r, g, b] = c.slice(0, 3).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: RGBA, b: RGBA): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

const THEMES: Record<string, Record<string, string>> = {
  koyu: block(':root'),
  açık: { ...block(':root'), ...block(":root[data-theme='light']") }
}
const TEXT_TOKENS = ['text-1', 'text-2', 'volt', 'amp', 'ok', 'danger', 'accent', 'probe']

describe.each(Object.entries(THEMES))('%s tema', (_name, t) => {
  const app = parse(t['bg-app'])
  const surfaces = [app, over(parse(t['bg-panel']), app), over(parse(t['bg-raised']), app)]

  it.each(TEXT_TOKENS)('--%s tüm yüzeylerde ≥ 4.5:1', (tok) => {
    for (const s of surfaces) expect(contrast(parse(t[tok]), s)).toBeGreaterThanOrEqual(4.5)
  })

  it('--text-3 (ipucu) ≥ 3:1', () => {
    for (const s of surfaces) expect(contrast(parse(t['text-3']), s)).toBeGreaterThanOrEqual(3)
  })
})

describe('eski palet kalıntısı yok', () => {
  const LEGACY = [
    '94, 193, 242', '242, 179, 86', '67, 221, 154', '255, 93, 93', '60, 90, 130',
    '31, 143, 208', '18, 153, 106', '190, 122, 20', '214, 61, 61', '#5ec1f2', '#f2b356',
    '#43dd9a', '#ff5d5d', '#1f8fd0', '#b32d2d', '#14263a', '#0d1826', '#9cc8e8'
  ]
  it.each(LEGACY)('%s global.css ve TrendChart.tsx içinde geçmez', (c) => {
    expect(CSS.toLowerCase()).not.toContain(c)
    expect(CHART.toLowerCase()).not.toContain(c)
  })
})
