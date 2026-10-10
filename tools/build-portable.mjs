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
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** Sürüm + app.asar özeti: aynı sürüm yeniden derlenirse de önbellek tazelenir. */
export function computeBuildId(version, asar) {
  return `${version}-${createHash('sha256').update(asar).digest('hex').slice(0, 10)}`
}

/** "0.10.0" / "1.2.3-beta.1" → Windows dosya sürümü "a.b.c.0". */
export function versionQuad(version) {
  const [a = 0, b = 0, c = 0] = version.split('-')[0].split('.').map(Number)
  return `${a}.${b}.${c}.0`
}

/**
 * NSIS derleyicisini electron-builder'ın kendi çözümleyicisiyle bulur (NSIS hedefinin
 * kullandığı aynı paket; önbellekte yoksa indirir). Önbellek klasör düzeni sürümden
 * sürüme değiştiği için (ör. `nsis/nsis-3.0.4.1/` → `nsis-3.0.4.1/nsis-3.0.4.1-<özet>/`)
 * yol tahmin edilmez; çözümleyici kullanılamazsa eski düzende aranır.
 * Dönüş: { path, env } — env, makensis'e verilecek NSISDIR gibi değişkenler.
 */
export async function resolveMakensis(cacheRoot, loadToolset = defaultToolsetLoader) {
  try {
    const { getMakeNsisPath } = loadToolset()
    const found = await getMakeNsisPath()
    if (found?.path && existsSync(found.path)) return { path: found.path, env: found.env ?? {} }
  } catch {
    // çözümleyici yok/değişmiş: eski önbellek düzenine düş
  }
  return { path: findMakensis(cacheRoot), env: {} }
}

function defaultToolsetLoader() {
  return createRequire(import.meta.url)('app-builder-lib/out/toolsets/windows.js')
}

/** electron-builder önbelleğindeki (eski düzen) en yeni makensis.exe. */
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

/**
 * makensis argümanları. Betik UTF-8 ve BOM'suz; NSIS bu durumda onu Windows kod
 * sayfasıyla (ACP) okur ve Türkçe metinler bozulur ("hazÄ±rlanÄ±yor"), bu yüzden
 * girdi kodlaması açıkça UTF-8 verilir.
 */
export function makensisArgs(defines, scriptPath) {
  return [
    '-V2',
    '-INPUTCHARSET',
    'UTF8',
    ...Object.entries(defines).map(([k, v]) => `-D${k}=${v}`),
    scriptPath
  ]
}

function defaultCacheRoot() {
  if (process.env.ELECTRON_BUILDER_CACHE) return process.env.ELECTRON_BUILDER_CACHE
  return join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache')
}

export async function buildPortable({
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
  const args = makensisArgs(defines, join(root, 'build', 'portable', 'portable.nsi'))
  const makensis = await resolveMakensis(cacheRoot)
  execFileSync(makensis.path, args, { stdio: 'inherit', env: { ...process.env, ...makensis.env } })
  console.log(`Taşınabilir exe: ${outFile} (BUILD_ID ${buildId})`)
  return outFile
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildPortable().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
