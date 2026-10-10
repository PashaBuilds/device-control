import { useEffect } from 'react'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans-condensed/500.css'
import '@fontsource/ibm-plex-sans-condensed/600.css'
import '@fontsource/chakra-petch/500.css'
import '@fontsource/chakra-petch/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import './styles/global.css'
import { deviceTypeInfo, type DeviceConfig } from '@shared/types'
import { useAppStore } from './state/store'
import { Sidebar } from './components/Sidebar'
import { EmptyState } from './components/EmptyState'
import { PsuPanel } from './components/psu/PsuPanel'
import { ProbePanel } from './components/probe/ProbePanel'
import { SigGenPanel } from './components/siggen/SigGenPanel'

function renderPanel(device: DeviceConfig): React.JSX.Element {
  switch (deviceTypeInfo(device.kind).category) {
    case 'debug-probe':
      return <ProbePanel key={device.id} device={device} />
    case 'signal-generator':
      return <SigGenPanel key={device.id} device={device} />
    default:
      return <PsuPanel key={device.id} device={device} />
  }
}

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
          renderPanel(selected)
        ) : null}
      </main>
    </div>
  )
}
