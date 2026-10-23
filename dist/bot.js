"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createBot = createBot;
exports.startBot = startBot;
const grammy_1 = require("grammy");
const config_js_1 = require("./config.js");
const user_js_1 = require("./handlers/user.js");
const admin_js_1 = require("./handlers/admin.js");
function createBot() {
    const config = (0, config_js_1.loadConfig)();
    const bot = new grammy_1.Bot(config.botToken);
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
    (0, user_js_1.registerUserHandlers)(bot);
    (0, admin_js_1.registerAdminHandlers)(bot);
    bot.catch((err) => {
        console.error('Bot error:', err);
    });
    return bot;
}
async function startBot() {
    const bot = createBot();
    console.log('Бот запущен. Нажмите Ctrl+C для остановки.');
    await bot.start({
        onStart: (info) => console.log(`Бот @${info.username} запущен`),
    });
}
//# sourceMappingURL=bot.js.map