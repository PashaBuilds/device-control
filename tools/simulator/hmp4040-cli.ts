import { startHmp4040Sim } from './hmp4040-sim'

const port = Number(process.argv[2] ?? 5027)

startHmp4040Sim(port, (msg) => console.log(`[hmp4040-sim] ${msg}`))
  .then((h) => {
    console.log(`Rohde & Schwarz HMP4040 simülatörü dinliyor: 127.0.0.1:${h.port}`)
    console.log('Çıkmak için Ctrl+C')
  })
  .catch((err) => {
    console.error('Simülatör başlatılamadı:', err.message)
    process.exit(1)
  })
