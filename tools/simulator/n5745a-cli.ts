import { startN5745aSim } from './n5745a-sim'

// Varsayılan 5026: E36233A simülatörü (5025) ile aynı anda çalışabilsin
const port = Number(process.argv[2] ?? 5026)

startN5745aSim(port, (msg) => console.log(`[n5745a-sim] ${msg}`))
  .then((h) => {
    console.log(`Keysight N5745A simülatörü dinliyor: 127.0.0.1:${h.port}`)
    console.log('Çıkmak için Ctrl+C')
  })
  .catch((err) => {
    console.error('Simülatör başlatılamadı:', err.message)
    process.exit(1)
  })
