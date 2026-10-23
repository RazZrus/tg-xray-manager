import { Bot, Context } from 'grammy';
import { loadConfig } from './config.js';
import { registerUserHandlers } from './handlers/user.js';
import { registerAdminHandlers } from './handlers/admin.js';

export function createBot(): Bot<Context> {
  const config = loadConfig();
  const bot = new Bot<Context>(config.botToken);

  // Команды для обычных пользователей
  const userCommands = [
    { command: 'start', description: 'Начать / главное меню' },
    { command: 'register', description: 'Зарегистрироваться по промокоду' },
    { command: 'me', description: 'Мой трафик' },
    { command: 'link', description: 'Ссылка для подключения' },
    { command: 'qr', description: 'QR-код для подключения' },
  ];

  const adminCommands = [
    ...userCommands,
    { command: 'admin', description: 'Панель администратора' },
  ];

  // Общий список — без /admin
  bot.api.setMyCommands(userCommands).catch(console.error);

  // Для каждого админа — с /admin
  for (const adminId of config.adminIds) {
    bot.api.setMyCommands(adminCommands, {
      scope: { type: 'chat', chat_id: adminId },
    }).catch(console.error);
  }

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
