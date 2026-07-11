# Cihaz Kontrol

TCP/IP ağı üzerinden laboratuvar/saha cihazlarını kontrol eden masaüstü uygulaması.

Desteklenen cihazlar:
- **Aim-TTi CPX400DP** çift kanallı güç kaynağı (2×60V/20A, 420W) — SCPI, TCP 9221
- **Xilinx SmartLynq** JTAG/debug probu (DLC20/DLC30) — TCF/hw_server, TCP 3121

Mimari, yeni cihaz türlerinin *sürücü + panel* çifti eklenerek genişletilmesine göre
tasarlandı; kenar çubuğundaki **Güç Kaynakları** ve **Debug Probları** kategorilerinin
yanına yenileri eklenebilir.

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

### Simülatörler

Gerçek donanım olmadan geliştirme/test için gerçek protokolleri konuşan TCP simülatörleri:

```bash
npm run sim          # CPX400DP (SCPI), 127.0.0.1:9221 (npm run sim -- 9222 ile port değişir)
npm run sim:lynq     # SmartLynq (TCF/hw_server), 127.0.0.1:3121
```

CPX400DP test uzantıları: `SIM:LOAD1 8` (kanal 1 yükünü 8Ω yap), `SIM:TRIP1 OVP|OCP`
(zorla trip). SmartLynq simülatörü Locator/Jtag servislerini ve örnek bir xc7z045
zincirini bildirir.

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

## Saha kullanımı (SmartLynq)

1. SmartLynq'i ağa bağlayın; IP'sini öğrenin (hw_server portu varsayılan **3121**).
2. Uygulamada **Debug Probları → Cihaz Ekle** → tür Xilinx SmartLynq, IP ve port girin.
3. **Bağlan** → agent kimliği, TCF servisleri ve (bildirilirse) JTAG zinciri görünür.
4. Vivado Hardware Manager'da hedefi açmak için paneldeki bağlantı adresini (**Kopyala**)
   kullanabilirsiniz: Open Target → Add Xilinx Virtual Cable / hw_server → `ip:3121`.

Not: Bu sürüm SmartLynq'e "ulaş ve gör" kapsamındadır (bağlantı doğrulama, servis ve
zincir görünürlüğü). Asıl programlama/debug işlemleri Vivado/hw_server araçlarıyla yapılır.

## Mimari özet

```
src/main      Electron ana süreç:
              - scpi/  ScpiConnection (TCP 9221, komut kuyruğu)
              - tcf/   TcfConnection (TCP 3121, NUL/EOM çerçeveleme)
              - drivers/  Cpx400dpDriver, SmartLynqDriver
              - DeviceManager (yoklama, yeniden bağlanma, kalıcılık, kilit)
src/preload   Tip güvenli IPC köprüsü (window.deviceApi)
src/renderer  React arayüz (kenar çubuğu, PSU paneli, probe paneli, trend, konsol)
src/shared    Ortak tipler + IPC sözleşmesi
tools/        CPX400DP + SmartLynq simülatörleri, E2E duman testi, ikon üretimi
docs/         Tasarım (spec) ve implementasyon planı
```

Yeni cihaz türü eklemek için: `src/shared/types.ts`teki `DEVICE_TYPES`e kayıt (kategori),
`src/main/drivers/` altına sürücü, `src/renderer/src/components/` altına panel; App
kategoriye göre paneli seçer.
