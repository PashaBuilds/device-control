import { useEffect } from 'react'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans-condensed/500.css'
import '@fontsource/ibm-plex-sans-condensed/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import './styles/global.css'
import { useAppStore } from './state/store'
import { Sidebar } from './components/Sidebar'
import { EmptyState } from './components/EmptyState'
import { PsuPanel } from './components/psu/PsuPanel'

export default function App(): React.JSX.Element {
  const { ready, devices, selectedId, init } = useAppStore()

  useEffect(() => {
    void init()
  }, [init])

  if (!ready) return <div className="app" />

  const selected = devices.find((d) => d.id === selectedId) ?? null

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        {devices.length === 0 ? (
          <EmptyState />
        ) : selected ? (
          <PsuPanel key={selected.id} device={selected} />
        ) : null}
      </main>
    </div>
  )
}
