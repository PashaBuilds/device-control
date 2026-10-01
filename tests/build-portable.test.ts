import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeBuildId, findMakensis, versionQuad } from '../tools/build-portable.mjs'

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

  it('makensis yoksa anlaşılır hata verir', () => {
    expect(() => findMakensis(mkdtempSync(join(tmpdir(), 'ebcache-')))).toThrow(/makensis/)
  })
})
