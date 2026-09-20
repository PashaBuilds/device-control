# CPX400DP ön panel serbest bırakma — tasarım

Tarih: 2026-09-20

## Sorun

Aim-TTi CPX400DP'de REMOTE/LOCAL durumu cihaz geneli, kanal başına değil.
Arayüzden gelen **her** bayt (yazma komutu da, ölçüm sorgusu da) cihazı
REMOTE'a alır ve ön paneli kilitler; `LOCAL` komutu paneli açar ama bir
sonraki gelen karakterle tekrar kilitlenir. Uygulama bağlıyken her 500 ms'de
~8 sorgu gönderdiği için panel pratikte hiç açılmaz: bir kullanıcı kanal 2'yi
uygulamadan sürerken, kanal 1'i panelden kullanmak isteyen ikinci kişi
çalışamaz.

## Hedef

CPX400DP bağlıyken ön panel zamanın ≈%98–99'unda serbest olsun; uygulama
kullanıcısının kendi işlemleri anında doğrulansın; cihazın güncel durumu en
fazla 10 s gecikmeyle görünsün.

## Kararlar (kullanıcıyla netleştirildi)

- Davranış CPX400DP için **her zaman açık**; cihaz başına anahtar yok.
- Yoklama aralığı **10 s**; her komut patlamasından sonra **`LOCAL`**.
- **Sadece CPX400DP.** Keysight E36233A ve SmartLynq bugünkü gibi 500 ms
  yoklamayla kalır; onlara asla `LOCAL`/`SYST:LOC` gönderilmez.
- Kapsam dışı: panelden yapılan değişiklik uyarısı, yoklamayı tamamen
  kapatma seçeneği, cihaz başına ayar.

## Tasarım

### 1. Cihaz türü bilgisi (`src/shared/types.ts`)

`DeviceTypeInfo`'ya iki alan:

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

Değerler: `cpx400dp` → `pollIntervalMs: 10000, idleCommand: 'LOCAL'`;
`e36233a` → `pollIntervalMs: 500`; `smartlynq` → `pollIntervalMs: 500`.

### 2. LOCAL mekanizması (`src/main/scpi/connection.ts`)

`ScpiConnectionOptions`'a `idleCommand?: string`. Kuyruk boşalıp
`inFlight` kalmadığında (yani `pump()` yapacak iş bulamadığında) ve son
yazılan satır zaten `idleCommand` değilse, `idleCommand` **bir kez** yazılır:
yanıt beklenmez, log kaynağı `'poll'` (SCPI konsolunda görünür, gizlenmez).
Art arda iki `LOCAL` gönderilmez. Bağlantı kapalıyken gönderilmez.

Bu tek mekanizma tüm yolları kapsar: bağlantı kurulumu (`*IDN?`, ilk
setpoint/tracking okuması), yoklama turu, kontrol komutları + `afterSet`
doğrulaması, SCPI konsolundan ham komutlar, trip sıfırlama.

`DeviceManager.connect`, `ScpiConnection`'ı `deviceTypeInfo(kind).idleCommand`
ile oluşturur.

### 3. Yoklama (`src/main/deviceManager.ts`)

- `startPolling` aralığı cihaz türünden alır:
  `opts.pollIntervalMs ?? deviceTypeInfo(dev.config.kind).pollIntervalMs`.
  Constructor seçeneği testler için geçersiz kılma olarak kalır (bugün
  `pollIntervalMs: 50` ile kullanılıyor).
- Trip/tracking denetimi bugün "her 4. turda" (500 ms × 4 = 2 s). CPX'te bu
  40 s olurdu; kural **"her 4. turda veya tur aralığı ≥ 2 s ise her turda"**
  olarak değişir. Bir CPX yoklama turu böylece 9 sorgu olur
  (2 kanal × [V?O, I?O, OP?] + 2 LSR + CONFIG) ≈ 100–200 ms.
- Bağlanınca ilk yoklama hemen yapılır (mevcut davranış), sonra aralıkla.
- Yeni genel metot `refresh(id)`: bağlıysa hemen bir yoklama turu çalıştırır
  (`poll(dev)`), meşgulse (pollBusy) sessizce döner.

### 4. IPC + arayüz

- Preload/IPC: `refreshDevice(id: string): Promise<void>`.
- `TopBar` (yalnızca `idleCommand` tanımlı türlerde): rozet
  **"Panel serbest · son okuma N s önce"** — `snapshot.timestamp`'ten,
  saniyede bir güncellenir — ve yanında **Yenile** düğmesi. Metinler
  `tr.panel` altına eklenir. Rozet bağlı değilken gizli.
- Trend grafiği değişmez; CPX'te 10 s örneklemle çalışır.

### 5. Simülatör (`tools/simulator/cpx400dp-sim.ts`)

REMOTE/LOCAL durumu: `remote` bayrağı; herhangi bir komut/sorgu alınca
`true`, `LOCAL` alınca `false`. Test için `SIM:REMOTE?` sorgusu (`0`/`1`)
— bu sorgu da gerçek cihazdaki gibi `remote=true` yapar, o yüzden testler
durumu `sim.remote` alanından okur; `SIM:REMOTE?` yalnızca e2e/elle deneme
için.

### 6. Testler

- `connection.test.ts`: (a) `idleCommand` verildiğinde kuyruk boşalınca bir
  kez yazılır; (b) art arda komutlarda araya girmez, sadece sonda;
  (c) tanımsızsa hiç yazılmaz; (d) art arda iki idle komut gönderilmez.
- `deviceManager.test.ts`: (e) CPX yoklama turu sonunda sim `remote=false`;
  (f) `setVoltage` sonrası `remote=false`; (g) `sendRaw` sonrası
  `remote=false`; (h) Keysight bağlantısında hiçbir zaman `LOCAL` gitmez
  (sim log'unda yok); (i) `refresh` hemen snapshot üretir;
  (j) CPX'te trip denetimi her turda yapılır.
- `simulator.test.ts`: REMOTE/LOCAL geçişi.
- E2E duman testi: Yenile düğmesine basılır, "son okuma" rozetinin
  sıfırlandığı doğrulanır.

## Zaman bütçesi (beklenti)

| Durum | Trafik | Kilitli süre |
|---|---|---|
| Boşta | 9 sorgu + LOCAL / 10 s | ~100–200 ms / 10 s → panel ≈ %98–99 serbest |
| Setpoint değişikliği | ~5 sorgu + LOCAL | ~80–150 ms, tek seferlik |
| Çıkış aç/kapa | ~15 sorgu + LOCAL | ~200–400 ms, tek seferlik |

Gerçek cihazda bir turun süresi SCPI konsolu zaman damgalarından ölçülüp
README'ye yazılacak.
