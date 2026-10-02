/** tools/build-portable.mjs için tip bildirimleri (testler TypeScript'ten içe aktarır). */
export function computeBuildId(version: string, asar: Buffer): string
export function versionQuad(version: string): string
export function findMakensis(cacheRoot: string): string
export function makensisArgs(defines: Record<string, string>, scriptPath: string): string[]
export function buildPortable(opts?: { root?: string; appDir?: string; cacheRoot?: string }): string
