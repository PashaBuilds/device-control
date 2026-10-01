# Hızlı Taşınabilir Exe + Karma Palet — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Taşınabilir exe'nin açılışını 4 s'den <1 s'ye indirmek (sürüm başına tek seferlik açma) ve arayüze Spec2Code esintili, AA kontrastlı "Karma" paleti uygulamak.

**Architecture:** (1) Paket yükü küçültülür (tek dil, asar'da tekrar eden node_modules yok). electron-builder'ın her açılışta açıp silen portable hedefi yerine, kendi NSIS başlatıcımız `win-unpacked`'i `%LOCALAPPDATA%\CihazKontrol\app-<BUILD_ID>`'ye bir kez açar ve sonra doğrudan başlatır. (2) Renkler `global.css`'teki iki tema bloğunda token olarak tanımlanır; kural gövdeleri ve trend grafiği yalnız tokenları kullanır; bir test kontrastı ve eski sabit renklerin yokluğunu denetler.

**Tech Stack:** Electron 43, electron-vite, electron-builder 26 (NSIS), NSIS 3.0.4 (makensis, electron-builder önbelleğinden), React 19, uPlot, vitest, puppeteer-core.

**Spec:** `docs/superpowers/specs/2026-10-01-hizli-portable-ve-palet-design.md`

## Global Constraints

- İşlev kaybı yok: 115 test + 23 adımlı e2e yeşil kalır; kullanıcı verisi yeri değişmez.
- Tek dil: `electronLanguages: ['tr']` + `app.commandLine.appendSwitch('lang', 'tr')`.
- Önbellek yolu `%LOCALAPPDATA%\CihazKontrol\app-<BUILD_ID>`, `BUILD_ID = <sürüm>-<sha256(app.asar) ilk 10 hane>`; ACL `*S-1-15-2-1:(OI)(CI)(RX)`; sıkıştırma `zlib`; çıktı adı `CihazKontrol-<sürüm>-portable.exe`.
- Palet tokenları spec tablosundaki değerler; metin tokenları AA ≥ 4,5 (`--text-3` ≥ 3) — `tests/palette.test.ts` belirler, açık tema değerleri teste göre ayarlanabilir.
- Commit'ler Türkçe, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Sürüm `0.9.0` → `0.10.0`; release `Cihaz Kontrol v0.10.0 — Hızlı açılış + yeni palet`.

---

### Task 1: Paket yükünü küçült

**Files:** `package.json`, `electron-builder.yml`, `src/main/index.ts`

- [ ] **Step 1:** `package.json`: `dependencies` içindeki tüm paketleri (`@fontsource/*`, `react`, `react-dom`, `uplot`, `zustand`) `devDependencies`'e taşı (alfabetik), `dependencies` anahtarını kaldır. `npm install` ile lock'u güncelle.
- [ ] **Step 2:** `electron-builder.yml` üst düzeye:

```yaml
# Yalnız Türkçe arayüz: diğer Chromium dil paketleri (~46 MB) pakete girmez
electronLanguages:
  - tr
```

- [ ] **Step 3:** `src/main/index.ts` import'lardan hemen sonra:

```ts
// Paket yalnız tr.pak içerir: sistem dili ne olursa olsun Chromium Türkçe yerel ayarı kullansın
app.commandLine.appendSwitch('lang', 'tr')
```

- [ ] **Step 4: Doğrula:** `npm test && npm run typecheck && npm run build && npm run e2e` → hepsi yeşil. `npx electron-builder --win dir --x64` → `release/win-unpacked/locales` yalnız `tr.pak`, `resources/app.asar` < 3 MB.
- [ ] **Step 5: Commit** — `perf(paket): tek dil, asar'da tekrar eden node_modules yok`

---

### Task 2: Önbellekli taşınabilir başlatıcı

**Files:**
- Create: `build/portable/portable.nsi`, `tools/build-portable.mjs`, `build/icon.ico`
- Modify: `electron-builder.yml` (portable hedefi kaldırılır), `package.json` (`dist:win`)
- Test: `tests/build-portable.test.ts`

**Interfaces:** `tools/build-portable.mjs` dışa aktarır: `computeBuildId(version: string, asar: Buffer): string`, `versionQuad(version: string): string`, `findMakensis(cacheRoot: string): string`, `buildPortable(opts?): string` (çıktı yolu).

- [ ] **Step 1: Başarısız test** — `tests/build-portable.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeBuildId, findMakensis, versionQuad } from '../tools/build-portable.mjs'

describe('build-portable yardımcıları', () => {
  it('BUILD_ID sürüm + içerik özetinden belirlenir', () => {
    const a = computeBuildId('0.10.0', Buffer.from('asar-a'))
    expect(a).toMatch(/^0\.10\.0-[0-9a-f]{10}$/)
    expect(computeBuildId('0.10.0', Buffer.from('asar-a'))).toBe(a)
    expect(computeBuildId('0.10.0', Buffer.from('asar-b'))).not.toBe(a)
  })

  it('sürüm dört parçalı Windows sürümüne çevrilir', () => {
    expect(versionQuad('0.10.0')).toBe('0.10.0.0')
    expect(versionQuad('1.2.3-beta.1')).toBe('1.2.3.0')
  })

  it("makensis electron-builder önbelleğinde bulunur (en yeni sürüm)", () => {
    const root = mkdtempSync(join(tmpdir(), 'ebcache-'))
    for (const v of ['nsis-3.0.4.1', 'nsis-3.0.5.0']) {
      mkdirSync(join(root, 'nsis', v, 'Bin'), { recursive: true })
      writeFileSync(join(root, 'nsis', v, 'Bin', 'makensis.exe'), '')
    }
    expect(findMakensis(root)).toBe(join(root, 'nsis', 'nsis-3.0.5.0', 'Bin', 'makensis.exe'))
  })

  it('makensis yoksa anlaşılır hata verir', () => {
    expect(() => findMakensis(mkdtempSync(join(tmpdir(), 'ebcache-')))).toThrow(/makensis/)
  })
})
```

- [ ] **Step 2:** `npx vitest run tests/build-portable.test.ts` → FAIL (modül yok).

- [ ] **Step 3: Betik** — `tools/build-portable.mjs`:

```js
/**
 * Önbellekli taşınabilir exe üretir.
 *
 * electron-builder'ın portable hedefi her açılışta ~320 MB'ı %TEMP%'e açıp
 * kapanışta siler (açılış ~4 s). Bu betik release/win-unpacked'i kendi NSIS
 * başlatıcımızla (build/portable/portable.nsi) paketler: dosyalar
 * %LOCALAPPDATA%\CihazKontrol\app-<BUILD_ID>'ye sürüm başına bir kez açılır,
 * sonraki açılışlar doğrudan başlar (~0,8 s).
 *
 * Çalıştırma: electron-builder --win nsis sonrası `node tools/build-portable.mjs`
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

export function computeBuildId(version, asar) {
  return `${version}-${createHash('sha256').update(asar).digest('hex').slice(0, 10)}`
}

export function versionQuad(version) {
  const [a = 0, b = 0, c = 0] = version.split('-')[0].split('.').map(Number)
  return `${a}.${b}.${c}.0`
}

export function findMakensis(cacheRoot) {
  const nsisDir = join(cacheRoot, 'nsis')
  const versions = existsSync(nsisDir)
    ? readdirSync(nsisDir)
        .filter((d) => /^nsis-\d/.test(d) && existsSync(join(nsisDir, d, 'Bin', 'makensis.exe')))
        .sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))
    : []
  if (versions.length === 0) {
    throw new Error(
      `makensis bulunamadı (${nsisDir}). Önce "electron-builder --win nsis" çalıştırın; NSIS'i o indirir.`
    )
  }
  return join(nsisDir, versions[versions.length - 1], 'Bin', 'makensis.exe')
}

function defaultCacheRoot() {
  if (process.env.ELECTRON_BUILDER_CACHE) return process.env.ELECTRON_BUILDER_CACHE
  return join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache')
}

export function buildPortable({
  root = ROOT,
  appDir = join(root, 'release', 'win-unpacked'),
  cacheRoot = defaultCacheRoot()
} = {}) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const asarPath = join(appDir, 'resources', 'app.asar')
  if (!existsSync(asarPath)) throw new Error(`Paketlenmiş uygulama yok: ${asarPath}`)
  const buildId = computeBuildId(pkg.version, readFileSync(asarPath))
  const outFile = join(root, 'release', `CihazKontrol-${pkg.version}-portable.exe`)
  const defines = {
    PRODUCT_NAME: 'Cihaz Kontrol',
    APP_EXE: 'Cihaz Kontrol.exe',
    APP_DIR: appDir,
    OUT_FILE: outFile,
    ICON: join(root, 'build', 'icon.ico'),
    BUILD_ID: buildId,
    VERSION: pkg.version,
    VERSION_QUAD: versionQuad(pkg.version),
    COPYRIGHT: '© 2026 Mert Cukur'
  }
  const args = ['-V2', ...Object.entries(defines).map(([k, v]) => `-D${k}=${v}`), join(root, 'build', 'portable', 'portable.nsi')]
  execFileSync(findMakensis(cacheRoot), args, { stdio: 'inherit' })
  console.log(`Taşınabilir exe: ${outFile} (BUILD_ID ${buildId})`)
  return outFile
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildPortable()
}
```

- [ ] **Step 4: NSIS betiği** — `build/portable/portable.nsi`:

```nsis
; Cihaz Kontrol — önbellekli taşınabilir başlatıcı (tools/build-portable.mjs derler)
; Dosyalar %LOCALAPPDATA%\CihazKontrol\app-<BUILD_ID>'ye sürüm başına bir kez açılır.
Unicode true
!include "LogicLib.nsh"
!include "FileFunc.nsh"

Name "${PRODUCT_NAME}"
OutFile "${OUT_FILE}"
Icon "${ICON}"
RequestExecutionLevel user
CRCCheck off
SetCompressor zlib
AutoCloseWindow true
ShowInstDetails nevershow
BrandingText " "

VIProductVersion "${VERSION_QUAD}"
VIAddVersionKey "ProductName" "${PRODUCT_NAME}"
VIAddVersionKey "FileDescription" "${PRODUCT_NAME}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "${COPYRIGHT}"

!define CACHE_ROOT "$LOCALAPPDATA\CihazKontrol"
!define APP_PATH "${CACHE_ROOT}\app-${BUILD_ID}"

Function .onInit
  ; Önbellek hazırsa hiçbir pencere gösterme
  ${If} ${FileExists} "${APP_PATH}\.ready"
  ${AndIf} ${FileExists} "${APP_PATH}\${APP_EXE}"
  ${AndIf} ${FileExists} "${APP_PATH}\resources\app.asar"
    SetSilent silent
  ${EndIf}
FunctionEnd

Function CleanupOld
  FindFirst $1 $2 "${CACHE_ROOT}\app-*"
  loop:
    StrCmp $2 "" done
    StrCmp $2 "app-${BUILD_ID}" next
    RMDir /r "${CACHE_ROOT}\$2" ; kullanımdaysa kalan dosyalar sessizce atlanır
  next:
    FindNext $1 $2
    Goto loop
  done:
  FindClose $1
FunctionEnd

Section
  HideWindow
  ${IfNot} ${FileExists} "${APP_PATH}\.ready"
    ; Eşzamanlı ilk açılışlar birbirinin yarım klasörünü silmesin
    System::Call 'kernel32::CreateMutex(p 0, i 0, t "CihazKontrol-Portable-${BUILD_ID}") p .r8'
    System::Call 'kernel32::WaitForSingleObject(p r8, i -1) i .r9'
    ${IfNot} ${FileExists} "${APP_PATH}\.ready"
      Banner::show /NOUNLOAD "Cihaz Kontrol ilk kez hazırlanıyor…"
      RMDir /r "${APP_PATH}"
      RMDir /r "${APP_PATH}.tmp"
      CreateDirectory "${APP_PATH}.tmp"
      ; Electron 43 sandbox'ı kurulum klasöründe "ALL APPLICATION PACKAGES" okuma izni ister
      nsExec::Exec 'icacls "${APP_PATH}.tmp" /grant *S-1-15-2-1:(OI)(CI)(RX) /Q'
      Pop $0
      SetOutPath "${APP_PATH}.tmp"
      File /r "${APP_DIR}\*.*"
      SetOutPath "${CACHE_ROOT}"
      Rename "${APP_PATH}.tmp" "${APP_PATH}"
      FileOpen $0 "${APP_PATH}\.ready" w
      FileWrite $0 "${BUILD_ID}"
      FileClose $0
      Call CleanupOld
      Banner::destroy
    ${EndIf}
    System::Call 'kernel32::ReleaseMutex(p r8)'
    System::Call 'kernel32::CloseHandle(p r8)'
  ${EndIf}

  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${PRODUCT_NAME}").r0'
  ${GetParameters} $R0
  SetOutPath "${APP_PATH}"
  Exec '"${APP_PATH}\${APP_EXE}" $R0'
SectionEnd
```

- [ ] **Step 5: İkon** — `node_modules/app-builder-bin/win/x64/app-builder.exe icon --format ico --root build --input icon.png --out build/ico-tmp` ile üret, çıkan `.ico`'yu `build/icon.ico` olarak kopyala (commit'lenir; ayrıca `win.icon` değişmez).
- [ ] **Step 6: Derleme hattı** — `electron-builder.yml`: `win.target`'tan `portable` girdisini ve `portable:` bölümünü kaldır (yerine yorum: "Taşınabilir exe tools/build-portable.mjs ile üretilir"). `package.json`: `"dist:win": "electron-vite build && electron-builder --win nsis --x64 && node tools/build-portable.mjs"`.
- [ ] **Step 7: Doğrula** — `npx vitest run tests/build-portable.test.ts` PASS; `npm run dist:win` → `release/` altında Setup, blockmap, portable exe. Önbelleği silip ölç: ilk açılış ≤ 7 s (Banner görünür), sonraki 3 açılış ≤ 1 s; `%LOCALAPPDATA%\CihazKontrol` altında tek `app-<id>` var; eski bir `app-eski` klasörü oluşturup yeniden açınca silindiğini gör; komut satırı parametresi (`--remote-debugging-port=9333`) aktarılıyor (CDP'ye bağlanılabiliyor).
- [ ] **Step 8: Commit** — `perf(portable): önbellekli taşınabilir başlatıcı (açılış 4 s → 0,8 s)`

---

### Task 3: Palet tokenları + kontrast testi

**Files:** `src/renderer/src/styles/global.css` (`:root` 7–53, `:root[data-theme='light']` 1489–1519), Test: `tests/palette.test.ts`

- [ ] **Step 1: Başarısız test** — `tests/palette.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = readFileSync(join(__dirname, '../src/renderer/src/styles/global.css'), 'utf8')

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
const over = (fg: RGBA, bg: RGBA): RGBA => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1) as RGBA
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

const THEMES = { koyu: block(':root'), açık: { ...block(':root'), ...block(":root[data-theme='light']") } }
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
  const LEGACY = ['94, 193, 242', '242, 179, 86', '67, 221, 154', '255, 93, 93', '60, 90, 130',
    '31, 143, 208', '18, 153, 106', '190, 122, 20', '214, 61, 61', '#5ec1f2', '#f2b356', '#43dd9a',
    '#ff5d5d', '#1f8fd0', '#b32d2d', '#14263a', '#0d1826', '#9cc8e8']
  it.each(LEGACY)('%s global.css ve TrendChart.tsx içinde geçmez', (c) => {
    const chart = readFileSync(join(__dirname, '../src/renderer/src/components/psu/TrendChart.tsx'), 'utf8')
    expect(CSS.toLowerCase()).not.toContain(c)
    expect(chart.toLowerCase()).not.toContain(c)
  })
})
```

- [ ] **Step 2:** Çalıştır → kontrast ve kalıntı testleri FAIL (eski palet).
- [ ] **Step 3: Token blokları** — `:root` renk tokenlarını spec tablosundaki koyu değerlerle değiştir; `--probe: #a98bff` ekle; `*-dim`/`--glow-*`'ı türet:

```css
  --volt-dim: color-mix(in srgb, var(--volt) 14%, transparent);
  --amp-dim: color-mix(in srgb, var(--amp) 14%, transparent);
  --ok-dim: color-mix(in srgb, var(--ok) 12%, transparent);
  --danger-dim: color-mix(in srgb, var(--danger) 12%, transparent);
  --accent-dim: color-mix(in srgb, var(--accent) 14%, transparent);
  --probe-dim: color-mix(in srgb, var(--probe) 14%, transparent);
  --glow-volt: color-mix(in srgb, var(--volt) 55%, transparent);
  --glow-ok: color-mix(in srgb, var(--ok) 50%, transparent);
  --glow-amp: color-mix(in srgb, var(--amp) 55%, transparent);
  --glow-danger: color-mix(in srgb, var(--danger) 55%, transparent);
  --glow-accent: color-mix(in srgb, var(--accent) 50%, transparent);
```

`:root[data-theme='light']` bloğunda açık değerler (dim %12, glow %28 ile aynı türetme). Kontrast testi geçene kadar yalnız açık tema metin/veri renklerini koyulaştır (ton sabit).
- [ ] **Step 4:** `npx vitest run tests/palette.test.ts` → kontrast testleri PASS (kalıntı testleri Task 4'te geçer).
- [ ] **Step 5: Commit** — `style(palet): Karma palet tokenları + AA kontrast testi`

---

### Task 4: Kural gövdelerini tokenlara bağla + atmosfer + bakır vurgu

**Files:** `src/renderer/src/styles/global.css`

Eşleme kuralları (her sabit renk için):

| Eski | Yeni |
|---|---|
| `rgba(94,193,242,a)` (volt) | `color-mix(in srgb, var(--volt) <a×100>%, transparent)` |
| `rgba(242,179,86,a)` (amp) | `color-mix(... var(--amp) ...)` |
| `rgba(67,221,154,a)` / `rgba(18,153,106,a)` | `... var(--ok) ...` |
| `rgba(255,93,93,a)` / `rgba(214,61,61,a)` / `#b32d2d` | `... var(--danger) ...` / `var(--danger)` |
| `rgba(31,143,208,a)` / `rgba(190,122,20,a)` | `... var(--volt) ...` / `... var(--amp) ...` |
| `rgba(60,90,130,a)` (açık tema kenar) | `var(--line)` (a ≥ .15 ise `var(--line-strong)`) |
| logo `#14263a→#0d1826`, açık `#eaf3fb→#dbe8f5` | `color-mix(var(--accent) 22%, var(--bg-raised))` → `var(--bg-inset)` |
| marka adı degradesi `#e8edf5→#9cc8e8`, açık `#16202e→#1f6f9e` | `var(--text-1)` → `var(--accent)` |
| atmosfer `rgba(38,88,140,.22)`, `rgba(28,108,96,.14)`, `rgba(58,78,128,.07)` | bakır %10 (sağ üst), volt %8 (sol alt), probe %5 (orta) |
| aurora volt %5 / ok %3,5 | volt %5 / accent %4 |

- [ ] **Step 1:** `.btn.primary` bakır: `background: var(--accent-dim); border-color: color-mix(in srgb, var(--accent) 45%, transparent); color: var(--accent);` hover `color-mix(... var(--accent) 22%, transparent)`. Seçili kenar çubuğu öğesi ve odak (`--line-focus`) bakır. Prob/JTAG görünümünde (`.jtag-*`, `.chip.target`, probe paneli) volt vurguları `--probe`'a.
- [ ] **Step 2:** Tablodaki eşlemeleri uygula; siyah/beyaz gölge ve parlama katmanları (`rgba(0,0,0,a)`, `rgba(255,255,255,a)`) kalabilir.
- [ ] **Step 3:** `npx vitest run tests/palette.test.ts` → kalıntı testleri hâlâ yalnız `TrendChart.tsx` yüzünden FAIL olabilir (Task 5). `npm run typecheck`.
- [ ] **Step 4: Commit** — `style(palet): kural gövdeleri tokenlara bağlandı, bakır vurgu ve yeni atmosfer`

---

### Task 5: Trend grafiği tokenları + pencere zemini

**Files:** `src/renderer/src/components/psu/TrendChart.tsx`, `src/main/index.ts`

- [ ] **Step 1:** `TrendChart.tsx`: sabit renkleri kaldır; tokenlardan oku ve tema değişince grafiği yeniden kur:

```ts
import { useAppStore } from '../../state/store'

/** Tema tokenlarını o anki belge kökünden okur (grafik tema değişince yeniden kurulur). */
function chartColors(): { volt: string; amp: string; axis: string; grid: string; tick: string } {
  const css = getComputedStyle(document.documentElement)
  const v = (n: string): string => css.getPropertyValue(n).trim()
  return { volt: v('--volt'), amp: v('--amp'), axis: v('--text-3'), grid: v('--line'), tick: v('--line-strong') }
}
```

`buildSeries(channelCount, c)` → `stroke: c.volt` / `c.amp`; dolgu `color-mix(in srgb, ${c.volt} 8%, transparent)` yerine uPlot canvas'ın anlayacağı biçim: hex'ten alfa ekle — yardımcı `withAlpha(hex, a)` (`#rrggbb` → `rgba(r,g,b,a)`). `AXIS_STYLE` → `axisStyle(c)` (`stroke: c.axis`, grid `withAlpha(c.grid, 0.6)`, ticks `c.tick`). `const theme = useAppStore((s) => s.theme)`; `useEffect` bağımlılıklarına `theme` ekle.
- [ ] **Step 2:** `src/main/index.ts`: `backgroundColor: '#0a0d12'`.
- [ ] **Step 3:** `npm test && npm run typecheck` → hepsi PASS (palet testi dahil).
- [ ] **Step 4: Commit** — `style(grafik): trend renkleri tema tokenlarından, pencere zemini yeni palette`

---

### Task 6: Görsel doğrulama, sürüm, release

- [ ] **Step 1:** `npm run build && npm run e2e` → 23/23. `.data/e2e-shots` görüntülerini koyu temada incele; açık tema için e2e sonunda `localStorage['ui-theme']='light'` ile yeniden yükleyip `09-acik-tema` görüntüsü alan adımı ekle ve incele (okunabilirlik, kontrast, örtüşme yok).
- [ ] **Step 2:** README: özellikler listesinde tema maddesine yeni palet; "Windows paketi" bölümüne taşınabilir exe'nin önbellek davranışı (`%LOCALAPPDATA%\CihazKontrol`, sürüm başına ilk açılış, eski sürümler otomatik silinir).
- [ ] **Step 3:** `package.json` `0.10.0`, lock güncelle; `npm test`, `typecheck`, `npm audit` (0).
- [ ] **Step 4:** Commit, `main`'e `--no-ff` merge, `v0.10.0` etiketi, push.
- [ ] **Step 5:** `npm run dist:win`; portable exe ile önbellek temizken ve doluyken açılışı ölç; uygulama içinde cihaza bağlanma kontrolü (e2e zaten win-unpacked ile değil out/ ile koşar — paketlenmiş exe'yi `--remote-debugging-port` ile açıp arayüzün yüklendiğini CDP'den doğrula).
- [ ] **Step 6:** `release/notes-0.10.0.md` + `gh release create v0.10.0` (Setup, blockmap, portable).
