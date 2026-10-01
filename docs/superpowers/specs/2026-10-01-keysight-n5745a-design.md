# Keysight N5745A desteği — tasarım

Tarih: 2026-10-01

## Amaç

Keysight N5745A (N5700 serisi, tek çıkış, 30 V / 25 A, 750 W, LXI) sistem
güç kaynağını LAN üzerinden — mevcut CPX400DP ve E36233A gibi — uygulamadan
kontrol etmek.

## Cihaz gerçekleri (Keysight N5700 User's Guide)

- **LAN:** SCPI raw socket **TCP 5025** (komut/yanıt LF ile biter); telnet
  5024; web sunucusu 80. Aynı anda en fazla 3 soket/telnet bağlantısı.
- **Fabrika ağ ayarı:** DHCP açık; DHCP yoksa AutoIP ile 169.254.x.x (3 dk'ya
  kadar sürebilir). Varsayılan hostname `A-N5745A-xxxxx` (xxxxx = seri no
  5.–9. karakter). Ön panelde IP/MAC gösterimi yok.
- **Uzak/yerel:** `SYST:COMM:RLST REMote` durumunda ön panel tuşları **aktif
  kalır**; yalnızca `RWLock` kilitler. Uygulama RLST göndermez → CPX'teki
  LOCAL/seyrek yoklama düzenine gerek yok.
- **Aralıklar (30 V modeli):** gerilim 0–31,5 V (ayrıca ≤ OVP/1,05), OVP
  2–36 V (ayrıca ≥ Vset×1,05), akım 0–25 A (anma).
- **OCP:** ayrı seviye yok; `CURR:PROT:STAT ON|OFF` — açıkken CC'ye girince
  çıkış kesilir.
- **Durum:** `STAT:QUES:COND?` bit0 = OV, bit1 = OC (4 = PF, 16 = OT).
  Koruma mandalı `OUTP:PROT:CLE` ile temizlenir.
- **Kimlik:** `*IDN?` → `Agilent Technologies,N5745A,<seri|0>,<fw>,<fw>`
  (yeni cihazlarda "Keysight Technologies").

## Kararlar (kullanıcıyla netleştirildi)

- OCP arayüzde **gizli** (E36233A ile aynı: `hasOcpLevel: false`); OCP
  ön panelden açılırsa trip yine algılanır ve uyarı bandında görünür.
- Panel serbest bırakma yok; 500 ms canlı yoklama.
- Kapsam dışı: OCP anahtarı, diğer N5700 modelleri, web arayüzünden IP ayarı.

## Tasarım

### 1. Cihaz türü (`src/shared/types.ts`)

`DeviceKind`'a `'n5745a'`. `DEVICE_TYPES` girdisi: label `Keysight N5745A`,
`power-supply`, `channelCount: 1`, `maxVoltage: 30`, `maxCurrent: 25`,
`maxOvp: 36`, `maxOcp: 0`, `defaultPort: 5025`, `hasTracking: false`,
`hasOcpLevel: false`, `pollIntervalMs: 500`, `idleCommand` yok.

### 2. Sürücü (`src/main/drivers/n5700.ts`)

`N5700Driver implements PsuDriver`, `channelCount = 1`, yalnızca kanal 1
kabul eder (`RangeError` aksi halde). Listesiz SCPI:

| Metot | Komut |
|---|---|
| identify | `*IDN?` |
| readChannel | `MEAS:VOLT?`, `MEAS:CURR?`, `OUTP?` |
| readSetpoints | `VOLT?`, `CURR?`, `VOLT:PROT?`; `ocp: 0` |
| setVoltage/Current/Ovp | `VOLT x`, `CURR x`, `VOLT:PROT x` (4 ondalık) |
| setOcp | işlem yok (arayüzde alan yok) |
| setOutput / setAllOutputs | `OUTP ON|OFF` |
| readLsr | `STAT:QUES:COND?` → OV→`LSR_OVP`(4), OC→`LSR_OCP`(8) |
| tripReset | `OUTP:PROT:CLE` |
| setTracking / readTracking | işlem yok / `false` |
| readExecutionError | `SYST:ERR?` → mutlak kod |

`createDriver` (`cpx400dp.ts`) `'n5745a'` için `N5700Driver` döndürür.

### 3. Arayüz

- Cihaz Ekle diyaloğu `DEVICE_TYPES`'tan beslendiği için yeni tür otomatik
  görünür.
- `TopBar`: `channelCount === 1` ise **Tümünü Aç / Tümünü Kapat** gizlenir.
- Kanal kartı grid'i (`auto-fit`) tek kartı tam genişlikte gösterir; değişiklik
  gerekmez.

### 4. Simülatör

- `tools/simulator/n5745a-model.ts`: `N5745aSim` — tek kanal, omik yük
  (varsayılan 10 Ω), CC, OVP/OCP trip, `STAT:QUES:COND?`, `OUTP:PROT:CLE`,
  aralık dışı değerlerde `-222` hatası, tanınmayan komutta `-113`, kısa/uzun
  SCPI biçimleri. Test kancaları: `SIM:LOAD <ohm>`, `SIM:TRIP OVP|OCP`.
- `tools/simulator/n5745a-sim.ts` (TCP sunucu), `n5745a-cli.ts`,
  `npm run sim:n5745a` → varsayılan 127.0.0.1:**5026** (E36233A
  simülatörüyle çakışmasın).
- Tarayıcı mock API'sine `n5745a` lehçesi ve trip okuma eklenir.

### 5. Testler

- `tests/n5745a-sim.test.ts`: model davranışı (ölçüm, CC, OVP/OCP trip,
  temizleme, aralık hataları, durum bitleri).
- `tests/n5700-driver.test.ts`: simülatöre karşı sürücü (kimlik, ölçüm,
  setpoint, trip→LSR eşleme, sıfırlama, aralık hatası, kanal 2 reddi).
- `tests/deviceManager.test.ts`: N5745A bağlan → snapshot 1 kanal; LOCAL
  gönderilmez.
- E2E: N5745A ekle → bağlan → 12 V ölçümü → tek kanal kartı, Tümünü Aç yok,
  OCP alanı yok.

### 6. Belgeler ve sürüm

README: cihaz listesi, simülatör komutu, **Saha kullanımı (N5745A)** (port
5025, DHCP rezervasyonu önerisi, `arp -a` ile IP/MAC bulma, varsayılan
hostname, ön panelin uzak modda açık kalması). Sürüm 0.9.0 + GitHub release.
