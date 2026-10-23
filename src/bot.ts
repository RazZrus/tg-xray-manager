import { Bot, Context, session } from 'grammy';
import { loadConfig } from './config.js';
import { registerUserHandlers } from './handlers/user.js';
import { registerAdminHandlers } from './handlers/admin.js';

export function createBot(): Bot<Context> {
  const config = loadConfig();
  const bot = new Bot<Context>(config.botToken);

  // Регистрация команд
  bot.api.setMyCommands([
    { command: 'start', description: 'Начать / главное меню' },
    { command: 'register', description: 'Зарегистрироваться по промокоду' },
    { command: 'me', description: 'Мой трафик' },
    { command: 'link', description: 'Ссылка для подключения' },
    { command: 'qr', description: 'QR-код для подключения' },
    { command: 'admin', description: 'Панель администратора' },
    { command: 'shell', description: 'Выполнить команду (только админы)' },
    { command: 'deluser', description: 'Удалить пользователя (только админы)' },
  ]).catch(console.error);

  registerUserHandlers(bot);
  registerAdminHandlers(bot);

  bot.catch((err) => {
    console.error('Bot error:', err);
  });

  return bot;
}

export async function startBot(): Promise<void> {
  const bot = createBot();
  console.log('Бот запущен. Нажмите Ctrl+C для остановки.');
  await bot.start({
    onStart: (info) => console.log(`Бот @${info.username} запущен`),
  });
}
