import prompts from 'prompts';
import { saveConfig, type Config } from './config.js';
import { execSync } from 'child_process';

export async function runWizard(): Promise<Config> {
  console.log('\n=== tg-xray-bot — первоначальная настройка ===\n');

  const answers = await prompts(
    [
      {
        type: 'text',
        name: 'botToken',
        message: 'Telegram Bot Token (получить у @BotFather):',
        validate: (v: string) => v.trim().length > 10 || 'Введите корректный токен',
      },
      {
        type: 'text',
        name: 'adminId',
        message: 'Ваш Telegram ID (узнать у @userinfobot):',
        validate: (v: string) => /^\d+$/.test(v.trim()) || 'Только цифры',
      },
      {
        type: 'text',
        name: 'serverIp',
        message: 'Внешний IP сервера (оставьте пустым для автоопределения):',
        initial: detectServerIp(),
      },
      {
        type: 'number',
        name: 'xrayPort',
        message: 'Порт xray:',
        initial: 443,
      },
      {
        type: 'text',
        name: 'sni',
        message: 'SNI (домен для маскировки):',
        initial: 'www.microsoft.com',
      },
      {
        type: 'number',
        name: 'statsPort',
        message: 'Порт gRPC Stats API xray:',
        initial: 10085,
      },
    ],
    {
      onCancel: () => {
        console.log('\nНастройка отменена.');
        process.exit(0);
      },
    }
  );

  const config: Config = {
    botToken: answers.botToken.trim(),
    adminIds: [parseInt(answers.adminId.trim(), 10)],
    serverIp: answers.serverIp.trim(),
    xrayPort: answers.xrayPort,
    sni: answers.sni.trim(),
    statsPort: answers.statsPort,
  };

  saveConfig(config);
  console.log('\nКонфиг сохранён.\n');

  return config;
}

function detectServerIp(): string {
  try {
    return execSync('curl -s --max-time 3 https://api.ipify.org', { timeout: 5000 }).toString().trim();
  } catch {
    return '';
  }
}
