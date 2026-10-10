# Çalışma kuralları

- **Doğrudan `main`.** Her geliştirme `main`'e girer. Doğrudan gönderim mümkün değilse
  (bulut oturumu yalnızca kendi dalına gönderebiliyorsa) dal → PR → hemen birleştir.
- **Her geliştirme bir release.** `main`'e giden her değişiklikte:
  1. `package.json` sürümünü artır (`npm install --package-lock-only` ile kilit dosyası da),
     yeni özellik → minor, düzeltme → patch.
  2. `docs/releases/v<sürüm>.md` yaz: ilk satır `# Cihaz Kontrol v<sürüm> — <özet>`, sonra
     önceki notlarla aynı biçimde Türkçe gövde (ne değişti, Windows x64 dosyaları, doğrulama).
  3. `main`'e gelince `.github/workflows/release.yml` Windows'ta test edip `npm run dist:win`
     ile derler ve `v<sürüm>` release'ini (kurulum + taşınabilir exe) yayınlar. Etiket elle
     oluşturulmaz; etiketi olan sürüm yeniden yayınlanmaz.
- Göndermeden önce: `npm run typecheck`, `npm test`, gerekirse `npm run build && npm run e2e`.
- Arayüz metinleri, commit mesajları ve belgeler Türkçe.
