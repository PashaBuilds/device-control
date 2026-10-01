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
// Node bağlamında 'electron' paketi ikili dosyanın yolunu verir (Windows/Linux/macOS)
import electronBin from 'electron'
import { startCpx400dpSim, type SimHandle } from '../simulator/cpx400dp-sim'
import { startSmartLynqSim, type SmartLynqSimHandle } from '../simulator/smartlynq-sim'
import { startE36233aSim, type E36233aSimHandle } from '../simulator/e36233a-sim'
import { startN5745aSim, type N5745aSimHandle } from '../simulator/n5745a-sim'

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
  const keysight: E36233aSimHandle = await startE36233aSim(5025)
  const n5745a: N5745aSimHandle = await startN5745aSim(5026)
  sim1.sim.channels[0].loadOhms = 5 // 10V/5Ω = 2A
  keysight.sim.channels[0].loadOhms = 10 // 12V/10Ω = 1.2A

  const app: ChildProcess = spawn(electronBin as unknown as string, [ROOT, `--remote-debugging-port=${DEBUG_PORT}`], {
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

    // Paylaşımlı panel: rozet görünür, cihaz LOCAL'de, Yenile anında okur
    await waitForText(page, 'Panel serbest', 5000)
    for (let i = 0; i < 40 && sim1.sim.remote; i++) await new Promise((r) => setTimeout(r, 25))
    if (sim1.sim.remote) fail("Komutlardan sonra CPX simülatörü LOCAL'e dönmedi")
    ok('CPX ön paneli serbest (simülatör LOCAL durumunda)')
    sim1.sim.channels[1].vSet = 4
    sim1.sim.channels[1].outputOn = true
    await page.evaluate(async () => {
      const api = (window as unknown as { deviceApi: import('../../src/shared/ipc').DeviceApi })
        .deviceApi
      const devs = await api.listDevices()
      await api.refresh(devs[0].id)
    })
    await waitForText(page, '4.00', 5000)
    await waitForText(page, 'son okuma 0 s önce', 3000)
    for (let i = 0; i < 40 && sim1.sim.remote; i++) await new Promise((r) => setTimeout(r, 25))
    if (sim1.sim.remote) fail("Yenile sonrası CPX simülatörü LOCAL'e dönmedi")
    ok('Yenile anında okudu (4.00 V) ve cihazı LOCAL bıraktı')
    await shot(page, '02b-panel-serbest')

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
    await waitForText(page, 'Xilinx Hardware Server', 15000)
    await waitForText(page, 'xc7z045', 15000)
    ok('Hardware Server bağlandı — agent + JTAG hedefi (xc7z045) görünüyor')
    const svcCount = await page.evaluate(() => document.querySelectorAll('.chip').length)
    if (svcCount < 3) fail(`TCF servis çipleri beklenirdi, ${svcCount} bulundu`)
    ok(`TCF servisleri listelendi (${svcCount} çip)`)
    // JTAG zinciri görselleştirmesi
    await waitForText(page, 'arm_dap', 10000)
    await waitForText(page, '0x23731093', 10000)
    const nodeCount = await page.evaluate(() => document.querySelectorAll('.jtag-node').length)
    if (nodeCount !== 2) fail(`JTAG zincirinde 2 düğüm beklenirdi, ${nodeCount} bulundu`)
    ok(`JTAG zinciri çizildi (${nodeCount} hedef, IDCODE/IR görünür)`)
    await shot(page, '06-hwserver')

    // Keysight E36233A: ekle + bağlan + ölçüm + capability doğrula
    await addDevice(page, 'Keysight PSU', 5025, 'e36233a')
    ok('Keysight cihazı eklendi')
    const ksConnect = await page.waitForSelector('.topbar .btn.primary')
    await ksConnect!.click()
    await waitForText(page, 'Keysight Technologies,E36233A', 15000)
    ok('Keysight bağlandı, kimlik doğrulandı')
    await page.evaluate(async () => {
      const api = (window as unknown as { deviceApi: { listDevices(): Promise<Array<{ id: string; kind: string }>>; setVoltage(i: string, c: number, v: number): Promise<void>; setCurrent(i: string, c: number, a: number): Promise<void>; setOutput(i: string, c: number, on: boolean): Promise<void> } }).deviceApi
      const d = (await api.listDevices()).find((x) => x.kind === 'e36233a')!
      await api.setVoltage(d.id, 1, 12)
      await api.setCurrent(d.id, 1, 2)
      await api.setOutput(d.id, 1, true)
    })
    await waitForText(page, '12.00', 8000)
    ok('Keysight ölçümü görünüyor (12.00 V)')
    // Capability: tracking anahtarı YOK, OCP alanı YOK, OVP alanı VAR
    const caps = await page.evaluate(() => ({
      tracking: document.querySelectorAll('.switch-label').length,
      ovp: document.body.innerText.includes('OVP'),
      ocp: document.body.innerText.includes('OCP')
    }))
    if (caps.tracking !== 0) fail(`Keysight'te izleme modu gösterilmemeliydi (${caps.tracking} bulundu)`)
    if (!caps.ovp) fail('Keysight panelinde OVP alanı beklenirdi')
    if (caps.ocp) fail('Keysight panelinde OCP alanı gösterilmemeliydi')
    ok('Capability uyarlaması doğru: tracking yok, OCP yok, OVP var')
    await shot(page, '07-keysight')

    // Keysight N5745A: ekle + bağlan + ölçüm + tek kanal arayüzü
    await addDevice(page, 'N5745A PSU', 5026, 'n5745a')
    ok('N5745A cihazı eklendi')
    const nConnect = await page.waitForSelector('.topbar .btn.primary')
    await nConnect!.click()
    await waitForText(page, 'N5745A,US17M1234P', 15000)
    ok('N5745A bağlandı, kimlik doğrulandı')
    await page.evaluate(async () => {
      const api = (window as unknown as { deviceApi: import('../../src/shared/ipc').DeviceApi })
        .deviceApi
      const d = (await api.listDevices()).find((x) => x.kind === 'n5745a')!
      await api.setVoltage(d.id, 1, 12)
      await api.setCurrent(d.id, 1, 5)
      await api.setOutput(d.id, 1, true)
    })
    await waitForText(page, '12.00', 8000)
    await waitForText(page, '1.20', 8000)
    ok('N5745A ölçümü görünüyor (12.00 V / 1.20 A, 10 Ω yük)')
    const nCaps = await page.evaluate(() => ({
      cards: document.querySelectorAll('.channel-card').length,
      allOn: document.body.innerText.includes('Tümünü Aç'),
      ocp: document.body.innerText.includes('OCP'),
      tracking: document.querySelectorAll('.switch-label').length
    }))
    if (nCaps.cards !== 1) fail(`N5745A'da 1 kanal kartı beklenirdi, ${nCaps.cards} bulundu`)
    if (nCaps.allOn) fail("Tek kanallı cihazda 'Tümünü Aç' gösterilmemeli")
    if (nCaps.ocp) fail('N5745A panelinde OCP alanı gösterilmemeli')
    if (nCaps.tracking !== 0) fail('N5745A panelinde izleme modu gösterilmemeli')
    ok('Tek kanal arayüzü doğru: 1 kart, Tümünü Aç yok, OCP yok, tracking yok')
    await shot(page, '08-n5745a')

    // Diğer tema: tercih kalıcı, yeniden yüklemede uygulanır; bağlantılar ana süreçte sürer
    const before = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    const other = before === 'light' ? 'dark' : 'light'
    await page.evaluate((t) => localStorage.setItem('ui-theme', t), other)
    await page.reload()
    await waitForText(page, 'CİHAZ KONTROL')
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    if (theme !== other) fail(`${other} tema uygulanmadı (${theme})`)
    await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.device-row')].find((r) => r.innerText.includes('Sim PSU 1'))?.click()
    )
    await waitForText(page, 'THURLBY THANDAR, CPX400DP', 10000)
    await new Promise((r) => setTimeout(r, 1500))
    ok(`${other === 'dark' ? 'Koyu' : 'Açık'} tema uygulandı ve panel yüklendi`)
    await shot(page, '09-diger-tema')
    await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.device-row')].find((r) => r.innerText.includes('Lynq'))?.click()
    )
    await waitForText(page, 'xc7z045', 10000)
    await new Promise((r) => setTimeout(r, 800))
    await shot(page, '10-diger-tema-jtag')
    await page.evaluate((t) => localStorage.setItem('ui-theme', t ?? 'dark'), before)

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
    await keysight.close()
    await n5745a.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
