# Cihaz Kontrol

TCP/IP ağı üzerinden laboratuvar/saha cihazlarını kontrol eden masaüstü uygulaması.

Desteklenen cihazlar:
- **Aim-TTi CPX400DP** çift kanallı güç kaynağı (2×60V/20A, 420W) — SCPI, TCP 9221
- **Keysight E36233A** çift kanallı güç kaynağı (2×30V/10A) — SCPI (E36200), TCP 5025
- **Keysight N5745A** tek çıkışlı sistem güç kaynağı (30V/25A, 750W) — SCPI (N5700), TCP 5025
- **Xilinx Hardware Server** (hw_server / SmartLynq DLC20-DLC30) — TCF, TCP 3121

Mimari, yeni cihaz türlerinin *sürücü + panel* çifti eklenerek genişletilmesine göre
tasarlandı; kenar çubuğundaki **Güç Kaynakları** ve **Debug Probları** kategorilerinin
yanına yenileri eklenebilir.

## Özellikler

- **Eşzamanlı çoklu cihaz**: birden fazla cihaz aynı anda bağlı kalır, her birinin
  kendi paneli vardır; bağlantı durumu kenar çubuğunda LED ile izlenir.
- **Kanal kontrolü**: gerilim/akım setpoint (yazarak veya adım tuşlarıyla), çıkış
  aç/kapa, tümünü aç/kapat, OVP (ve destekleyen cihazda OCP) koruma, CV/CC mod rozeti.
  Arayüz cihazın yeteneklerine uyum sağlar: izleme (tracking) modu ve ayrı OCP alanı
  yalnızca bunları destekleyen cihazlarda (ör. CPX400DP) görünür.
- **Koruma**: trip (OVP/OCP) algılama, uyarı bandı ve tek tıkla TRIPRST.
- **Paylaşımlı ön panel (CPX400DP)**: uygulama cihazı 10 s'de bir okur ve her komuttan
  sonra `LOCAL` gönderir; ön panel zamanın ≈%98'inde serbesttir — bir kişi kanal 1'i
  panelden, diğeri kanal 2'yi uygulamadan kullanabilir. Üst çubuktaki **Yenile** anında
  okur; "son okuma N s önce" rozeti değerin tazeliğini gösterir.
- **Ayar kilidi**: cihazın fiziksel LOCK anahtarının yazılımsal karşılığı — kilitliyken
  gerilim/akım/OVP/OCP ve izleme modu değiştirilemez (arayüzde devre dışı kalır ve
  komut katmanında da reddedilir); çıkış aç/kapat ve trip sıfırlama çalışmaya devam
  eder. Kilit durumu cihaz kaydıyla birlikte kalıcıdır.
- **Açık/Koyu tema, "Karma" palet**: grafit (koyu) / sıcak kâğıt (açık) zemin, bakır
  marka ve eylem vurgusu; gerilim camgöbeği, akım amber, bağlı/açık fosfor yeşili, prob/JTAG
  lila. Tüm metin renkleri zeminde WCAG AA kontrastında (`tests/palette.test.ts`). Kenar
  çubuğu altındaki düğmeyle geçiş; tercih kalıcı, ilk açılışta sistem tercihine uyar. Her cihaz satırında ve panel başlığında cihaz **modeli** (ör.
  Aim-TTi CPX400DP / Keysight E36233A / Keysight N5745A) etiketle gösterilir.
- **Trend grafiği**: kanal başına canlı V/I eğrileri (1/5/30 dk pencere), CSV dışa aktarım.
- **SCPI konsolu**: ham komut gönderme + tüm trafiğin zaman damgalı kaydı.
- **Dayanıklılık**: bağlantı kopunca üstel geri çekilme ile otomatik yeniden bağlanma;
  set komutları cihaz tarafında `EER?` ile doğrulanır.
- **JTAG zinciri görselleştirme** (Hardware Server): zinciri TDI→cihaz→TDO şeması olarak,
  her hedefin IDCODE ve IR uzunluğuyla + canlı sağlık göstergesiyle gösterme.

> **Not (ağ keşfi):** Air-gapped/OT ortamlarında NAC/IDS'yi tetikleyip ağ kopmasına yol
> açtığı için otomatik ağ tarama/keşif özelliği kaldırılmıştır. Cihazlar IP ve port ile
> elle eklenir.

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
npm run sim:e36233a  # Keysight E36233A (SCPI), 127.0.0.1:5025
npm run sim:n5745a   # Keysight N5745A (SCPI), 127.0.0.1:5026
npm run sim:lynq     # Xilinx Hardware Server (TCF), 127.0.0.1:3121
```

CPX400DP / E36233A test uzantıları: `SIM:LOAD1 8` (kanal 1 yükünü 8Ω yap),
`SIM:TRIP1 OVP|OCP` (zorla trip). Hardware Server simülatörü Locator/Jtag servislerini
ve örnek bir zinciri (arm_dap + xc7z045) bildirir.

Ayrıca renderer düz tarayıcıda açılırsa (Electron dışı) protokol modeli üzerinde
çalışan bir taklit `deviceApi` devreye girer — hızlı arayüz geliştirme içindir.

### Uçtan uca duman testi

```bash
npm run build && npm run e2e   # gerçek Electron + 2 TCP simülatörü, CDP ile sürülür
```

## Windows paketi üretme

```bash
npm run dist:win
```

`release/` altına NSIS kurulum sihirbazı ve taşınabilir `.exe` üretilir (Windows'ta;
taşınabilir exe `tools/build-portable.mjs` ile, electron-builder'ın indirdiği NSIS kullanılarak
derlenir).

**Taşınabilir exe nasıl çalışır:** her sürümün ilk açılışında uygulama dosyaları
`%LOCALAPPDATA%\CihazKontrolpp-<sürüm>-<özet>` klasörüne bir kez açılır (~7 sn,
"ilk kez hazırlanıyor" bildirimi görünür). Sonraki açılışlarda bu adım atlanır ve uygulama
~1 sn'de açılır. Yeni sürüm ilk açıldığında eski sürüm klasörleri silinir. Kullanıcı
verileri (cihaz listesi vb.) her zamanki gibi `%APPDATA%\cihaz-kontrol` altındadır.
Paket imzasızdır; ilk çalıştırmada SmartScreen uyarısı normaldir
("Ek bilgi → Yine de çalıştır").

## Saha kullanımı (CPX400DP)

1. Güç kaynağının LAN ayarlarından IP adresini öğrenin (varsayılan port **9221**).
2. Uygulamada **Cihaz Ekle** → tür CPX400DP, IP ve portu girin.
3. **Bağlan**'a tıklayın; üst şeritte `*IDN?` kimliği görünmelidir.
4. Cihaz arka paneldeki kilit anahtarına ve `IFLOCK` durumuna göre uzaktan komutları
   reddedebilir; SCPI konsolundan `IFLOCK` göndererek arayüz kilidini alabilirsiniz.
5. Cihazın REMOTE/LOCAL durumu kanal başına değil cihaz genelidir. Uygulama bağlıyken
   ön panel yalnızca yoklama/komut anlarında (~0,1–0,4 s) kilitlenir; REMOTE lambası
   kısa yanıp söner. Paneldeki **OP ALL** tuşu iki kanalı birden kapatır — uygulamadan
   sürülen kanal da etkilenir; bu durum bir sonraki okumada (≤10 s veya **Yenile**) görünür.

## Saha kullanımı (Keysight E36233A)

1. Güç kaynağının LAN ayarlarından IP adresini öğrenin (raw-socket portu **5025**).
2. Uygulamada **Cihaz Ekle** → tür Keysight E36233A, IP ve portu girin.
3. **Bağlan** → üst şeritte `Keysight Technologies,E36233A,...` kimliği görünmelidir.

Not: E36200 serisinde OCP ayrı bir seviye değildir (akım limitinde tetiklenir) ve kanal
izleme modu yoktur; arayüz bu türde OCP alanını ve izleme anahtarını göstermez.

## Saha kullanımı (Keysight N5745A)

1. **Ağ:** uygulama yalnızca **TCP 5025**'i (SCPI soketi) kullanır. İsteğe bağlı: TCP 80
   (cihaz web sayfası), TCP 5024 (telnet).
2. **İlk bağlantı / MAC:** cihaz fabrikada DHCP açık gelir; DHCP yoksa AutoIP ile
   169.254.x.x alır (3 dk'ya kadar sürebilir). Ön panelde IP/MAC gösterilmez. PC'yi
   "IP'yi otomatik al"a alıp kabloyla bağlayın, cihaz açıldıktan sonra `arp -a` ile
   169.254.x.x satırındaki IP'yi ve fiziksel (MAC) adresi okuyun. Varsayılan ad:
   `A-N5745A-xxxxx` (xxxxx = seri no 5.–9. karakter).
3. **Sabit IP:** en kolayı DHCP'yi açık bırakıp MAC adresine DHCP rezervasyonu yaptırmak.
   Elle IP için cihaz web sayfası (View & Modify Configuration) kullanılır; sayfa eski
   Java eklentisi isteyebilir.
4. Uygulamada **Cihaz Ekle** → tür Keysight N5745A, IP ve port 5025.
5. Uzak modda cihazın ön panel tuşları **açık kalır**; uygulama paneli kilitlemez.
   OCP ayrı seviye değil, aç/kapattır ve uygulamada gösterilmez — gerekirse ön paneldeki
   OCP tuşuyla açılır; trip olursa uygulamada uyarı bandı çıkar ve sıfırlanabilir.

## Saha kullanımı (Xilinx Hardware Server)

1. Hardware Server'ı (SmartLynq / hw_server) ağa bağlayın; IP'sini öğrenin (port **3121**).
2. Uygulamada **Debug Probları → Cihaz Ekle** → tür Xilinx Hardware Server, IP ve port girin.
3. **Bağlan** → agent kimliği, TCF servisleri ve (bildirilirse) JTAG zinciri görünür.
4. Vivado Hardware Manager'da hedefi açmak için paneldeki bağlantı adresini (**Kopyala**)
   kullanabilirsiniz: Open Target → Add Xilinx Virtual Cable / hw_server → `ip:3121`.

Not: Bu sürüm Hardware Server'a "ulaş ve gör" kapsamındadır (bağlantı doğrulama, servis ve
zincir görünürlüğü). Asıl programlama/debug işlemleri Vivado/hw_server araçlarıyla yapılır.

## Mimari özet

```
src/main      Electron ana süreç:
              - scpi/  ScpiConnection (TCP 9221, komut kuyruğu)
              - tcf/   TcfConnection (TCP 3121, NUL/EOM çerçeveleme)
              - drivers/  Cpx400dpDriver, E36233aDriver, SmartLynqDriver (Hardware Server)
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
