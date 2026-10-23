import { configExists } from './config.js';
import { runWizard } from './wizard.js';
import { startBot } from './bot.js';

async function main(): Promise<void> {
  if (!configExists()) {
    await runWizard();
  }
  await startBot();
}

main().catch((err) => {
  console.error('Критическая ошибка:', err);
  process.exit(1);
});
