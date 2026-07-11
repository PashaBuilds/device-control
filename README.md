# Cihaz Kontrol

TCP/IP ağı üzerinden laboratuvar/saha cihazlarını kontrol eden masaüstü uygulaması.
İlk desteklenen cihaz: **Aim-TTi CPX400DP** çift kanallı güç kaynağı (2×60V/20A, 420W).

Mimari, yeni cihaz türlerinin (elektronik yük, sinyal üreteci vb.) *sürücü + panel*
çifti eklenerek genişletilmesine göre tasarlandı; kenar çubuğundaki **Güç Kaynakları**
kategorisinin yanına yeni kategoriler eklenebilir.

## Özellikler

- **Eşzamanlı çoklu cihaz**: birden fazla cihaz aynı anda bağlı kalır, her birinin
  kendi paneli vardır; bağlantı durumu kenar çubuğunda LED ile izlenir.
- **Kanal kontrolü**: gerilim/akım setpoint (yazarak veya adım tuşlarıyla), çıkış
  aç/kapa, OPALL, OVP/OCP koruma limitleri, CV/CC mod rozeti, izleme (tracking) modu.
- **Koruma**: trip (OVP/OCP) algılama, uyarı bandı ve tek tıkla TRIPRST.
- **Ayar kilidi**: cihazın fiziksel LOCK anahtarının yazılımsal karşılığı — kilitliyken
  gerilim/akım/OVP/OCP ve izleme modu değiştirilemez (arayüzde devre dışı kalır ve
  komut katmanında da reddedilir); çıkış aç/kapat ve trip sıfırlama çalışmaya devam
  eder. Kilit durumu cihaz kaydıyla birlikte kalıcıdır.
- **Trend grafiği**: kanal başına canlı V/I eğrileri (1/5/30 dk pencere), CSV dışa aktarım.
- **SCPI konsolu**: ham komut gönderme + tüm trafiğin zaman damgalı kaydı.
- **Dayanıklılık**: bağlantı kopunca üstel geri çekilme ile otomatik yeniden bağlanma;
  set komutları cihaz tarafında `EER?` ile doğrulanır.

## Geliştirme (macOS/Linux/Windows)

```bash
npm install
npm run dev          # Electron + Vite geliştirme modu
npm test             # birim/entegrasyon testleri (Vitest)
npm run typecheck    # TS denetimi
```

### CPX400DP simülatörü

Gerçek donanım olmadan geliştirme/test için gerçek protokolü konuşan TCP simülatörü:

```bash
npm run sim          # 127.0.0.1:9221 dinler (npm run sim -- 9222 ile port değişir)
```

Uygulamada cihaz eklerken IP `127.0.0.1`, port `9221` girin. Test uzantıları:
`SIM:LOAD1 8` (kanal 1 yükünü 8Ω yap), `SIM:TRIP1 OVP|OCP` (zorla trip).

Ayrıca renderer düz tarayıcıda açılırsa (Electron dışı) protokol modeli üzerinde
çalışan bir taklit `deviceApi` devreye girer — hızlı arayüz geliştirme içindir.

### Uçtan uca duman testi

```bash
npm run build && npm run e2e   # gerçek Electron + 2 TCP simülatörü, CDP ile sürülür
```

## Windows paketi üretme (macOS üzerinden)

```bash
npm run dist:win
```

`release/` altına NSIS kurulum sihirbazı ve taşınabilir `.exe` üretilir.
Paket imzasızdır; ilk çalıştırmada SmartScreen uyarısı normaldir
("Ek bilgi → Yine de çalıştır").

## Saha kullanımı (CPX400DP)

1. Güç kaynağının LAN ayarlarından IP adresini öğrenin (varsayılan port **9221**).
2. Uygulamada **Cihaz Ekle** → tür CPX400DP, IP ve portu girin.
3. **Bağlan**'a tıklayın; üst şeritte `*IDN?` kimliği görünmelidir.
4. Cihaz arka paneldeki kilit anahtarına ve `IFLOCK` durumuna göre uzaktan komutları
   reddedebilir; SCPI konsolundan `IFLOCK` göndererek arayüz kilidini alabilirsiniz.

## Mimari özet

```
src/main      Electron ana süreç: ScpiConnection (TCP 9221, komut kuyruğu),
              Cpx400dpDriver, DeviceManager (yoklama, yeniden bağlanma, kalıcılık)
src/preload   Tip güvenli IPC köprüsü (window.deviceApi)
src/renderer  React arayüz (kenar çubuğu, PSU paneli, trend, konsol)
src/shared    Ortak tipler + IPC sözleşmesi
tools/        CPX400DP simülatörü, E2E duman testi, ikon üretimi
docs/         Tasarım (spec) ve implementasyon planı
```

Yeni cihaz türü eklemek için: `src/shared/types.ts`teki `DEVICE_TYPES`e kayıt,
`src/main/drivers/` altına sürücü, `src/renderer/src/components/` altına panel.
