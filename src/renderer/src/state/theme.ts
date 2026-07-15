export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'ui-theme'

/** Kayıtlı tercih → sistem tercihi → koyu (varsayılan). */
export function initialTheme(): Theme {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'dark' || saved === 'light') return saved
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light'
  return 'dark'
}

/** Temayı belge köküne uygular ve kalıcılaştırır. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
  localStorage.setItem(STORAGE_KEY, theme)
}
