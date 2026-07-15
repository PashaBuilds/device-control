import { startE36233aSim } from './e36233a-sim'

const port = Number(process.argv[2] ?? 5025)

startE36233aSim(port, (msg) => console.log(`[e36233a-sim] ${msg}`))
  .then((h) => {
    console.log(`Keysight E36233A simülatörü dinliyor: 127.0.0.1:${h.port}`)
    console.log('Çıkmak için Ctrl+C')
  })
  .catch((err) => {
    console.error('Simülatör başlatılamadı:', err.message)
    process.exit(1)
  })
