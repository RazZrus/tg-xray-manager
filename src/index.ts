import { configExists } from './config.js';
import { runWizard } from './wizard.js';
import { createBot } from './bot.js';
import { startTrafficCollector, stopTrafficCollector, flushTraffic } from './services/traffic-collector.js';
import { checkForUpdates } from './services/version.js';
import { closeDb } from './db/index.js';

async function main(): Promise<void> {
  if (!configExists()) {
    await runWizard();
  }

  const bot = createBot();

  startTrafficCollector();

  function shutdown() {
    stopTrafficCollector();
    closeDb();
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // SIGUSR1: flush traffic before external xray restart (sent by xray-mgr restart)
  process.on('SIGUSR1', () => { flushTraffic().catch(() => {}); });

  checkForUpdates(bot).catch(() => {});

  console.log('Bot started. Press Ctrl+C to stop.');
  await bot.start({
    onStart: (info) => console.log(`Bot @${info.username} started`),
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
