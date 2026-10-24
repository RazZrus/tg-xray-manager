import { configExists } from './config.js'
import { runWizard } from './wizard.js'
import { createBot } from './bot.js'
import { store } from './store/index.js'

async function main(): Promise<void> {
  if (!configExists()) {
    await runWizard()
  }

  const bot = createBot()

  store.traffic.start()

  function shutdown() {
    store.shutdown()
    process.exit(0)
  }

  process.on('SIGINT',  shutdown)
  process.on('SIGTERM', shutdown)
  // SIGUSR1: flush traffic before external xray restart (sent by xray-mgr restart)
  process.on('SIGUSR1', () => { store.traffic.flush().catch(() => {}) })

  store.version.checkAndNotify(bot).catch(() => {})

  console.log('Bot started. Press Ctrl+C to stop.')
  await bot.start({
    onStart: (info) => console.log(`Bot @${info.username} started`),
  })
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
