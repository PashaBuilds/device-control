# Mini-Circuits SSG-6000RC / SSG-15G-RC — USB kontrol tasarımı

> **Güncelleme (v0.12.0):** Aşağıdaki ilk tasarım "kod 1 + SCPI metni" biçimini varsayıyordu;
> sahada iki cihaz da bu biçime ikili veriyle yanıt verdi. Programlama kılavuzu (C3) bölüm 5'e
> göre SSG'ler USB'de **ikili kesme kodları** kullanır: 40 model, 41 seri, 99 ürün yazılımı,
> 101 frekans (SSG-6000: 5 bayt Hz; diğerleri: ASCII MHz), 102 güç (işaret + |dBm|×100),
> 104 RF, 105 durum; SCPI SSG-6000'de kod 121 (+uzunluk), diğerlerinde kod 42. Sürücü
> (`src/main/hid/ssgProtocol.ts`, `drivers/ssg.ts`) ve simülatör buna göre yeniden yazıldı;
> testler kılavuzdaki örnek paketleri birebir kullanır. Aşağıdaki "Protokol" bölümü
> tarihsel kayıttır.

**Tarih:** 2026-10-10 · **Sürüm:** 0.11.0

## Amaç

İki Mini-Circuits sentezlenmiş sinyal üretecini (SSG-6000RC: 25–6000 MHz, −65…+14 dBm;
SSG-15G-RC: 10 MHz–15 GHz, −45…+10 dBm) **USB** ile bağlayıp frekans, güç ve RF çıkışını
ayarlayan basit bir arayüz. Ağ (LAN) kontrolü bu kapsamda değil.

## Protokol

- Cihazlar sürücüsüz **HID** sınıfındadır, Mini-Circuits VID'i **0x20CE**. PID modele göre
  değişebildiği için sabitlenmez: VID ile listelenen her arayüz açılıp `:MN?` ile tanınır.
- Her komut 64 baytlık çıkış raporudur: **bayt 0 = 1** ("SCPI komutu gönder"), bayt 1'den
  itibaren ASCII komut, kalanı 0. Yazarken başa 0x00 rapor kimliği eklenir (hidapi kuralı).
- Cihaz bayt 0'ı aynı kod olan 64 baytlık raporla yanıtlar; metin bayt 1'den ilk NUL'a kadardır.
  Set komutları da yanıt üretir, bu yüzden her komut istek/yanıt olarak işlenir.
- Kullanılan komutlar: `:MN?`, `:SN?`, `:FIRMWARE?`, `:FREQ:<MHz>MHz`, `:FREQ?`,
  `:PWR:<dBm>`, `:PWR?`, `:PWR:RF:ON|OFF`, `:PWR:RF?`.

Kaynaklar: Mini-Circuits'in USB-HID SCPI çerçevesi (QCodes `MiniCircuitsHIDMixin`, kod 1),
SSG programlama kılavuzundaki `:FREQ:[freq][units]` / `:PWR` / `:MN?` biçimleri ve
SSG-6000RC veri sayfası (aralık, 0,25 dB adım). Kılavuzun tam metni geliştirme ortamından
indirilemedi; bu yüzden **yanıt biçimleri toleranslı ayrıştırılır**:

| Yanıt | Kabul edilen biçimler |
|---|---|
| `:MN?` / `:SN?` | `SSG-6000RC` veya `MN=SSG-6000RC` |
| `:FREQ?` | birimli (`2.4 GHz`), birimsiz Hz (≥ 100 000) veya birimsiz MHz |
| `:PWR?` | ilk sayı (`-7.50`, `PWR=-7.5`) |
| `:PWR:RF?` | `ON`/`OFF` ya da `1`/`0` |
| set komutları | `0 …` veya hata metni → ret; diğer her şey (boş dahil) → başarı |

Okunamayan alan son bilinen değeri korur; bağlantıyı düşürmez.

## Mimari

- `src/main/hid/mcl.ts`: çerçeveleme, `mclTransact` (eski raporları boşalt → yaz → kod 1
  yanıtını bekle), `discoverMclDevices` (model/seri; yanıt vermeyen cihaz "tanınmadı"
  olarak PID ile listelenir), `HidBackend` soyutlaması ve node-hid arka ucu (tembel yükleme).
- `src/main/hid/connection.ts`: `HidScpiConnection` — ScpiConnection'ın USB karşılığı; tek
  sıra, zaman aşımı sayacı, G/Ç hatasında `close` (kablo çekildi → yeniden bağlanma).
- `src/main/drivers/ssg.ts`: `SsgDriver` + ayrıştırıcılar.
- `DeviceManager`: yeni `signal-generator` kategorisi; bağlanırken tarar, türe ve (varsa) seri
  numarasına göre seçer, başka kayıtların açık tuttuğu cihazı açmaz. 1 s'de bir durum okur.
  Aralık denetimi cihaza gitmeden yapılır; ayar kilidi frekans/gücü kilitler, RF anahtarını değil.
- Kayıt: `DeviceConfig.usbSerial` (boş = ilk bulunan), `host`/`port` USB'de kullanılmaz.
- Arayüz: `SigGenPanel` (frekans/güç göstergesi + alanlar, RF düğmesi, SCPI konsolu),
  cihaz ekleme penceresinde USB taraması ve seri seçimi.
- Paketleme: `node-hid` N-API hazır ikilileriyle gelir → `npmRebuild: false` (Visual Studio
  araçları gerekmez), `asarUnpack: node_modules/node-hid/**`.
- Test/geliştirme: `tools/simulator/ssg-model.ts` (SCPI modeli) + `ssg-hid.ts` (sahte HID
  arka ucu). `DC_FAKE_HID=1` uygulamayı donanımsız çalıştırır; E2E bunu kullanır.

## Donanımla ilk deneme listesi

1. Ekleme penceresinde iki cihaz model ve seri numarasıyla listeleniyor mu?
   "SCPI'ye yanıt vermedi" uyarısı çıkarsa: cihaz eski ikili (interrupt kodlu) protokolü
   konuşuyor demektir → kılavuzdaki kod tablosuyla ikinci bir sürücü yolu eklenir.
2. Bağlanınca kimlik satırı ve frekans/güç değerleri gerçekçi mi? Değilse SCPI konsolunda
   `:FREQ?`, `:PWR?`, `:PWR:RF?` yanıtlarını not edin (ayrıştırıcı ona göre düzeltilir).
3. Frekans/güç yazınca cihaz çıkışı değişiyor mu; RF düğmesi çıkışı açıp kapatıyor mu?
4. Kablo çekilince "Yeniden bağlanıyor", takılınca "Bağlı" oluyor mu?
