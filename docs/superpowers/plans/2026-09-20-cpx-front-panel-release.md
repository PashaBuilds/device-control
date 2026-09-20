# CPX400DP Ön Panel Serbest Bırakma — Uygulama Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CPX400DP bağlıyken ön panel zamanın ≈%98–99'unda serbest kalsın: yoklama 10 s'de bir, her komut patlamasından sonra `LOCAL`; kullanıcı "Yenile" ile anında okuyabilsin ve son okumanın ne kadar eski olduğunu görsün.

**Architecture:** `DeviceTypeInfo`'ya `pollIntervalMs` ve `idleCommand` alanları eklenir. `ScpiConnection` komut kuyruğu her boşaldığında `idleCommand`'ı bir kez yazar (tek mekanizma; yoklama, kontrol komutları, ham konsol komutları, bağlantı kurulumu hepsini kapsar). `DeviceManager` yoklama aralığını cihaz türünden alır, ilk yoklamayı hemen yapar, ≥2 s aralıklı türlerde trip/tracking denetimini her turda yapar ve `refresh(id)` sunar. Arayüzde CPX üst çubuğuna "Panel serbest · son okuma N s önce" rozeti + Yenile düğmesi gelir. Simülatör REMOTE/LOCAL durumunu modeller.

**Tech Stack:** Electron + electron-vite, TypeScript, React 19, Zustand, vitest, puppeteer-core (e2e), electron-builder, gh CLI.

**Spec:** `docs/superpowers/specs/2026-09-20-cpx-front-panel-release-design.md`

## Global Constraints

- Sadece CPX400DP; Keysight E36233A ve SmartLynq'e hiçbir zaman `LOCAL`/`SYST:LOC` gitmez, yoklamaları 500 ms kalır.
- CPX400DP: `pollIntervalMs: 10000`, `idleCommand: 'LOCAL'`. Cihaz başına anahtar yok.
- `DeviceManager` constructor'ındaki `pollIntervalMs` seçeneği testler için geçersiz kılma olarak kalır (mevcut testler `50` kullanıyor).
- Art arda iki `LOCAL` gönderilmez; bağlantı kapalıyken gönderilmez; log kaynağı `'poll'`.
- Kod yorumları ve arayüz metinleri Türkçe (mevcut kod stiline uygun). Commit mesajları Türkçe, `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` ile biter.
- Her görevden sonra `npm test` ve `npm run typecheck` yeşil olmalı.
- Sürüm: `0.7.0` → `0.8.0`; release adı `Cihaz Kontrol v0.8.0 — CPX400DP paylaşımlı panel`.

---

## Dosya haritası

| Dosya | Sorumluluk / değişiklik |
|---|---|
| `src/shared/types.ts` | `DeviceTypeInfo.pollIntervalMs`, `idleCommand?`; `DEVICE_TYPES` değerleri |
| `src/main/scpi/connection.ts` | `idleCommand` seçeneği; kuyruk boşalınca bir kez yazma |
| `src/main/deviceManager.ts` | tür bazlı aralık, hemen ilk yoklama, trip denetim sıklığı, `refresh(id)`, `ScpiConnection`'a `idleCommand` geçirme |
| `src/shared/ipc.ts` | `DeviceApi.refresh`, `IPC_INVOKE_METHODS`'a `'refresh'` |
| `src/renderer/src/dev/mockDeviceApi.ts` | `refresh` (tarayıcı geliştirme modu) |
| `src/renderer/src/i18n/tr.ts` | rozet/düğme metinleri |
| `src/renderer/src/components/psu/TopBar.tsx` | rozet + Yenile düğmesi |
| `src/renderer/src/components/psu/PsuPanel.tsx` | `onRefresh` bağlama |
| `src/renderer/src/styles/global.css` | `.fresh-chip` stili |
| `tools/simulator/model.ts` | `remote` bayrağı, `SIM:REMOTE?` |
| `tests/connection.test.ts`, `tests/deviceManager.test.ts`, `tests/simulator.test.ts` | yeni testler |
| `tools/e2e/smoke.ts` | Yenile adımı |
| `README.md`, `package.json` | sürüm notu, 0.8.0 |

---

### Task 1: Cihaz türü bilgisi — `pollIntervalMs` ve `idleCommand`

**Files:**
- Modify: `src/shared/types.ts:4-64`
- Test: `tests/driver.test.ts` (dosyanın sonuna yeni `describe`)

**Interfaces:**
- Produces: `DeviceTypeInfo.pollIntervalMs: number`, `DeviceTypeInfo.idleCommand?: string`; `deviceTypeInfo('cpx400dp')` → `{ pollIntervalMs: 10000, idleCommand: 'LOCAL' }`, `'e36233a'` ve `'smartlynq'` → `{ pollIntervalMs: 500, idleCommand: undefined }`.

- [ ] **Step 1: Başarısız testi yaz**

`tests/driver.test.ts` dosyasının sonuna ekle:

```ts
import { deviceTypeInfo } from '../src/shared/types'

describe('DeviceTypeInfo yoklama/panel alanları', () => {
  it('CPX400DP 10 s yoklar ve kuyruk boşalınca LOCAL gönderir', () => {
    const info = deviceTypeInfo('cpx400dp')
    expect(info.pollIntervalMs).toBe(10000)
    expect(info.idleCommand).toBe('LOCAL')
  })

  it('Keysight ve SmartLynq 500 ms yoklar, idle komutu yok', () => {
    expect(deviceTypeInfo('e36233a').pollIntervalMs).toBe(500)
    expect(deviceTypeInfo('e36233a').idleCommand).toBeUndefined()
    expect(deviceTypeInfo('smartlynq').pollIntervalMs).toBe(500)
    expect(deviceTypeInfo('smartlynq').idleCommand).toBeUndefined()
  })
})
```

(Dosyanın başında `describe/it/expect` zaten vitest'ten içe aktarılıyorsa tekrar ekleme; `deviceTypeInfo` importunu dosyanın en üstündeki import bloğuna taşı.)

- [ ] **Step 2: Testin başarısız olduğunu doğrula**

Run: `npx vitest run tests/driver.test.ts`
Expected: FAIL — `expected undefined to be 10000`

- [ ] **Step 3: Alanları ekle**

`src/shared/types.ts` içinde `DeviceTypeInfo` arayüzüne (`hasOcpLevel` alanından sonra):

```ts
  /** Ölçüm yoklama aralığı (ms). */
  pollIntervalMs: number
  /**
   * Komut kuyruğu her boşaldığında bir kez gönderilecek komut (yanıt beklenmez).
   * Ön paneli uzaktan kilitleyen cihazlarda paneli serbest bırakmak için
   * (ör. CPX400DP `LOCAL`). Tanımsızsa hiçbir şey gönderilmez.
   */
  idleCommand?: string
```

`DEVICE_TYPES` içinde:
- `cpx400dp` girdisine `hasOcpLevel: true` sonrasına: `pollIntervalMs: 10000, idleCommand: 'LOCAL'`
- `e36233a` girdisine: `pollIntervalMs: 500`
- `smartlynq` girdisine: `pollIntervalMs: 500`

- [ ] **Step 4: Testlerin ve typecheck'in geçtiğini doğrula**

Run: `npx vitest run tests/driver.test.ts && npm run typecheck`
Expected: PASS; typecheck hatasız. (`mockDeviceApi.ts` kendi `DeviceTypeInfo` benzeri tabloyu kullanıyorsa ve tip hatası verirse, oradaki nesnelere de aynı alanları ekle.)

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts tests/driver.test.ts
git commit -m "feat(types): cihaz türüne yoklama aralığı ve idle komutu alanları

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `ScpiConnection` — kuyruk boşalınca `idleCommand`

**Files:**
- Modify: `src/main/scpi/connection.ts:4-6, 27-45, 112-140`
- Test: `tests/connection.test.ts`

**Interfaces:**
- Consumes: yok.
- Produces: `new ScpiConnection(host, port, { idleCommand?: string })`. Davranış: kuyruk boş ve `inFlight` yokken, son yazılan satır `idleCommand` değilse `idleCommand` bir kez yazılır (`log` olayı `{dir:'tx', line, source:'poll'}`), yanıt beklenmez.

- [ ] **Step 1: Başarısız testleri yaz**

`tests/connection.test.ts` içindeki `describe('ScpiConnection', ...)` bloğunun sonuna ekle (mevcut `startFakeServer` yardımcısını kullanır; `received` dizisi sunucuya gelen satırları tutar):

```ts
  describe('idleCommand', () => {
    /** Sunucunun belirli sayıda satır almasını bekler. */
    async function waitReceived(received: string[], count: number): Promise<void> {
      for (let i = 0; i < 100 && received.length < count; i++) {
        await new Promise((r) => setTimeout(r, 5))
      }
    }

    it('tek sorgudan sonra idle komutunu bir kez yazar', async () => {
      const srv = await startFakeServer((line) => (line === 'V1?' ? 'V1 5.000' : undefined))
      closeServer = srv.close
      conn = new ScpiConnection('127.0.0.1', srv.port, { idleCommand: 'LOCAL' })
      await conn.connect()
      await conn.query('V1?')
      await waitReceived(srv.received, 2)
      expect(srv.received).toEqual(['V1?', 'LOCAL'])
    })

    it('art arda komutlarda araya girmez, yalnızca kuyruk boşalınca gönderir', async () => {
      const srv = await startFakeServer((line) => (line.endsWith('?') ? '1' : undefined))
      closeServer = srv.close
      conn = new ScpiConnection('127.0.0.1', srv.port, { idleCommand: 'LOCAL' })
      await conn.connect()
      await Promise.all([conn.send('V1 5'), conn.query('V1?'), conn.query('I1?')])
      await waitReceived(srv.received, 4)
      expect(srv.received).toEqual(['V1 5', 'V1?', 'I1?', 'LOCAL'])
    })

    it('yeni komut gelmeden ikinci bir idle komutu göndermez', async () => {
      const srv = await startFakeServer((line) => (line.endsWith('?') ? '1' : undefined))
      closeServer = srv.close
      conn = new ScpiConnection('127.0.0.1', srv.port, { idleCommand: 'LOCAL' })
      await conn.connect()
      await conn.query('V1?')
      await waitReceived(srv.received, 2)
      await new Promise((r) => setTimeout(r, 30))
      expect(srv.received).toEqual(['V1?', 'LOCAL'])
      await conn.query('I1?')
      await waitReceived(srv.received, 4)
      expect(srv.received).toEqual(['V1?', 'LOCAL', 'I1?', 'LOCAL'])
    })

    it("idle komutu 'poll' kaynağıyla loglanır", async () => {
      const srv = await startFakeServer((line) => (line === 'V1?' ? '1' : undefined))
      closeServer = srv.close
      conn = new ScpiConnection('127.0.0.1', srv.port, { idleCommand: 'LOCAL' })
      const logs: Array<{ dir: string; line: string; source: string }> = []
      conn.on('log', (e) => logs.push(e))
      await conn.connect()
      await conn.query('V1?')
      await waitReceived(srv.received, 2)
      expect(logs).toContainEqual({ dir: 'tx', line: 'LOCAL', source: 'poll' })
    })

    it('idleCommand verilmezse fazladan hiçbir şey yazmaz', async () => {
      const srv = await startFakeServer((line) => (line === 'V1?' ? '1' : undefined))
      closeServer = srv.close
      conn = new ScpiConnection('127.0.0.1', srv.port)
      await conn.connect()
      await conn.query('V1?')
      await new Promise((r) => setTimeout(r, 30))
      expect(srv.received).toEqual(['V1?'])
    })
  })
```

- [ ] **Step 2: Testlerin başarısız olduğunu doğrula**

Run: `npx vitest run tests/connection.test.ts`
Expected: ilk 4 yeni test FAIL (`received` içinde `LOCAL` yok); son test PASS.

- [ ] **Step 3: Uygula**

`src/main/scpi/connection.ts`:

Seçenekler:
```ts
export interface ScpiConnectionOptions {
  timeoutMs?: number
  /**
   * Kuyruk her boşaldığında bir kez yazılacak komut (yanıt beklenmez). Ön paneli
   * uzaktan kilitleyen cihazlarda (CPX400DP `LOCAL`) paneli serbest bırakır.
   */
  idleCommand?: string
}
```

Alanlar (sınıfın başına, `consecutiveTimeouts` yanına):
```ts
  private readonly idleCommand: string | undefined
  /** Sokete en son yazılan satır; art arda iki idle komutu yazılmasını önler. */
  private lastWritten: string | null = null
```

Constructor'da: `this.idleCommand = opts.idleCommand`.

`connect()` içinde `this.buffer = ''` satırının yanına `this.lastWritten = null`.

`pump()` metodunu şu şekilde değiştir:
```ts
  private pump(): void {
    if (this.inFlight) return
    if (!this._connected || !this.socket) {
      if (this.queue.length > 0) this.failAll(new Error('disconnected'))
      return
    }
    if (this.queue.length === 0) {
      this.sendIdle()
      return
    }
    const item = this.queue.shift()!
    this.emit('log', { dir: 'tx', line: item.cmd, source: item.source })
    this.socket.write(item.cmd + '\n')
    this.lastWritten = item.cmd

    if (!item.expectsResponse) {
      item.resolve('')
      // Yazım sırası socket.write kuyruğuyla korunur; sonraki komuta geç.
      this.pump()
      return
    }

    this.inFlight = item
    this.timeoutTimer = setTimeout(() => {
      this.timeoutTimer = null
      if (this.inFlight === item) {
        this.inFlight = null
        this.consecutiveTimeouts += 1
        item.reject(new Error(`timeout: "${item.cmd}" ${this.timeoutMs}ms içinde yanıtlanmadı`))
        this.pump()
      }
    }, this.timeoutMs)
  }

  /** Kuyruk boşaldı: tanımlıysa ve az önce gönderilmediyse idle komutunu yaz. */
  private sendIdle(): void {
    if (!this.idleCommand || !this.socket || this.lastWritten === this.idleCommand) return
    this.emit('log', { dir: 'tx', line: this.idleCommand, source: 'poll' })
    this.socket.write(this.idleCommand + '\n')
    this.lastWritten = this.idleCommand
  }
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `npx vitest run tests/connection.test.ts && npm run typecheck`
Expected: tümü PASS (mevcut testler dahil).

- [ ] **Step 5: Commit**

```bash
git add src/main/scpi/connection.ts tests/connection.test.ts
git commit -m "feat(scpi): kuyruk boşalınca idle komutu (LOCAL) gönderme

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Simülatör — REMOTE/LOCAL durumu

**Files:**
- Modify: `tools/simulator/model.ts`
- Test: `tests/simulator.test.ts`

**Interfaces:**
- Produces: `Cpx400dpSim.remote: boolean` (başlangıç `false`); `SIM:` önekli olmayan her komut/sorgu `remote = true`; `LOCAL` → `remote = false`; `SIM:REMOTE?` → `'1'`/`'0'` (SIM komutları `remote`'u değiştirmez).

- [ ] **Step 1: Başarısız testi yaz**

`tests/simulator.test.ts` sonuna (mevcut `Cpx400dpSim` import'u var):

```ts
describe('Cpx400dpSim REMOTE/LOCAL', () => {
  it('başlangıçta local; herhangi bir komut remote yapar; LOCAL geri alır', () => {
    const sim = new Cpx400dpSim()
    expect(sim.remote).toBe(false)
    sim.handle('V1O?')
    expect(sim.remote).toBe(true)
    sim.handle('LOCAL')
    expect(sim.remote).toBe(false)
    sim.handle('V1 5.000')
    expect(sim.remote).toBe(true)
  })

  it('SIM: komutları remote durumunu değiştirmez; SIM:REMOTE? durumu bildirir', () => {
    const sim = new Cpx400dpSim()
    expect(sim.handle('SIM:REMOTE?')).toBe('0')
    expect(sim.remote).toBe(false)
    sim.handle('*IDN?')
    expect(sim.handle('SIM:REMOTE?')).toBe('1')
    sim.handle('SIM:LOAD1 5')
    expect(sim.remote).toBe(true)
  })
})
```

- [ ] **Step 2: Başarısız olduğunu doğrula**

Run: `npx vitest run tests/simulator.test.ts`
Expected: FAIL — `sim.remote` undefined / `SIM:REMOTE?` null döner.

- [ ] **Step 3: Uygula**

`tools/simulator/model.ts` — `Cpx400dpSim` sınıfına alan:
```ts
  /**
   * Gerçek cihaz gibi: arayüzden gelen her komut/sorgu REMOTE'a alır (ön panel
   * kilitli), `LOCAL` geri LOCAL'e döndürür. `SIM:` komutları etkilemez.
   */
  remote = false
```

`reset()` içine `this.remote = false` ekleme (gerçek `*RST` de remote'ta kalır) — **ekleme**.

`handle()` içinde, `if (line === '') return null` satırından hemen sonra, test uzantılarından **önce**:
```ts
    if ((m = line.match(/^SIM:REMOTE\?$/i))) return this.remote ? '1' : '0'
```
Test uzantıları bloğundan sonra, `// --- Ortak sistem komutları ---` satırından **önce**:
```ts
    // Arayüzden gelen her gerçek komut cihazı REMOTE'a alır (ön panel kilitlenir)
    this.remote = true
```
`LOCAL` satırını şu şekilde değiştir:
```ts
    if (/^LOCAL$/i.test(line)) {
      this.remote = false
      return null
    }
```

- [ ] **Step 4: Testlerin geçtiğini doğrula**

Run: `npx vitest run tests/simulator.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/simulator/model.ts tests/simulator.test.ts
git commit -m "feat(sim): CPX400DP simülatöründe REMOTE/LOCAL durumu

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `DeviceManager` — tür bazlı aralık, hemen ilk yoklama, trip denetimi, `LOCAL`, `refresh`

**Files:**
- Modify: `src/main/deviceManager.ts:22-27, 66-76, 221, 386-391, 420-428`
- Modify: `src/shared/ipc.ts:4-42`
- Test: `tests/deviceManager.test.ts`

**Interfaces:**
- Consumes: Task 1 (`deviceTypeInfo(kind).pollIntervalMs/idleCommand`), Task 2 (`ScpiConnectionOptions.idleCommand`), Task 3 (`sim.remote`).
- Produces: `export function pollIntervalFor(kind: DeviceKind, override?: number): number`; `DeviceManager.refresh(id: string): Promise<void>`; `DeviceApi.refresh(id): Promise<void>`; `IPC_INVOKE_METHODS` içinde `'refresh'`.

- [ ] **Step 1: Başarısız testleri yaz**

`tests/deviceManager.test.ts` — import bloğuna:
```ts
import { startE36233aSim } from '../tools/simulator/e36233a-sim'
import { DeviceManager, pollIntervalFor } from '../src/main/deviceManager'
```
(mevcut `import { DeviceManager } ...` satırını bununla değiştir.)

Ana `describe` bloğunun **içine**, `addAndConnect` yardımcısından sonra:

```ts
  describe('ön panel serbest bırakma (CPX400DP)', () => {
    /** Simülatörün LOCAL'e dönmesini bekler (kuyruk boşalınca yazılır, kısa gecikme). */
    async function waitLocal(): Promise<void> {
      for (let i = 0; i < 100 && sim.sim.remote; i++) await new Promise((r) => setTimeout(r, 5))
    }

    it('yoklama aralığı türden gelir; constructor seçeneği geçersiz kılar', () => {
      expect(pollIntervalFor('cpx400dp')).toBe(10000)
      expect(pollIntervalFor('e36233a')).toBe(500)
      expect(pollIntervalFor('smartlynq')).toBe(500)
      expect(pollIntervalFor('cpx400dp', 50)).toBe(50)
    })

    it('bağlantı kurulumu ve yoklama turu sonunda cihaz LOCAL kalır', async () => {
      const id = await addAndConnect()
      await waitForSnapshot(manager, (s) => s.id === id && s.state === 'connected')
      await waitLocal()
      expect(sim.sim.remote).toBe(false)
      // bir yoklama turu daha (50 ms aralık) → yine LOCAL'e dönmeli
      await new Promise((r) => setTimeout(r, 120))
      await waitLocal()
      expect(sim.sim.remote).toBe(false)
    })

    it('setVoltage ve sendRaw sonrasında cihaz LOCAL kalır', async () => {
      const id = await addAndConnect()
      await manager.setVoltage(id, 2, 7.5)
      await waitLocal()
      expect(sim.sim.remote).toBe(false)
      expect(sim.sim.channels[1].vSet).toBe(7.5)
      await manager.sendRaw(id, 'V1?')
      await waitLocal()
      expect(sim.sim.remote).toBe(false)
    })

    it('bağlanınca ilk yoklama beklemeden yapılır', async () => {
      // 10 s aralıkla (geçersiz kılma yok) bile ilk ölçüm hemen gelmeli
      const slow = new DeviceManager({ dataDir: dir })
      try {
        sim.sim.channels[0].vSet = 12
        sim.sim.channels[0].iSet = 5 // 8 Ω yükte 1.5 A; CC'ye düşmesin
        sim.sim.channels[0].outputOn = true
        const cfg = await slow.addDevice({ name: 'Yavaş', kind: 'cpx400dp', host: '127.0.0.1', port: sim.port })
        const first = waitForSnapshot(slow, (s) => s.id === cfg.id && s.channels[0].voltage === 12, 2000)
        await slow.connect(cfg.id)
        await first
      } finally {
        await slow.dispose()
      }
    })

    it('refresh hemen bir yoklama turu yapar ve LOCAL bırakır', async () => {
      const slow = new DeviceManager({ dataDir: dir })
      try {
        const cfg = await slow.addDevice({ name: 'Yavaş', kind: 'cpx400dp', host: '127.0.0.1', port: sim.port })
        await slow.connect(cfg.id)
        await waitForSnapshot(slow, (s) => s.id === cfg.id && s.state === 'connected')
        sim.sim.channels[1].vSet = 9
        sim.sim.channels[1].iSet = 5 // 8 Ω yükte 1.125 A; CC'ye düşmesin
        sim.sim.channels[1].outputOn = true
        const seen = waitForSnapshot(slow, (s) => s.id === cfg.id && s.channels[1].voltage === 9, 2000)
        await slow.refresh(cfg.id)
        await seen
        await waitLocal()
        expect(sim.sim.remote).toBe(false)
      } finally {
        await slow.dispose()
      }
    })

    it('≥2 s aralıklı türlerde trip denetimi her turda yapılır', async () => {
      const slow = new DeviceManager({ dataDir: dir })
      try {
        const cfg = await slow.addDevice({ name: 'Yavaş', kind: 'cpx400dp', host: '127.0.0.1', port: sim.port })
        await slow.connect(cfg.id)
        await waitForSnapshot(slow, (s) => s.id === cfg.id && s.state === 'connected')
        sim.sim.handle('SIM:TRIP1 OVP')
        const tripped = waitForSnapshot(slow, (s) => s.id === cfg.id && s.trips.some((t) => t.kind === 'ovp'), 2000)
        await slow.refresh(cfg.id) // ikinci tur (pollCount=1); 500 ms'lik türde denetim yapılmazdı
        await tripped
      } finally {
        await slow.dispose()
      }
    })

    it("Keysight'a hiçbir zaman LOCAL gitmez", async () => {
      const rx: string[] = []
      const ks = await startE36233aSim(0, (msg) => {
        if (msg.startsWith('rx: ')) rx.push(msg.slice(4))
      })
      try {
        const cfg = await manager.addDevice({ name: 'KS', kind: 'e36233a', host: '127.0.0.1', port: ks.port })
        await manager.connect(cfg.id)
        await waitForSnapshot(manager, (s) => s.id === cfg.id && s.state === 'connected')
        await manager.setVoltage(cfg.id, 1, 3)
        await new Promise((r) => setTimeout(r, 150))
        expect(rx.some((l) => /^(LOCAL|SYST:LOC)$/i.test(l))).toBe(false)
        expect(rx.length).toBeGreaterThan(0)
      } finally {
        await ks.close()
      }
    })
  })
```

- [ ] **Step 2: Başarısız olduğunu doğrula**

Run: `npx vitest run tests/deviceManager.test.ts`
Expected: `pollIntervalFor` import hatası ile derleme/çalışma hatası (FAIL).

- [ ] **Step 3: `DeviceManager`'ı uygula**

`src/main/deviceManager.ts`:

Import'a `DeviceKind` ekle:
```ts
import type {
  ChannelMeasurement,
  ChannelSetpoints,
  ConnectionState,
  DeviceConfig,
  DeviceKind,
  DeviceSnapshot,
  ProbeInfo,
  TripInfo
} from '@shared/types'
```

`DeviceManagerOptions` yorumunu güncelle:
```ts
export interface DeviceManagerOptions {
  dataDir: string
  /** Ölçüm yoklama aralığı (ms). Verilirse tüm türler için cihaz türü değerini geçersiz kılar (testler için). */
  pollIntervalMs?: number
}
```

`ManagedDevice` arayüzünün üstüne, `LSR_OCP` sabitinden sonra:
```ts
/** Yoklama aralığı: geçersiz kılma verilmişse o, yoksa cihaz türünün değeri. */
export function pollIntervalFor(kind: DeviceKind, override?: number): number {
  return override ?? deviceTypeInfo(kind).pollIntervalMs
}
```

Sınıf alanını ve constructor'ı değiştir:
```ts
  private readonly pollIntervalOverride: number | undefined
  ...
    this.pollIntervalOverride = opts.pollIntervalMs
```
(`this.pollIntervalMs = opts.pollIntervalMs ?? 500` satırını kaldır, `private readonly pollIntervalMs: number` alanını kaldır.)

`establish()` içinde bağlantı oluşturma satırı:
```ts
    const conn = new ScpiConnection(dev.config.host, dev.config.port, {
      idleCommand: deviceTypeInfo(dev.config.kind).idleCommand
    })
```

`startPolling`:
```ts
  private startPolling(dev: ManagedDevice): void {
    this.stopPolling(dev)
    dev.pollCount = 0
    const intervalMs = pollIntervalFor(dev.config.kind, this.pollIntervalOverride)
    dev.pollTimer = setInterval(() => void this.poll(dev), intervalMs)
    // İlk ölçüm aralığı beklemeden gelsin (10 s'lik türlerde önemli)
    void this.poll(dev)
  }
```

`poll()` içinde trip/tracking denetimi:
```ts
      // Trip ve tracking denetimi: hızlı yoklayan türlerde her 4. turda (≈2 s),
      // ≥2 s aralıklı türlerde (CPX 10 s) her turda
      const intervalMs = pollIntervalFor(dev.config.kind, this.pollIntervalOverride)
      const checkEvery = intervalMs >= 2000 ? 1 : 4
      if (dev.pollCount % checkEvery === 0) {
```

`// ---- Kontrol komutları ----` bölümünün başına:
```ts
  /** Kullanıcı isteğiyle anında bir yoklama turu (bağlı değilse veya meşgulse sessizce döner). */
  async refresh(id: string): Promise<void> {
    const dev = this.get(id)
    if (this.isProbe(dev)) return
    await this.poll(dev)
  }
```

- [ ] **Step 4: IPC yüzeyine `refresh` ekle**

`src/shared/ipc.ts`: `DeviceApi` arayüzüne `tripReset` satırından sonra:
```ts
  /** Anında bir yoklama turu (10 s aralıklı türlerde son okumayı tazelemek için). */
  refresh(id: string): Promise<void>
```
`IPC_INVOKE_METHODS` dizisine `'tripReset'` sonrasına `'refresh'`.

`src/renderer/src/dev/mockDeviceApi.ts`: `tripReset` metodundan sonra (dosyadaki `requireConnected`/`publish` yardımcıları ile):
```ts
  async refresh(id: string): Promise<void> {
    const dev = requireConnected(id)
    publish(dev)
  },
```
(Sahte API'de yoklama zaten 500 ms'de sürüyor; `refresh` yalnızca yeni zaman damgalı snapshot yayınlar.)

- [ ] **Step 5: Testlerin geçtiğini doğrula**

Run: `npm test && npm run typecheck`
Expected: tüm testler PASS (yeni 7 dahil), typecheck temiz. Mevcut `deviceManager` testleri hâlâ `pollIntervalMs: 50` ile hızlı çalışır.

- [ ] **Step 6: Commit**

```bash
git add src/main/deviceManager.ts src/shared/ipc.ts src/renderer/src/dev/mockDeviceApi.ts tests/deviceManager.test.ts
git commit -m "feat(psu): CPX400DP 10 s yoklama, her komut sonrası LOCAL, anında yenileme

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Arayüz — "Panel serbest · son okuma" rozeti + Yenile

**Files:**
- Modify: `src/renderer/src/i18n/tr.ts:56-86`
- Modify: `src/renderer/src/components/psu/TopBar.tsx`
- Modify: `src/renderer/src/components/psu/PsuPanel.tsx:56-64`
- Modify: `src/renderer/src/styles/global.css` (`.topbar .conn-state` bloğundan sonra)

**Interfaces:**
- Consumes: `DeviceApi.refresh` (Task 4), `deviceTypeInfo(kind).idleCommand`, `deviceTypeInfo(kind).pollIntervalMs` (Task 1), `snapshot.timestamp`.
- Produces: `TopBar` prop `onRefresh: () => Promise<void>`.

- [ ] **Step 1: Metinleri ekle**

`src/renderer/src/i18n/tr.ts` `panel` nesnesine `lockHintOn` satırından sonra:
```ts
    panelFree: 'Panel serbest',
    panelFreeHint: (sec: number) =>
      `Cihazın ön paneli serbest: uygulama ${sec} s'de bir okur ve her komuttan sonra cihazı LOCAL moduna alır.`,
    lastRead: (sec: number) => `son okuma ${sec} s önce`,
    refresh: 'Yenile',
    refreshHint: 'Cihazdan şimdi oku (panel kısa süre kilitlenir)',
```

- [ ] **Step 2: TopBar'a rozet ve düğme ekle**

`src/renderer/src/components/psu/TopBar.tsx`:

Import'lara `useEffect, useState` ekle:
```ts
import { useEffect, useState } from 'react'
```

`Props`'a: `onRefresh: () => Promise<void>`.

`ledClass` fonksiyonundan sonra:
```ts
/** Saniyede bir yenilenen "şimdi" değeri (son okuma yaşını göstermek için). */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])
  return now
}
```

`TopBar` parametrelerine `onRefresh` ekle. Gövdede `const hasTracking = ...` satırından sonra:
```ts
  const typeInfo = deviceTypeInfo(device.kind)
  const panelRelease = typeInfo.idleCommand !== undefined
  const now = useNow()
  const ageSec = snapshot ? Math.max(0, Math.round((now - snapshot.timestamp) / 1000)) : 0
```

JSX'te `{connected && (<> ... </>)}` bloğunun içine, `hasTracking` düğmesinden **önce**:
```tsx
          {panelRelease && (
            <span className="fresh-chip" title={tr.panel.panelFreeHint(typeInfo.pollIntervalMs / 1000)}>
              <span className="led on" />
              {tr.panel.panelFree} · {tr.panel.lastRead(ageSec)}
              <button className="btn ghost tiny" title={tr.panel.refreshHint} onClick={() => void onRefresh()}>
                {tr.panel.refresh}
              </button>
            </span>
          )}
```

- [ ] **Step 3: PsuPanel'de bağla**

`src/renderer/src/components/psu/PsuPanel.tsx` `<TopBar ... />` içine `onToggleLock` satırından sonra:
```tsx
        onRefresh={() => run(() => api.refresh(device.id))}
```

- [ ] **Step 4: Stil**

`src/renderer/src/styles/global.css` `.topbar .conn-state { ... }` bloğunun hemen ardına:
```css
.topbar .fresh-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text-2);
  padding: 3px 4px 3px 10px;
  border: 1px solid var(--line);
  border-radius: 99px;
  white-space: nowrap;
}
.topbar .fresh-chip .btn.tiny {
  padding: 3px 9px;
  font-size: 11px;
}
```
(`.btn.ghost` zaten tanımlı; `.tiny` yalnızca boyut küçültür.)

- [ ] **Step 5: Typecheck + tarayıcı önizleme**

Run: `npm run typecheck && npm test`
Expected: temiz / PASS.

Run (arka planda, simülatörler açıkken): `npm run dev` → CPX cihazına bağlan → üst çubukta yeşil ledli **"Panel serbest · son okuma N s önce  [Yenile]"** rozetini gör; N 0→9 arasında sayıp 10 s'de sıfırlanır; Yenile'ye basınca 0'a döner. Keysight panelinde rozet **yok**. Ekran görüntüsü al ve bak (boş çerçeve = hata).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/i18n/tr.ts src/renderer/src/components/psu/TopBar.tsx src/renderer/src/components/psu/PsuPanel.tsx src/renderer/src/styles/global.css
git commit -m "feat(ui): CPX üst çubuğunda 'Panel serbest · son okuma' rozeti ve Yenile

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: E2E duman testi — Yenile adımı ve LOCAL doğrulaması

**Files:**
- Modify: `tools/e2e/smoke.ts:131-135` civarı (Cihaz 1 ölçüm doğrulamasından sonra)

**Interfaces:**
- Consumes: Task 3 (`sim1.sim.remote`), Task 5 (rozet metni), Task 4 (`refresh`).

- [ ] **Step 1: Adımı ekle**

`tools/e2e/smoke.ts` içinde `ok('Ölçümler doğru: 10.00V / 2.00A (5Ω yük modeli)')` satırından ve `await shot(page, '02-cihaz1-acik')` satırından sonra:
```ts
    // Paylaşımlı panel: rozet görünür, cihaz LOCAL'de, Yenile anında okur
    await waitForText(page, 'Panel serbest', 5000)
    for (let i = 0; i < 40 && sim1.sim.remote; i++) await new Promise((r) => setTimeout(r, 25))
    if (sim1.sim.remote) fail('Komutlardan sonra CPX simülatörü LOCAL\'e dönmedi')
    ok('CPX ön paneli serbest (simülatör LOCAL durumunda)')
    sim1.sim.channels[1].vSet = 4
    sim1.sim.channels[1].outputOn = true
    await page.evaluate(async () => {
      const api = (window as unknown as { deviceApi: import('../../src/shared/ipc').DeviceApi }).deviceApi
      const devs = await api.listDevices()
      await api.refresh(devs[0].id)
    })
    await waitForText(page, '4.00', 5000)
    await waitForText(page, 'son okuma 0 s önce', 3000)
    for (let i = 0; i < 40 && sim1.sim.remote; i++) await new Promise((r) => setTimeout(r, 25))
    if (sim1.sim.remote) fail('Yenile sonrası CPX simülatörü LOCAL\'e dönmedi')
    ok('Yenile anında okudu (4.00 V) ve cihazı LOCAL bıraktı')
    await shot(page, '02b-panel-serbest')
```

- [ ] **Step 2: Derle ve e2e'yi çalıştır**

Run: `npm run build && npm run e2e`
Expected: mevcut 17 adım + 2 yeni `✓`, sonunda `Duman testi BAŞARILI`. (Yeniden bağlanma adımı 10 s aralıkla da geçmeli: simülatör kapanınca soket `close` olayı anında tetiklenir; bağlanınca ilk yoklama hemen yapılır.)

- [ ] **Step 3: Commit**

```bash
git add tools/e2e/smoke.ts
git commit -m "test(e2e): paylaşımlı panel rozeti, Yenile ve LOCAL doğrulaması

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Sürüm 0.8.0 — README, versiyon, paket, GitHub release

**Files:**
- Modify: `README.md:14-40` (Özellikler), `README.md:83-90` (Saha kullanımı CPX400DP)
- Modify: `package.json:3`
- Modify: `docs/superpowers/specs/2026-09-20-cpx-front-panel-release-design.md` (SIM:REMOTE? notu — Task 3'teki gerçek davranışla hizala)

- [ ] **Step 1: README güncelle**

`## Özellikler` listesine (CPX400DP maddesinin altına) madde ekle:
```md
- **Paylaşımlı ön panel (CPX400DP):** uygulama cihazı 10 s'de bir okur ve her komuttan sonra
  `LOCAL` gönderir; ön panel zamanın ≈%98'inde serbesttir — bir kişi kanal 1'i panelden,
  diğeri kanal 2'yi uygulamadan kullanabilir. Üst çubuktaki **Yenile** anında okur;
  "son okuma N s önce" rozeti değerin tazeliğini gösterir.
```

`## Saha kullanımı (CPX400DP)` bölümüne 5. madde:
```md
5. Cihazın REMOTE/LOCAL durumu kanal başına değil cihaz genelidir. Uygulama bağlıyken
   ön panel yalnızca yoklama/komut anlarında (~0,1–0,4 s) kilitlenir; REMOTE lambası
   kısa yanıp söner. Paneldeki **OP ALL** tuşu iki kanalı birden kapatır — uygulamadan
   sürülen kanal da etkilenir; bu durum bir sonraki okumada (≤10 s veya **Yenile**) görünür.
```

Spec dosyasında "5. Simülatör" bölümündeki `SIM:REMOTE?` cümlesini şununla değiştir:
```md
REMOTE/LOCAL durumu: `remote` bayrağı; `SIM:` öneksiz her komut/sorgu alınca
`true`, `LOCAL` alınca `false`. `SIM:` komutları (test kancaları) durumu
değiştirmez; `SIM:REMOTE?` `0`/`1` döner.
```

- [ ] **Step 2: Sürümü yükselt**

`package.json`: `"version": "0.8.0"`. `npm install --package-lock-only` ile `package-lock.json` sürümünü eşitle.

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit ve etiket**

```bash
git add README.md package.json package-lock.json docs/superpowers/specs/2026-09-20-cpx-front-panel-release-design.md docs/superpowers/plans/2026-09-20-cpx-front-panel-release.md
git commit -m "chore: v0.8.0 — CPX400DP paylaşımlı panel, README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git tag v0.8.0
git push origin main --tags
```

- [ ] **Step 4: Windows paketini üret**

Run: `npm run dist:win`
Expected: `release/Cihaz Kontrol Setup 0.8.0.exe`, `release/Cihaz Kontrol Setup 0.8.0.exe.blockmap`, `release/CihazKontrol-0.8.0-portable.exe` oluşur. `ls release` ile doğrula.

- [ ] **Step 5: Release notlarını yaz ve yayınla**

Not dosyası `release/notes-0.8.0.md`:
```md
**CPX400DP paylaşımlı ön panel.** Uygulama artık cihazı 500 ms yerine **10 s'de bir** okuyor ve her komut patlamasından sonra `LOCAL` gönderiyor. Ön panel zamanın ≈%98'inde serbest: bir kişi kanal 1'i cihazın panelinden, diğeri kanal 2'yi uygulamadan kullanabilir. Kilitli anlar ~0,1–0,4 s (yoklama turu / komut), REMOTE lambası kısa yanıp söner.

**Yenile + tazelik rozeti.** Üst çubukta *Panel serbest · son okuma N s önce* rozeti ve **Yenile** düğmesi. Kendi komutlarınız anında doğrulanır; panelden yapılan değişiklikler en geç 10 s'de veya Yenile ile görünür.

Keysight E36233A ve Hardware Server davranışı değişmedi (500 ms canlı yoklama). CPX400DP simülatörü REMOTE/LOCAL durumunu modelliyor.

**Windows x64:** `Cihaz Kontrol Setup 0.8.0.exe` (kurulumlu) / `CihazKontrol-0.8.0-portable.exe` (taşınabilir). İmzasız — SmartScreen'de "Ek bilgi → Yine de çalıştır".

Doğrulama: <N> birim/entegrasyon testi + 19 adımlı uçtan uca duman testi (CPX400DP ×2, Keysight, Hardware Server) yeşil; npm audit 0 açık.
```
(`<N>` yerine `npm test` çıktısındaki gerçek test sayısını yaz.)

Run:
```bash
gh release create v0.8.0 "release/Cihaz Kontrol Setup 0.8.0.exe" "release/Cihaz Kontrol Setup 0.8.0.exe.blockmap" "release/CihazKontrol-0.8.0-portable.exe" --title "Cihaz Kontrol v0.8.0 — CPX400DP paylaşımlı panel" --notes-file release/notes-0.8.0.md
```
Expected: release URL yazdırılır; `gh release view v0.8.0 --json assets -q '.assets[].name'` üç dosyayı listeler.

- [ ] **Step 6: Çalışan uygulamayı kontrol et**

`release/CihazKontrol-0.8.0-portable.exe`'yi simülatörler açıkken çalıştır, CPX'e bağlan, rozeti ve Yenile'yi gör; kapat. (Kullanıcıya release bağlantısını ver.)
