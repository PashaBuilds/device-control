import { startCpx400dpSim } from './cpx400dp-sim'

const port = Number(process.argv[2] ?? 9221)

startCpx400dpSim(port, (msg) => console.log(`[sim] ${msg}`))
  .then((h) => {
    console.log(`CPX400DP simülatörü dinliyor: 127.0.0.1:${h.port}`)
    console.log('Çıkmak için Ctrl+C')
  })
  .catch((err) => {
    console.error('Simülatör başlatılamadı:', err.message)
    process.exit(1)
  })
