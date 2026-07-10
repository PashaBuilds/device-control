# Cihaz Kontrol Arayüzü — Tasarım Dokümanı

**Tarih:** 2026-07-10
**Durum:** Onaylandı (kullanıcı onayı alındı)

## Amaç

TCP/IP ağı üzerinden bağlanan laboratuvar/saha cihazlarını kontrol eden, Windows hedefli
masaüstü uygulaması. İlk desteklenen cihaz: **Aim-TTi CPX400DP** çift kanallı güç kaynağı
(2×60V/20A, 420W PowerFlex). Mimari, ileride farklı cihaz türlerinin (elektronik yük,
sinyal üreteci vb.) eklenmesine izin verecek şekilde kategorili ve sürücü tabanlıdır.

## Kararlar

| Karar | Seçim |
|---|---|
| Teknoloji | Electron + React + TypeScript + Vite |
| Arayüz dili | Türkçe |
| Çoklu cihaz | Evet — eşzamanlı birden fazla bağlantı |
| Hedef platform | Windows x64 (geliştirme/test: macOS) |
| Görsel dil | Koyu tema ağırlıklı, sade, premium laboratuvar estetiği |

## Mimari

```
┌──────────────────────────── Electron Main ────────────────────────────┐
│  DeviceManager                                                        │
│   ├── Device kayıtları (JSON kalıcılık, userData/devices.json)        │
│   ├── Cihaz başına: ScpiConnection (node:net TCP, komut kuyruğu)      │
│   └── Cihaz başına: Driver (Cpx400dpDriver) + PollingLoop (~500ms)    │
│  IPC (contextBridge ile tip güvenli köprü)                            │
└───────────────────────────────────┬───────────────────────────────────┘
                                    │ events: durum, ölçümler, hatalar
                                    │ invoke: bağlan, setpoint, çıkış vb.
┌───────────────────────────────────┴───────────────────────────────────┐
│  Renderer (React)                                                     │
│   ├── Kenar çubuğu: kategoriler → cihaz listesi + durum göstergeleri  │
│   ├── Cihaz paneli: kanal kartları, ana kontroller, trend grafiği     │
│   └── SCPI konsolu (gelişmiş kullanım)                                │
└────────────────────────────────────────────────────────────────────────┘
```

### Katmanlar ve sorumluluklar

- **ScpiConnection** (`src/main/scpi/connection.ts`): Ham TCP soket. Komutları kuyruğa
  alır; sorgu (`?` içeren) komutlarda yanıt bekler, set komutlarında beklemez. Cihaz
  sorguları sırayla yanıtladığı için kuyruk FIFO'dur. Satır sonu: gönderim `\n`,
  yanıt `\r\n`. Zaman aşımı (varsayılan 3 sn), bağlantı kopmasında otomatik yeniden
  bağlanma (üstel geri çekilme, kullanıcı koparana dek).
- **Driver arayüzü** (`src/shared/driver.ts`): `identify()`, `readMeasurements()`,
  `applySetpoint()`, vb. Cihaz türü tanımı: kategori, kanal sayısı, V/I aralıkları,
  yetenek bayrakları. UI paneli cihaz türüne göre seçilir.
- **Cpx400dpDriver** (`src/main/drivers/cpx400dp.ts`): CPX400DP komut seti (aşağıda).
- **DeviceManager** (`src/main/deviceManager.ts`): Cihaz ekle/sil/düzenle,
  bağlantı yaşam döngüsü, ölçüm olaylarını renderer'a yayınlama.

## CPX400DP Protokolü

- **Taşıma:** Ham TCP, varsayılan port **9221**. ASCII komutlar.
- **Kimlik:** `*IDN?` → `THURLBY THANDAR, CPX400DP, <seri>, <sürüm>`
- **Komut kapsamı (v1):**
  - Setpoint: `V<n> <v>`, `I<n> <a>`; sorgu `V<n>?` → `V<n> <nr2>`, `I<n>?`
  - Ölçüm: `V<n>O?` → `<nr2>V`, `I<n>O?` → `<nr2>A` (güç W = V×I hesaplanır)
  - Çıkış: `OP<n> 0|1`, `OP<n>?`, `OPALL 0|1`
  - Koruma: `OVP<n> <v>`, `OCP<n> <a>`, sorguları; trip temizleme `TRIPRST`
  - Durum: `LSR<n>?` (limit status register — trip bitleri; oku-ve-temizle olduğu
    için yalnızca trip tespiti amaçlı seyrek yoklanır), `EER?` (execution error)
  - Mod: `CONFIG?` / `CONFIG 0|2` (0 = izleme/tracking, 2 = bağımsız çift çıkış)
  - Hafıza: `SAV<n> 0-9`, `RCL<n> 0-9`
  - Adım: `DELTAV<n>`, `DELTAI<n>`, `INCV<n>`, `DECV<n>`, `INCI<n>`, `DECI<n>`
  - Sistem: `*RST`, `*CLS`, `LOCAL`, `IFLOCK`/`IFUNLOCK`
- **CV/CC göstergesi:** CPX400DP anlık regülasyon modunu doğrudan sorgulamaz; LSR
  bitleri olay-mandallıdır. Mod, ölçümlerden türetilir: çıkış açıkken ölçülen akım
  akım limitine yakınsa (≥ %98) **CC**, değilse **CV** rozeti gösterilir.
- **Polling:** ~500ms döngüde `V1O? I1O? V2O? I2O? OP1? OP2?`; ~2 sn'de bir `LSR<n>?`
  (trip tespiti). Kullanıcı komutları polling kuyruğunun önüne alınır.

## Arayüz Tasarımı

- **Kenar çubuğu:** Kategori başlıkları ("Güç Kaynakları"; mimari yeni kategorilere
  hazır). Her cihaz satırı: ad, IP, bağlantı durumu (renkli nokta: bağlı/bağlanıyor/
  kopuk/hata). "Cihaz Ekle" düğmesi → tür (CPX400DP), ad, IP, port (varsayılan 9221).
- **Cihaz paneli (CPX400DP):**
  - Üst şerit: cihaz adı, *IDN bilgisi, bağlan/kopar, "Tümü Aç/Kapat" (OPALL),
    tracking modu seçici, trip uyarı bandı + TRIPRST düğmesi.
  - **Kanal kartı ×2:** büyük dijital ölçüm göstergeleri (V, A, W — tabular rakam),
    CV/CC rozeti, çıkış aç/kapa anahtarı, V/I setpoint girişleri (yazarak + adım
    düğmeleri, Enter ile uygula), OVP/OCP alanları.
  - **Trend grafiği:** kanal başına V ve I zaman serisi (uygulama içi halka tampon,
    ~30 dk), CSV dışa aktarım.
  - **SCPI konsolu (çekmece):** ham komut gönder, yanıt ve gönderilen tüm komutların
    zaman damgalı kaydını gör.
- Sayısal girişlerde aralık doğrulaması (0–60V, 0–20A) ve virgül/nokta toleransı.

## Kalıcılık

- `userData/devices.json`: cihaz listesi (id, ad, tür, ip, port, son ayarlar).
- Uygulama ayarları (tema vb.) aynı dizinde `settings.json`.

## Hata Yönetimi

- Bağlantı hataları: durum göstergesi + panelde açıklayıcı Türkçe mesaj; otomatik
  yeniden bağlanma denemeleri görünür.
- Komut zaman aşımı: ilgili istek reddedilir, kuyruk temizlenmez; art arda 3 zaman
  aşımında bağlantı "sorunlu" işaretlenip yeniden kurulur.
- Set komutlarından sonra `EER?` ile cihaz tarafı hata kontrolü (ör. aralık dışı değer).
- Trip (OVP/OCP): panelde belirgin uyarı bandı, tek tıkla `TRIPRST`.

## Test Stratejisi

- **CPX400DP simülatörü** (`tools/simulator/`): Gerçek protokolü konuşan Node TCP
  sunucusu. Kanal başına sanal yük direnci modeli: `I = V/R`, `I > Ilim` ise CC
  (V = Ilim×R). `SIM:` önekli test-özel komutlarla yük/trip senaryoları tetiklenir
  (gerçek sürücü asla `SIM:` göndermez).
- **Birim testleri (Vitest):** yanıt ayrıştırıcılar, komut kuyruğu, sürücü ↔
  simülatör entegrasyonu (gerçek TCP üzerinden).
- **Mac'te canlı doğrulama:** Electron uygulaması macOS'ta simülatöre karşı çalıştırılıp
  arayüz elle/görsel doğrulanır.
- **Saha testi:** Windows paketi kullanıcı tarafından gerçek CPX400DP ile test edilir;
  geri bildirime göre düzeltme yapılır.

## Paketleme

- `electron-builder` ile macOS üzerinden **Windows x64 NSIS installer** (+ portable
  .exe) üretimi. Kod imzalama v1 kapsamı dışında.

## Kapsam Dışı (v1)

- Cihaz otomatik keşfi (mDNS/VXI-11) — manuel IP girişi yeterli.
- Türkçe dışında dil (i18n altyapısı kurulmayacak; metinler tek modülde toplanacak
  ki ileride kolay eklensin).
- Betikleme/sekans otomasyonu, USB/RS-232 taşıma katmanları.
