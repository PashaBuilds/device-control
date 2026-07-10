/**
 * Uygulama ikonu üretimi: marka SVG'sini Electron (CDP) ile 512×512 PNG'ye
 * rasterize eder → build/icon.png. electron-builder Windows hedefi için
 * PNG'den .ico'yu otomatik üretir.
 *
 * Çalıştırma: npx tsx tools/icon/generate.ts
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import puppeteer, { type Browser } from 'puppeteer-core'

const ROOT = resolve(__dirname, '../..')
const OUT = join(ROOT, 'build')
const DEBUG_PORT = 9224

const SVG = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#16283e"/>
      <stop offset="1" stop-color="#0a111c"/>
    </linearGradient>
    <linearGradient id="pulse" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#5ec1f2"/>
      <stop offset="1" stop-color="#43dd9a"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="none" stroke="#3d5a80" stroke-width="6" opacity="0.55"/>
  <path d="M96 256h64l40-96 64 192 40-96h112" fill="none" stroke="url(#pulse)"
        stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="416" cy="256" r="17" fill="#f2b356"/>
</svg>`

const HTML = `<!doctype html><html><body style="margin:0;background:transparent">${SVG}</body></html>`

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const htmlPath = join(OUT, '.icon-src.html')
  writeFileSync(htmlPath, HTML)

  const electronBin = join(ROOT, 'node_modules/.bin/electron')
  // Boş bir pencerede ikon HTML'ini aç
  const bootstrap = join(OUT, '.icon-main.cjs')
  writeFileSync(
    bootstrap,
    `const { app, BrowserWindow } = require('electron')
app.whenReady().then(() => {
  const w = new BrowserWindow({ width: 600, height: 600, show: false, webPreferences: { offscreen: true } })
  w.loadFile(${JSON.stringify(htmlPath)})
})
`
  )
  const proc = spawn(electronBin, [bootstrap, `--remote-debugging-port=${DEBUG_PORT}`], {
    stdio: 'ignore'
  })

  let browser: Browser | null = null
  try {
    for (let i = 0; i < 40 && !browser; i++) {
      try {
        browser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${DEBUG_PORT}`,
          defaultViewport: { width: 600, height: 600 }
        })
      } catch {
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    if (!browser) throw new Error('CDP bağlantısı kurulamadı')
    const pages = await browser.pages()
    const page = pages.find((p) => p.url().includes('.icon-src')) ?? pages[0]
    await page.waitForSelector('svg')
    const el = await page.$('svg')
    await el!.screenshot({ path: join(OUT, 'icon.png') as `${string}.png`, omitBackground: true })
    console.log('build/icon.png üretildi (512×512, saydam arka plan)')
  } finally {
    browser?.disconnect()
    proc.kill('SIGTERM')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
