import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { applyTheme, initialTheme } from './state/theme'

async function bootstrap(): Promise<void> {
  // İlk boyamadan önce temayı uygula (koyu/açık flaşını önler)
  applyTheme(initialTheme())
  // Düz tarayıcıda (preload köprüsü yok) protokol modeli üstünde çalışan taklit kur
  if (!window.deviceApi || Object.keys(window.deviceApi).length === 0) {
    await import('./dev/mockDeviceApi')
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void bootstrap()
