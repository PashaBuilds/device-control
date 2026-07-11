import { startSmartLynqSim } from './smartlynq-sim'

const port = Number(process.argv[2] ?? 3121)

startSmartLynqSim(port, (msg) => console.log(`[lynq-sim] ${msg}`))
  .then((h) => {
    console.log(`SmartLynq (TCF) simülatörü dinliyor: 127.0.0.1:${h.port}`)
    console.log('Çıkmak için Ctrl+C')
  })
  .catch((err) => {
    console.error('Simülatör başlatılamadı:', err.message)
    process.exit(1)
  })
