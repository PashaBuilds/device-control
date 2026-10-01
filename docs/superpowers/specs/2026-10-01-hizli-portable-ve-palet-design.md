# Hızlı taşınabilir exe + "Karma" renk paleti — tasarım

Tarih: 2026-10-01

İki bağımsız parça; tek sürümde (v0.10.0) çıkar.

---

## Parça 1 — Taşınabilir exe açılış hızı

### Ölçüm (v0.9.0, bu makine)

| Sürüm | Pencere görünene kadar |
|---|---|
| Taşınabilir exe (electron-builder) | 3,9–4,0 s, **her açılışta** |
| Kurulu (win-unpacked) | 0,6 s (soğuk 1,4 s) |

Renderer hızlı: süreçten sayfa yüklenmesine ~260 ms, DOMContentLoaded +110 ms.
Gecikmenin tamamı electron-builder taşınabilir şablonunun her açılışta 377 MB'ı
`%TEMP%`'e açması (ve kapanışta silmesi) + Defender'ın her seferinde taraması.
Şablon (`portable.nsi`) electron-builder'da sabit kodlu, özelleştirilemiyor.

Prototip ölçümleri (317 MB yük, önbellekli başlatıcı):

| Sıkıştırma | Exe | İlk açılış (sürüm başına 1 kez) | Sonraki |
|---|---|---|---|
| zlib | 140 MB | 6,7 s | **0,8 s** |
| LZMA (katı değil) | 102 MB | 13,4 s | 0,8 s |
| Yok | 332 MB | 4,5 s | 0,8 s |

### Kararlar

- Taşınabilir exe tek dağıtım biçimi olarak kalır (kurulumlu da üretilmeye devam eder).
- **Tek dil:** `electronLanguages: ['tr']` + ana süreçte
  `app.commandLine.appendSwitch('lang', 'tr')` (sistem dili ne olursa olsun tr.pak
  kullanılır; uygulama yerel biçimlendirme kullanmadığından ekranda değişiklik yok).
  −46 MB.
- **asar'dan tekrar eden node_modules çıkar:** runtime paketleri (react, react-dom,
  uplot, zustand, @fontsource/*) zaten Vite paketine gömülü; ana süreç/preload yalnız
  Node yerleşikleri + electron kullanır. Bu paketler `devDependencies`'e taşınır →
  app.asar 16 MB → 2 MB.
- **Önbellekli taşınabilir başlatıcı** (electron-builder'ın portable hedefi yerine):
  - Kendi NSIS betiğimiz `build/portable/portable.nsi`, electron-builder'ın indirdiği
    `makensis` ile `release/win-unpacked` üzerinden derlenir
    (`tools/build-portable.mjs`).
  - Hedef: `%LOCALAPPDATA%\CihazKontrol\app-<BUILD_ID>`; `BUILD_ID` =
    `<sürüm>-<app.asar sha256 ilk 10 hane>`.
  - Akış: `.ready` işareti ve `Cihaz Kontrol.exe` + `resources\app.asar` varsa doğrudan
    başlat. Yoksa: adlandırılmış mutex al (eşzamanlı ilk açılışlar birbirini bozmasın)
    → `app-<id>.tmp` oluştur → **ACL:** `icacls … /grant *S-1-15-2-1:(OI)(CI)(RX)`
    (Electron 43 sandbox, kurulum klasöründe "ALL APPLICATION PACKAGES" okuma izni
    ister; `%LOCALAPPDATA%` altında yoksa FATAL ile açılmaz — prototipte doğrulandı)
    → dosyaları aç → `Rename` ile `app-<id>` yap → `.ready` yaz → eski `app-*`
    klasörlerini sil (kullanımdaysa sessizce atla).
  - İlk açılışta küçük bir "Cihaz Kontrol ilk kez hazırlanıyor…" bildirimi
    (NSIS `Banner`), sonraki açılışlarda hiçbir pencere yok.
  - Komut satırı parametreleri uygulamaya aktarılır; başlatıcı `Exec` ile uygulamayı
    başlatıp hemen çıkar (bekleme yok, kapanışta silme yok).
  - `PORTABLE_EXECUTABLE_DIR/FILE/APP_FILENAME` ortam değişkenleri eskisi gibi
    ayarlanır (uygulama şu an kullanmıyor; davranış eşliği için).
  - Sıkıştırma: **zlib** (makul boyut, kısa ilk açılış). İkon ve dosya sürüm
    bilgisi (ürün adı, sürüm, telif) eklenir.
  - Çıktı adı değişmez: `CihazKontrol-<sürüm>-portable.exe`.
- Kullanıcı verisi yeri değişmez (`%APPDATA%\cihaz-kontrol`).

### Hedef

Önbellekli açılış ≤ 1 s (ölçülen 0,8 s); sürüm başına ilk açılış ≤ 7 s; tüm testler,
e2e ve paketlenmiş exe davranışı aynı.

---

## Parça 2 — "Karma" renk paleti (Spec2Code esintili)

### Yön

Spec2Code'un kimliği (grafit zemin, bakır vurgu, fosfor yeşili, amber, canlı veri
renkleri) + ölçüm okunabilirliği. Bakır = marka/eylem/odak; camgöbeği = gerilim;
amber = akım; fosfor = bağlı/açık; lila = prob/JTAG; mercan = tehlike.

Göz yormama kuralları: zemin saf siyah değil, metin saf beyaz değil; doygun renkler
yalnız veri ve etkin öğelerde; geniş yüzeyler sakin; tüm metin tokenları zemin
üzerinde **WCAG AA ≥ 4,5:1** (`--text-3` ipucu metni ≥ 3:1) — testle doğrulanır.

### Tokenlar

| Token | Koyu | Açık |
|---|---|---|
| `--bg-app` | `#0a0d12` | `#f4f2ee` |
| `--bg-panel` | `rgba(18,22,29,.74)` | `rgba(255,255,255,.74)` |
| `--bg-raised` | `rgba(24,29,38,.82)` | `rgba(255,255,255,.88)` |
| `--bg-inset` | `rgba(7,9,13,.78)` | `rgba(240,237,231,.9)` |
| `--bg-hover` | `rgba(32,39,50,.86)` | `rgba(232,228,221,.92)` |
| `--line` / `--line-strong` | `#222a35` / `#2e3846` | `#e2dcd3` / `#cfc7bb` |
| `--line-focus` | `#c98a55` | `#c27a40` |
| `--text-1/2/3` | `#e4e9ef` / `#97a2b0` / `#6b7684` | `#1b2129` / `#4c5663` / `#7a838e` |
| `--accent` (bakır) | `#ec9f5d` | `#a9601f` |
| `--volt` | `#46d3f5` | `#0a7c9f` |
| `--amp` / `--warn` | `#ffb454` | `#a35f00` |
| `--ok` | `#34e0a1` | `#0b8a5f` |
| `--danger` | `#ff5d7a` | `#c8304f` |
| `--probe` (yeni, lila) | `#a98bff` | `#6a4fd1` |

`*-dim` ve `--glow-*` tokenları `color-mix(in srgb, var(--x) N%, transparent)` ile
ana renklerden türetilir (koyu: dim %14, glow %55; açık: dim %12, glow %28).
Açık temadaki değerler AA testine göre son hâline ayarlanır.

### Uygulama

- `global.css`'te `:root` ve `:root[data-theme='light']` blokları yeni tokenlarla.
- Kural gövdelerindeki ~70 sabit renk (`rgba(94,193,242,…)`, `rgba(60,90,130,.12)`
  vb.) tokenlara / `color-mix`'e bağlanır; yeni sabit renk eklenmez (siyah/beyaz
  gölge ve parlama katmanları hariç).
- Atmosfer: zemin radyal gradyanları bakır (sağ üst) + camgöbeği (sol alt) + çok soluk
  lila; aurora katmanı camgöbeği + bakır. Yoğunluk bugünkünden yüksek değil.
- Bakır vurgu: birincil düğme, odak halkası, seçili kenar çubuğu öğesi, marka logosu
  ve başlık degradesi. Prob/JTAG görünümünde vurgu `--probe`.
- Trend grafiği renkleri sabit kodlu değil, CSS tokenlarından okunur ve tema
  değişince güncellenir.
- Pencere arka plan rengi (`BrowserWindow.backgroundColor`) yeni koyu zeminle eşleşir.

### Doğrulama

- `tests/palette.test.ts`: `global.css`'teki iki tema bloğunu ayrıştırır; metin ve
  veri tokenlarının `--bg-app` üzerindeki kontrastını hesaplar (AA).
- Ayrıca kural gövdelerinde eski paletin sabit renklerinin kalmadığını denetler.
- E2E ekran görüntüleri her iki temada gözle kontrol edilir.

---

## Sürüm

`0.10.0`; `npm run dist:win` = Vite derleme + electron-builder (kurulumlu NSIS +
win-unpacked) + önbellekli taşınabilir başlatıcı. GitHub release önceki biçimde.
