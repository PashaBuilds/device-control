# Cihaz Kontrol Arayüzü — Implementasyon Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TCP/IP üzerinden Aim-TTi CPX400DP güç kaynağını (ve ileride başka cihaz türlerini) kontrol eden, Windows hedefli, çoklu-cihaz destekli Electron masaüstü uygulaması.

**Architecture:** Electron main process cihaz bağlantılarını (TCP 9221, komut kuyruğu) ve sürücüleri yönetir; React renderer tip güvenli IPC üzerinden kontrol eder. Cihaz türleri sürücü + panel çifti olarak eklenir. Testler gerçek protokolü konuşan yerel bir CPX400DP simülatörüne karşı koşar.

**Tech Stack:** Electron + electron-vite + React 19 + TypeScript, zustand (renderer state), uPlot (trend grafiği), Vitest (test), electron-builder (Windows x64 paket), tsx (simülatör çalıştırma).

## Global Constraints

- Arayüz dili: **Türkçe** (tüm metinler `src/renderer/src/i18n/tr.ts` benzeri tek modülde toplanır).
- Hedef platform: **Windows x64**; geliştirme/test macOS.
- CPX400DP TCP portu varsayılan **9221**; gönderim satır sonu `\n`, yanıt satır sonu `\r\n`.
- Kanal aralıkları: 0–60 V, 0–20 A (giriş doğrulaması), OVP 1–66 V, OCP 1–22 A.
- Sürücü asla `SIM:` önekli komut göndermez; bunlar yalnızca test/simülatör içindir.
- Görsel dil: koyu tema, sade, premium laboratuvar estetiği; ölçüm göstergelerinde tabular rakamlar.
- Commit sıklığı: her task sonunda en az bir commit.

---

### Task 1: Proje iskeleti

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `.gitignore`
- Create: `src/main/index.ts` (boş pencere), `src/preload/index.ts` (boş köprü), `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx` (placeholder)
- Create: `vitest.config.ts`

**Interfaces:**
- Produces: çalışan `npm run dev` (Electron penceresi açılır), `npm test` (vitest koşar), `npm run build` derlenir.

- [ ] **Step 1:** `npm create @quick-start/electron` yerine elle kurulum: `npm init -y`; bağımlılıklar: `electron`, `electron-vite`, `vite`, `react`, `react-dom`, `typescript`, `@types/react`, `@types/react-dom`, `vitest`, `tsx`, `zustand`, `uplot`, `electron-builder` (dev). Script'ler: `dev: electron-vite dev`, `build: electron-vite build`, `test: vitest run`, `sim: tsx tools/simulator/cli.ts`, `dist:win: electron-vite build && electron-builder --win --x64`.
- [ ] **Step 2:** electron-vite config: main → `src/main/index.ts`, preload → `src/preload/index.ts`, renderer → `src/renderer`. Main: 1280×800 pencere, `contextIsolation: true`, `nodeIntegration: false`, preload yüklü. Koyu arka plan (`backgroundColor: '#0d1117'` benzeri) — beyaz flaş olmasın.
- [ ] **Step 3:** `npm run dev` ile pencerenin açıldığını, `npm test`'in (0 test) koştuğunu doğrula.
- [ ] **Step 4:** Commit: `chore: electron-vite + react + vitest proje iskeleti`

### Task 2: Paylaşılan tipler ve IPC sözleşmesi

**Files:**
- Create: `src/shared/types.ts`, `src/shared/ipc.ts`

**Interfaces (Produces — sonraki tüm task'lar bunları kullanır):**

```ts
// src/shared/types.ts
export type DeviceKind = 'cpx400dp';
export type DeviceCategory = 'power-supply';

export interface DeviceTypeInfo {
  kind: DeviceKind;
  category: DeviceCategory;
  label: string;            // "Aim-TTi CPX400DP"
  channelCount: number;     // 2
  maxVoltage: number;       // 60
  maxCurrent: number;       // 20
  defaultPort: number;      // 9221
}

export interface DeviceConfig {
  id: string;               // crypto.randomUUID()
  name: string;
  kind: DeviceKind;
  host: string;
  port: number;
}

export type ConnectionState =
  | 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export type RegulationMode = 'cv' | 'cc' | 'off';

export interface ChannelMeasurement {
  voltage: number; current: number; power: number;
  outputOn: boolean; mode: RegulationMode;
}

export interface ChannelSetpoints {
  voltage: number; current: number; ovp: number; ocp: number;
}

export interface TripInfo { channel: number; kind: 'ovp' | 'ocp' | 'other'; }

export interface DeviceSnapshot {
  id: string;
  state: ConnectionState;
  identity: string | null;
  error: string | null;
  channels: ChannelMeasurement[];   // index 0 = kanal 1
  setpoints: ChannelSetpoints[];
  tracking: boolean;
  trips: TripInfo[];
  timestamp: number;                // Date.now()
}

export interface ScpiLogEntry {
  deviceId: string; dir: 'tx' | 'rx'; line: string; timestamp: number;
}
```

```ts
// src/shared/ipc.ts — renderer'a açılan köprünün tam tipi
export interface DeviceApi {
  listDevices(): Promise<DeviceConfig[]>;
  addDevice(cfg: Omit<DeviceConfig, 'id'>): Promise<DeviceConfig>;
  updateDevice(cfg: DeviceConfig): Promise<void>;
  removeDevice(id: string): Promise<void>;
  connect(id: string): Promise<void>;
  disconnect(id: string): Promise<void>;
  setVoltage(id: string, ch: number, volts: number): Promise<void>;
  setCurrent(id: string, ch: number, amps: number): Promise<void>;
  setOvp(id: string, ch: number, volts: number): Promise<void>;
  setOcp(id: string, ch: number, amps: number): Promise<void>;
  setOutput(id: string, ch: number, on: boolean): Promise<void>;
  setAllOutputs(id: string, on: boolean): Promise<void>;
  setTracking(id: string, on: boolean): Promise<void>;
  tripReset(id: string): Promise<void>;
  sendRaw(id: string, command: string): Promise<string | null>; // sorguysa yanıt
  onSnapshot(cb: (s: DeviceSnapshot) => void): () => void;
  onLog(cb: (e: ScpiLogEntry) => void): () => void;
}
```

IPC kanal adları: `invoke` tarafı `dc:<metodAdı>` (ör. `dc:setVoltage`), event tarafı `dc:snapshot`, `dc:log`. `DEVICE_TYPES: DeviceTypeInfo[]` sabiti `types.ts`te tanımlanır (tek eleman: cpx400dp).

- [ ] **Step 1:** İki dosyayı yukarıdaki içerikle yaz; `npm run build` ile tip hatası olmadığını doğrula.
- [ ] **Step 2:** Commit: `feat: paylaşılan tipler ve IPC sözleşmesi`

### Task 3: ScpiConnection — TCP + komut kuyruğu (TDD)

**Files:**
- Create: `src/main/scpi/connection.ts`
- Test: `tests/connection.test.ts` (test içinde `node:net` ile sahte sunucu kurulur)

**Interfaces:**
- Produces:

```ts
export interface ScpiConnectionOptions { timeoutMs?: number /* varsayılan 3000 */ }
export class ScpiConnection extends EventEmitter {
  constructor(host: string, port: number, opts?: ScpiConnectionOptions);
  connect(): Promise<void>;          // TCP bağlanana dek; hata fırlatır
  disconnect(): void;                // kuyruktaki bekleyenleri reddeder
  get connected(): boolean;
  query(cmd: string): Promise<string>;  // '?' içeren komut: bir satır yanıt döner (CRLF'siz)
  send(cmd: string): Promise<void>;     // yanıt beklemeyen komut; yazım sırası kuyrukla korunur
  // events: 'state' (ConnectionState), 'log' ({dir:'tx'|'rx', line:string}), 'close'
}
```

Davranış kuralları:
- Tüm komutlar tek FIFO kuyruktan sırayla yazılır; `query` yanıtı gelmeden sonraki komut yazılmaz (cihaz sırayla yanıtlar, eşleştirme bozulmasın).
- Gelen veri tamponlanır, `\n` ile satırlara bölünür, `\r` kırpılır.
- `query` zaman aşımında `Error('timeout')` ile reddedilir ve kuyruk kalan işlerle devam eder; art arda zaman aşımı sayacı bağlantı üstünde tutulur (DeviceManager kullanır).
- `disconnect` sonrası bekleyen tüm promise'ler `Error('disconnected')` ile reddedilir.

- [ ] **Step 1:** Failing testler: (a) query gönderir `V1?\n` yazıldığını görür, sahte sunucu `V1 5.000\r\n` döner, promise `"V1 5.000"` ile çözülür; (b) iki query art arda → yanıtlar sırayla eşleşir; (c) yanıt gelmezse 100ms timeout ile reddedilir, sonraki query çalışmaya devam eder; (d) send + query karışık sıra korunur; (e) sunucu soketi kapatınca 'close' event + bekleyenler reddedilir.
- [ ] **Step 2:** Testlerin FAIL olduğunu gör (`npm test`).
- [ ] **Step 3:** `ScpiConnection`'ı uygula; testler PASS.
- [ ] **Step 4:** Commit: `feat: scpi tcp bağlantısı ve komut kuyruğu`

### Task 4: CPX400DP simülatörü (TDD)

**Files:**
- Create: `tools/simulator/cpx400dp-sim.ts` (sınıf + `startCpx400dpSim(port): Promise<{port, close()}>`)
- Create: `tools/simulator/cli.ts` (`tsx tools/simulator/cli.ts [port]` → varsayılan 9221, konsola log)
- Test: `tests/simulator.test.ts`

**Interfaces:**
- Consumes: yok (bağımsız `node:net` sunucusu).
- Produces: gerçek CPX400DP protokolünün şu alt kümesi — `*IDN?` (`THURLBY THANDAR, CPX400DP, 0, 1.00`), `V<n> <v>`, `V<n>?`→`V<n> <x.xxx>`, `I<n> <a>`, `I<n>?`→`I<n> <x.xxx>`, `V<n>O?`→`<x.xxx>V`, `I<n>O?`→`<x.xxx>A`, `OP<n> 0|1`, `OP<n>?`→`0|1`, `OPALL`, `OVP<n>/OCP<n>` set+sorgu (`VP<n> <x>`, `CP<n> <x>`), `LSR<n>?` (oku-ve-temizle), `TRIPRST`, `CONFIG?`/`CONFIG 0|2`, `SAV<n>/RCL<n>` (bellekte), `DELTAV/DELTAI/INCV/DECV/INCI/DECI`, `*RST`, `*CLS`, `EER?` (bilinmeyen/aralık dışı komutta kod birikir), `LOCAL`, `IFLOCK`→`1`, `IFUNLOCK`→`0`.
- Yük modeli (kanal başına `loadOhms`, varsayılan 8Ω): çıkış kapalı/tripli → 0V 0A; açıkken `i = vSet/load`; `i > iSet` ise CC: `i=iSet, v=iSet*load`; değilse CV: `v=vSet, i`. `v > ovp` → OVP trip (çıkış kapanır, LSR bit2 mandallanır); `i > ocp` → OCP trip (bit3). Trip `TRIPRST` ile temizlenir.
- Test uzantıları: `SIM:LOAD<n> <ohm>`, `SIM:TRIP<n> OVP|OCP` (zorla trip).
- LSR bitleri: bit0 CV'ye girdi, bit1 CC'ye girdi, bit2 OVP trip, bit3 OCP trip.

- [ ] **Step 1:** Failing testler: IDN; V/I set+sorgu formatları; CV senaryosu (8Ω, 5V, 2A → 5.000V/0.625A); CC senaryosu (8Ω, 30V set, 2A limit → 16.000V/2.000A); OVP trip (SIM:TRIP1 OVP → OP1? = 0, LSR1? bit2, ikinci LSR1? = 0); TRIPRST sonrası tekrar açılabilir; OPALL; *RST varsayılanlara döndürür (V=1V? — gerçek cihazda *RST: çıkışlar kapalı, setpointler korunur; simülatörde: çıkışlar kapalı + trip temiz yeterli); EER? bilinmeyen komutta >0 döner sonra 0.
- [ ] **Step 2:** FAIL doğrula. **Step 3:** Uygula, PASS. **Step 4:** Commit: `feat: cpx400dp protokol simülatörü`

### Task 5: Cpx400dpDriver (TDD, simülatöre karşı entegrasyon)

**Files:**
- Create: `src/main/drivers/types.ts`, `src/main/drivers/cpx400dp.ts`
- Test: `tests/driver.test.ts` (gerçek TCP üzerinden simülatöre bağlanır)

**Interfaces:**
- Consumes: `ScpiConnection`, simülatör.
- Produces:

```ts
// src/main/drivers/types.ts
export interface PsuDriver {
  readonly channelCount: number;
  identify(): Promise<string>;
  readChannel(ch: number): Promise<{ voltage: number; current: number; outputOn: boolean }>;
  readSetpoints(ch: number): Promise<ChannelSetpoints>;
  setVoltage(ch: number, v: number): Promise<void>;
  setCurrent(ch: number, a: number): Promise<void>;
  setOvp(ch: number, v: number): Promise<void>;
  setOcp(ch: number, a: number): Promise<void>;
  setOutput(ch: number, on: boolean): Promise<void>;
  setAllOutputs(on: boolean): Promise<void>;
  readLsr(ch: number): Promise<number>;
  tripReset(): Promise<void>;
  setTracking(on: boolean): Promise<void>;
  readTracking(): Promise<boolean>;
}
export function createDriver(kind: DeviceKind, conn: ScpiConnection): PsuDriver;
```

- Ayrıştırıcılar saf fonksiyon olarak dışa açılır (birim test için): `parseNamedValue('V1 5.000') → 5`, `parseSuffixed('5.001V') → 5.001`.
- Set komutlarında değerler `toFixed(3)` ile gönderilir; kanal 1..2 dışı `RangeError`.

- [ ] **Step 1:** Failing testler: identify; setVoltage→readSetpoints yansır; readChannel CV/CC değerleri simülatör modeliyle uyuşur; setOutput/OPALL; trip akışı (SIM:TRIP → LSR bit → tripReset → tekrar aç); parse fonksiyonları (bozuk girişte NaN yerine Error).
- [ ] **Step 2:** FAIL. **Step 3:** Uygula, PASS. **Step 4:** Commit: `feat: cpx400dp sürücüsü`

### Task 6: DeviceManager + kalıcılık + IPC + preload

**Files:**
- Create: `src/main/store.ts` (JSON dosya kalıcılığı), `src/main/deviceManager.ts`, `src/main/ipcHandlers.ts`
- Modify: `src/main/index.ts` (manager kurulumu), `src/preload/index.ts` (DeviceApi köprüsü)
- Test: `tests/deviceManager.test.ts` (simülatöre karşı: ekle→bağlan→snapshot gelir→setpoint→kopar)

**Interfaces:**
- Consumes: `ScpiConnection`, `createDriver`, `DeviceApi` sözleşmesi.
- Produces: `DeviceManager` — `EventEmitter`, `'snapshot'` (DeviceSnapshot) ve `'log'` (ScpiLogEntry) yayınlar; `DeviceApi`nin tüm metodlarını birebir uygular. Snapshot üretim kuralları:
  - Polling: bağlıyken 500ms'de bir kanal ölçümleri; her 4. döngüde LSR + tracking sorgusu; poll çakışması atlanır (in-flight bayrağı).
  - `mode`: çıkış kapalıysa `'off'`; açıkken `current >= iSet*0.98 && iSet > 0` ise `'cc'`, değilse `'cv'`.
  - Setpoint değişikliği sonrası anında setpoint'ler yeniden okunur ve snapshot yayınlanır (UI gecikmesiz doğrulanmış değer görür).
  - Art arda 3 query timeout → state `'reconnecting'`, soket kapatılıp üstel geri çekilmeyle (1s→2s→4s→…→max 15s) yeniden bağlanılır; kullanıcı `disconnect` deyince durur.
  - `sendRaw`: komut `?` içeriyorsa `query` sonucu, değilse `send` + `null`.
  - Store: `app.getPath('userData')/devices.json`; testte geçici dizin enjekte edilebilir (`new Store(dir)`).

- [ ] **Step 1:** Failing testler (manager'ı Electron'suz saf Node'da test et — `app` bağımlılığını constructor parametresiyle çöz).
- [ ] **Step 2:** FAIL. **Step 3:** Uygula (store → manager → ipcHandlers → preload), PASS; `npm run dev` ile pencere hâlâ açılıyor.
- [ ] **Step 4:** Commit: `feat: cihaz yöneticisi, kalıcılık ve ipc köprüsü`

### Task 7: Renderer kabuğu — tema, kenar çubuğu, cihaz ekleme

**Files:**
- Create: `src/renderer/src/styles/global.css` (design token'lar: renk, tipografi, aralık ölçeği)
- Create: `src/renderer/src/i18n/tr.ts` (tüm arayüz metinleri)
- Create: `src/renderer/src/state/store.ts` (zustand: devices, snapshots, logs, seçili cihaz)
- Create: `src/renderer/src/components/Sidebar.tsx`, `AddDeviceDialog.tsx`, `EmptyState.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: `window.deviceApi: DeviceApi` (preload), `DEVICE_TYPES`.
- Produces: `useAppStore` (zustand) — `devices`, `snapshots: Record<id, DeviceSnapshot>`, `selectedId`, `logs: Record<id, ScpiLogEntry[]>` (son 500), aksiyonlar (`refreshDevices`, `select`, `appendLog`...). App açılışta `listDevices` + `onSnapshot`/`onLog` abone olur.
- Görsel gereksinimler (frontend-design skill ile uygulanır): koyu, premium laboratuvar estetiği; kenar çubuğunda kategori başlığı **"Güç Kaynakları"**, cihaz satırlarında ad + host + durum noktası (bağlı=yeşil, bağlanıyor/yeniden=amber+nabız, hata=kırmızı, kopuk=gri); "Cihaz Ekle" diyaloğu (tür seçimi, ad, IP, port=9221 önseçili, IP format doğrulaması); cihaz yokken boş durum ekranı; cihaz satırı bağlam menüsü ya da satır içi eylemle silme (onaylı).

- [ ] **Step 1:** Metin modülü + token'lar + store'u yaz.
- [ ] **Step 2:** Bileşenleri uygula; simülatör + `npm run dev` ile elle doğrula: cihaz ekle → listede görünür → bağlan → durum yeşile döner → uygulamayı kapat/aç → cihaz kalıcı.
- [ ] **Step 3:** Commit: `feat: uygulama kabuğu, kenar çubuğu ve cihaz yönetimi arayüzü`

### Task 8: CPX400DP paneli — kanal kartları ve kontroller

**Files:**
- Create: `src/renderer/src/components/psu/PsuPanel.tsx`, `ChannelCard.tsx`, `SetpointField.tsx`, `TopBar.tsx` (panel üst şeridi)

**Interfaces:**
- Consumes: `useAppStore` snapshot'ları, `window.deviceApi` komutları.
- Produces/Davranış:
  - Üst şerit: cihaz adı + IDN, bağlan/kopar düğmesi, **Tümünü Aç / Tümünü Kapat** (OPALL), tracking anahtarı, bağlantı durumu; trip varsa tam genişlik kırmızı uyarı bandı ("Kanal 2: Aşırı akım koruması tetiklendi") + **Sıfırla (TRIPRST)** düğmesi.
  - Kanal kartı: büyük V/A ölçüm göstergeleri + hesaplanan W; CV/CC rozeti (CV=mavi, CC=amber); çıkış anahtarı (açıkken belirgin renk); `SetpointField` ×4 (V set, I set, OVP, OCP): yazı girişi (virgül→nokta), Enter/blur'da aralık doğrulaması + `deviceApi` çağrısı, ±adım düğmeleri (V: 0.1, I: 0.01), bekleyen değişiklik göstergesi (girilen ≠ cihazdaki iken vurgulu).
  - Bağlı değilken panel kontrolleri devre dışı + "Bağlı değil" durumu.
- [ ] **Step 1:** Bileşenleri uygula.
- [ ] **Step 2:** Simülatörle elle doğrula: V/I set → ölçümler modele uygun değişir; CC senaryosu rozeti; SIM:TRIP ile trip bandı + sıfırlama; OPALL.
- [ ] **Step 3:** Commit: `feat: cpx400dp kontrol paneli`

### Task 9: Trend grafiği + CSV + SCPI konsolu

**Files:**
- Create: `src/renderer/src/components/psu/TrendChart.tsx` (uPlot), `src/renderer/src/components/ScpiConsole.tsx`
- Create: `src/renderer/src/state/history.ts` (halka tampon)

**Interfaces:**
- Consumes: snapshot akışı, `sendRaw`, log akışı.
- Produces:
  - `history.ts`: cihaz başına halka tampon — `push(snapshot)`, kapasite 3600 örnek (~30 dk @ 500ms); `toCsv(deviceId): string` (`zaman;k1_v;k1_a;k2_v;k2_a` başlıklı, `\n` satırlı).
  - TrendChart: kanal başına V (sol eksen) ve I (sağ eksen) canlı çizgi; süre penceresi seçici (1dk/5dk/30dk); "CSV indir" (Blob + a[download]).
  - ScpiConsole (alttan açılır çekmece): komut girişi (Enter=gönder, ↑/↓ geçmiş), tx/rx renk ayrımlı zaman damgalı log, otomatik kaydırma.
- [ ] **Step 1:** `history.ts` için birim test (push/kapasite/toCsv formatı) → FAIL → uygula → PASS.
- [ ] **Step 2:** Bileşenleri uygula, simülatörle elle doğrula.
- [ ] **Step 3:** Commit: `feat: trend grafiği, csv dışa aktarım ve scpi konsolu`

### Task 10: Uçtan uca duman testi ve cila

- [ ] **Step 1:** `npm test` tam yeşil; `npm run build` temiz.
- [ ] **Step 2:** Mac'te tam akış: simülatörü 2 ayrı portta başlat → 2 cihaz ekle → ikisi aynı anda bağlı, panellerde bağımsız kontrol → simülatörü öldür → 'reconnecting' → tekrar başlat → otomatik bağlanır.
- [ ] **Step 3:** Görsel gözden geçirme (ekran görüntüleriyle): hizalama, boş durumlar, uzun cihaz adları, hata mesajları. Düzeltmeleri uygula.
- [ ] **Step 4:** Commit: `fix: duman testi bulguları ve görsel cila`

### Task 11: Windows paketleme + README

**Files:**
- Create: `electron-builder.yml` (appId `com.mpcukur.devicecontrol`, productName "Cihaz Kontrol", win: nsis + portable, x64), `build/icon.ico` (basit üretilmiş ikon)
- Create: `README.md` (kurulum, simülatörle test, saha kullanımı, komut referansı)

- [ ] **Step 1:** `npm run dist:win` → `release/` altında `.exe` üretildiğini doğrula (macOS'tan cross-build).
- [ ] **Step 2:** README yaz. **Step 3:** Commit: `build: windows x64 paketleme ve dokümantasyon`

## Self-Review Notları

- Spec kapsama: sürücü komut kapsamındaki `SAV/RCL`, `DELTAV/INC/DEC`, `IFLOCK` simülatörde var; arayüzde v1'de SAV/RCL ve adım komutları SCPI konsolundan kullanılabilir (özel UI YAGNI — spec "altyapı desteklesin" diyor, sürücü+konsol karşılıyor). CV/CC çıkarımı, EER kontrolü, trip akışı, tracking, CSV, konsol: Task 5/6/8/9'da karşılanıyor.
- Tip tutarlılığı: `DeviceApi` adları Task 2'de tanımlandı, Task 6 uygular, Task 7-9 tüketir.
