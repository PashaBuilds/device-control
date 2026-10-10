import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeBuildId, findMakensis, makensisArgs, resolveMakensis, versionQuad } from '../tools/build-portable.mjs'

describe('build-portable yardımcıları', () => {
  it('BUILD_ID sürüm + içerik özetinden belirlenir', () => {
    const a = computeBuildId('0.10.0', Buffer.from('asar-a'))
    expect(a).toMatch(/^0\.10\.0-[0-9a-f]{10}$/)
    expect(computeBuildId('0.10.0', Buffer.from('asar-a'))).toBe(a)
    expect(computeBuildId('0.10.0', Buffer.from('asar-b'))).not.toBe(a)
  })

  it('sürüm dört parçalı Windows sürümüne çevrilir', () => {
    expect(versionQuad('0.10.0')).toBe('0.10.0.0')
    expect(versionQuad('1.2.3-beta.1')).toBe('1.2.3.0')
  })

  it('makensis electron-builder önbelleğinde bulunur (en yeni sürüm)', () => {
    const root = mkdtempSync(join(tmpdir(), 'ebcache-'))
    for (const v of ['nsis-3.0.4.1', 'nsis-3.0.5.0']) {
      mkdirSync(join(root, 'nsis', v, 'Bin'), { recursive: true })
      writeFileSync(join(root, 'nsis', v, 'Bin', 'makensis.exe'), '')
    }
    expect(findMakensis(root)).toBe(join(root, 'nsis', 'nsis-3.0.5.0', 'Bin', 'makensis.exe'))
  })

  it('makensis önce electron-builder çözümleyicisinden alınır (yeni önbellek düzeni)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ebcache-'))
    const dir = join(root, 'nsis-3.0.4.1', 'nsis-3.0.4.1-abc12', 'Bin')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'makensis.exe'), '')
    const env = { NSISDIR: join(root, 'nsis-3.0.4.1', 'nsis-3.0.4.1-abc12') }
    const found = await resolveMakensis(root, () => ({
      getMakeNsisPath: async () => ({ path: join(dir, 'makensis.exe'), env })
    }))
    expect(found).toEqual({ path: join(dir, 'makensis.exe'), env })
  })

  it('çözümleyici başarısızsa eski önbellek düzenine düşer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ebcache-'))
    mkdirSync(join(root, 'nsis', 'nsis-3.0.4.1', 'Bin'), { recursive: true })
    writeFileSync(join(root, 'nsis', 'nsis-3.0.4.1', 'Bin', 'makensis.exe'), '')
    const found = await resolveMakensis(root, () => {
      throw new Error('modül yok')
    })
    expect(found).toEqual({ path: join(root, 'nsis', 'nsis-3.0.4.1', 'Bin', 'makensis.exe'), env: {} })
  })

  it('makensis yoksa anlaşılır hata verir', () => {
    expect(() => findMakensis(mkdtempSync(join(tmpdir(), 'ebcache-')))).toThrow(/makensis/)
  })

  it('betik UTF-8 okunur: Türkçe metinler (ı, …) bozulmasın', () => {
    const args = makensisArgs({ BUILD_ID: 'x', COPYRIGHT: '© 2026' }, 'build/portable/portable.nsi')
    const i = args.indexOf('-INPUTCHARSET')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(args[i + 1]).toBe('UTF8')
    expect(i).toBeLessThan(args.indexOf('build/portable/portable.nsi'))
    expect(args).toContain('-DBUILD_ID=x')
    expect(args).toContain('-DCOPYRIGHT=© 2026')
    expect(args[args.length - 1]).toBe('build/portable/portable.nsi')
  })
})
