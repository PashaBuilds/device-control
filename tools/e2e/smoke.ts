/// <reference lib="dom" />
/**
 * Uçtan uca duman testi: gerçek Electron uygulaması + gerçek TCP simülatörleri.
 * (DOM lib referansı: page.evaluate callback'leri tarayıcı bağlamında koşar.)
 *
 * Akış:
 *  1. İki CPX400DP simülatörü başlat (9221, 9222)
 *  2. Derlenmiş Electron uygulamasını remote-debugging ile aç
 *  3. CDP üzerinden arayüzü sür: cihaz ekle → bağlan → ölçüm doğrula →
 *     ikinci cihaz → simülatörü öldür → yeniden bağlanma → geri gel
 *  4. Her adımda ekran görüntüsü kaydet
 *
 * Çalıştırma: npm run build && npx tsx tools/e2e/smoke.ts
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import puppeteer, { type Browser, type Page } from 'puppeteer-core'
import { startCpx400dpSim, type SimHandle } from '../simulator/cpx400dp-sim'
import { startSmartLynqSim, type SmartLynqSimHandle } from '../simulator/smartlynq-sim'

const ROOT = resolve(__dirname, '../..')
const SHOTS = process.env.E2E_SHOTS_DIR || join(ROOT, '.data/e2e-shots')
const DEBUG_PORT = 9223

function fail(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exitCode = 1
  throw new Error(msg)
}

function ok(msg: string): void {
  console.log(`✓ ${msg}`)
}

async function waitForText(page: Page, text: string, timeoutMs = 15000): Promise<void> {
  await page.waitForFunction(
    (t: string) => document.body.innerText.includes(t),
    { timeout: timeoutMs },
    text
  )
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) as `${string}.png` })
}

async function addDevice(page: Page, name: string, port: number, kind = 'cpx400dp'): Promise<void> {
  // Doğru kategorinin "Cihaz Ekle" düğmesini kullan (birden fazla olabilir)
  const addBtn = await page.waitForSelector('.add-device, .empty-state .btn.primary')
  await addBtn!.click()
  await page.waitForSelector('.dialog')
  await page.select('#dev-type', kind)
  await page.type('#dev-name', name)
  await page.type('#dev-host', '127.0.0.1')
  await page.evaluate(() => {
    document.querySelector<HTMLInputElement>('#dev-port')?.select()
  })
  await page.type('#dev-port', String(port))
  // DOM-level tıklama: atmosferik overlay katmanları koordinat tıklamasını ıskalatabiliyor
  await page.evaluate(() =>
    document.querySelector<HTMLButtonElement>('.dialog-foot .btn.primary')?.click()
  )
  await waitForText(page, name)
}

async function main(): Promise<void> {
  mkdirSync(SHOTS, { recursive: true })
  const dataDir = mkdtempSync(join(tmpdir(), 'dc-e2e-'))
  let sim1: SimHandle | null = await startCpx400dpSim(9221)
  const sim2 = await startCpx400dpSim(9222)
  const lynq: SmartLynqSimHandle = await startSmartLynqSim(3121)
  sim1.sim.channels[0].loadOhms = 5 // 10V/5Ω = 2A

  const electronBin = join(ROOT, 'node_modules/.bin/electron')
  const app: ChildProcess = spawn(electronBin, [ROOT, `--remote-debugging-port=${DEBUG_PORT}`], {
    env: { ...process.env, DC_DATA_DIR: dataDir },
    stdio: 'pipe'
  })
  app.stderr?.on('data', (d) => process.env.E2E_VERBOSE && console.error(`[app] ${d}`))

  let browser: Browser | null = null
  try {
    // CDP hazır olana dek dene
    for (let i = 0; i < 40 && !browser; i++) {
      try {
        browser = await puppeteer.connect({
          browserURL: `http://127.0.0.1:${DEBUG_PORT}`,
          defaultViewport: null
        })
      } catch {
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    if (!browser) fail('CDP bağlantısı kurulamadı')
    ok('Electron uygulamasına CDP ile bağlanıldı')

    const pages = await browser.pages()
    const page = pages.find((p) => p.url().includes('index.html')) ?? pages[0]
    if (!page) fail('Uygulama sayfası bulunamadı')

    // Animasyonları kapat: otomasyon tıklamaları hareketli öğeyi ıskalamasın
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])

    await waitForText(page, 'CİHAZ KONTROL')
    ok('Arayüz yüklendi (boş durum)')
    await shot(page, '01-bos-durum')

    // 1. cihaz: ekle + bağlan
    await addDevice(page, 'Sim PSU 1', 9221)
    ok('Cihaz 1 eklendi')
    const connectBtn = await page.waitForSelector('.topbar .btn.primary')
    await connectBtn!.click()
    await waitForText(page, 'THURLBY THANDAR, CPX400DP')
    ok('Cihaz 1 bağlandı, kimlik doğrulandı')

    // Setpoint + çıkış: 10V / 3A → 5Ω yükte 10V, 2A
    await page.evaluate(async () => {
      const api = (window as unknown as { deviceApi: import('../../src/shared/ipc').DeviceApi })
        .deviceApi
      const devs = await api.listDevices()
      await api.setVoltage(devs[0].id, 1, 10)
      await api.setCurrent(devs[0].id, 1, 3)
      await api.setOutput(devs[0].id, 1, true)
    })
    await waitForText(page, '10.00', 10000)
    await waitForText(page, '2.00', 10000)
    ok('Ölçümler doğru: 10.00V / 2.00A (5Ω yük modeli)')
    await shot(page, '02-cihaz1-acik')

    // 2. cihaz: eşzamanlı bağlantı
    await addDevice(page, 'Sim PSU 2', 9222)
    const connectBtn2 = await page.waitForSelector('.topbar .btn.primary')
    await connectBtn2!.click()
    await waitForText(page, 'THURLBY THANDAR, CPX400DP')
    ok('Cihaz 2 eşzamanlı bağlandı')
    await shot(page, '03-iki-cihaz')

    // Kenar çubuğunda iki yeşil LED
    const ledCount = await page.evaluate(() => document.querySelectorAll('.sidebar .led.on').length)
    if (ledCount !== 2) fail(`2 bağlı LED bekleniyordu, ${ledCount} bulundu`)
    ok('Kenar çubuğunda 2 cihaz da bağlı görünüyor')

    // Cihaz 1'e dön, simülatörü öldür → yeniden bağlanma
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLButtonElement>('.device-row')]
      rows.find((r) => r.textContent?.includes('Sim PSU 1'))?.click()
    })
    await sim1.close()
    sim1 = null
    await waitForText(page, 'Yeniden bağlanıyor', 20000)
    ok('Bağlantı kopunca "Yeniden bağlanıyor" durumuna geçti')
    await shot(page, '04-yeniden-baglaniyor')

    sim1 = await startCpx400dpSim(9221)
    await waitForText(page, 'THURLBY THANDAR, CPX400DP', 30000)
    ok('Simülatör dönünce otomatik yeniden bağlandı')
    await shot(page, '05-geri-geldi')

    // SmartLynq (TCF) probu ekle + bağlan + probe bilgisi doğrula
    await addDevice(page, 'Lynq Probe', 3121, 'smartlynq')
    ok('SmartLynq probu eklendi')
    const lynqConnect = await page.waitForSelector('.topbar .btn.primary')
    await lynqConnect!.click()
    await waitForText(page, 'Xilinx hw_server', 15000)
    await waitForText(page, 'xc7z045', 15000)
    ok('SmartLynq bağlandı — agent + JTAG hedefi (xc7z045) görünüyor')
    const svcCount = await page.evaluate(() => document.querySelectorAll('.chip').length)
    if (svcCount < 3) fail(`TCF servis çipleri beklenirdi, ${svcCount} bulundu`)
    ok(`TCF servisleri listelendi (${svcCount} çip)`)
    // JTAG zinciri görselleştirmesi
    await waitForText(page, 'arm_dap', 10000)
    await waitForText(page, '0x23731093', 10000)
    const nodeCount = await page.evaluate(() => document.querySelectorAll('.jtag-node').length)
    if (nodeCount !== 2) fail(`JTAG zincirinde 2 düğüm beklenirdi, ${nodeCount} bulundu`)
    ok(`JTAG zinciri çizildi (${nodeCount} hedef, IDCODE/IR görünür)`)
    await shot(page, '06-smartlynq')

    // Ağ keşif diyaloğu (mock canned sonuç)
    const discoverBtn = await page.waitForSelector('.discover-btn')
    await discoverBtn!.click()
    await waitForText(page, 'cihaz bulundu', 8000)
    const discovered = await page.evaluate(() => document.querySelectorAll('.discovered-row').length)
    if (discovered < 2) fail(`Keşifte en az 2 sonuç beklenirdi, ${discovered} bulundu`)
    ok(`Ağ keşfi çalıştı (${discovered} cihaz listelendi)`)
    await shot(page, '07-kesif')

    console.log('\nDuman testi BAŞARILI — görüntüler: ' + SHOTS)
  } catch (err) {
    // Teşhis: hata anındaki görüntü ve sayfa metni
    try {
      const pages = (await browser?.pages()) ?? []
      const page = pages.find((p) => p.url().includes('index.html')) ?? pages[0]
      if (page) {
        await shot(page, '99-hata')
        console.error('--- Sayfa metni ---')
        console.error(await page.evaluate(() => document.body.innerText.slice(0, 1500)))
      }
    } catch {
      /* teşhis başarısız olabilir */
    }
    throw err
  } finally {
    browser?.disconnect()
    app.kill('SIGTERM')
    await sim1?.close()
    await sim2.close()
    await lynq.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
