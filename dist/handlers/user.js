"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerUserHandlers = registerUserHandlers;
exports.notifyAdmins = notifyAdmins;
const grammy_1 = require("grammy");
const fs_1 = __importDefault(require("fs"));
const index_js_1 = require("../db/index.js");
const xray_js_1 = require("../services/xray.js");
const stats_js_1 = require("../services/stats.js");
const config_js_1 = require("../config.js");
// Состояния ожидания ввода
const awaitingPromoCode = new Set();
const awaitingXrayName = new Map(); // telegramId → promo code
function registerUserHandlers(bot) {
    // /start
    bot.command('start', async (ctx) => {
        const user = (0, index_js_1.findUser)(ctx.from.id);
        if (user?.xray_username) {
            await ctx.reply(`Привет, ${ctx.from.first_name}! Ты подключён как \`${user.xray_username}\`.\n\nКоманды:\n/me — твой трафик\n/link — ссылка для подключения\n/qr — QR-код`, { parse_mode: 'Markdown' });
        }
        else {
            await ctx.reply(`Привет! Это VPN-бот.\n\nЧтобы получить доступ, нажми кнопку ниже или используй /register.`, {
                reply_markup: new grammy_1.InlineKeyboard().text('Получить доступ', 'register'),
            });
        }
    });
    // /register
    bot.command('register', startRegister);
    bot.callbackQuery('register', async (ctx) => {
        await ctx.answerCallbackQuery();
        await startRegister(ctx);
    });
    async function startRegister(ctx) {
        const telegramId = ctx.from.id;
        const user = (0, index_js_1.findUser)(telegramId);
        if (user?.xray_username) {
            await ctx.reply('Ты уже зарегистрирован. Используй /me для статистики.');
            return;
        }
        awaitingPromoCode.add(telegramId);
        await ctx.reply('Введи промокод:');
    }
    // /me — статистика пользователя
    bot.command('me', async (ctx) => {
        const user = (0, index_js_1.findUser)(ctx.from.id);
        if (!user?.xray_username) {
            await ctx.reply('Ты не зарегистрирован. Используй /register.');
            return;
        }
        await ctx.reply('Загружаю статистику...');
        try {
            const stats = await (0, stats_js_1.queryUserStats)(user.xray_username);
            await ctx.reply(`📊 *${user.xray_username}*\n\n` +
                `⬆️ Отправлено: ${(0, stats_js_1.formatBytes)(stats.upload)}\n` +
                `⬇️ Получено:   ${(0, stats_js_1.formatBytes)(stats.download)}\n` +
                `📦 Итого:      ${(0, stats_js_1.formatBytes)(stats.upload + stats.download)}`, { parse_mode: 'Markdown' });
        }
        catch {
            await ctx.reply('Не удалось получить статистику. Попробуй позже.');
        }
    });
    // /link — ссылка для подключения
    bot.command('link', async (ctx) => {
        const user = (0, index_js_1.findUser)(ctx.from.id);
        if (!user?.xray_username) {
            await ctx.reply('Ты не зарегистрирован. Используй /register.');
            return;
        }
        try {
            const link = (0, xray_js_1.getUserLink)(user.xray_username);
            await ctx.reply(`Твоя ссылка для подключения:\n\n\`${link}\``, { parse_mode: 'Markdown' });
        }
        catch (e) {
            await ctx.reply(`Ошибка: ${e.message}`);
        }
    });
    // /qr — QR-код
    bot.command('qr', async (ctx) => {
        const user = (0, index_js_1.findUser)(ctx.from.id);
        if (!user?.xray_username) {
            await ctx.reply('Ты не зарегистрирован. Используй /register.');
            return;
        }
        try {
            const qrPath = (0, xray_js_1.getUserQrPath)(user.xray_username);
            await ctx.replyWithPhoto(new grammy_1.InputFile(qrPath));
            fs_1.default.unlinkSync(qrPath);
        }
        catch (e) {
            await ctx.reply(`Ошибка генерации QR: ${e.message}`);
        }
    });
    // Обработка текстовых сообщений — ввод промокода и имени
    bot.on('message:text', async (ctx, next) => {
        const telegramId = ctx.from.id;
        const text = ctx.message.text.trim();
        // Ввод промокода
        if (awaitingPromoCode.has(telegramId)) {
            awaitingPromoCode.delete(telegramId);
            const promo = (0, index_js_1.findPromoCode)(text);
            if (!promo) {
                await ctx.reply('Неверный промокод. Попробуй ещё раз или обратись к администратору.');
                return;
            }
            if (promo.used_by !== null) {
                await ctx.reply('Этот промокод уже использован.');
                return;
            }
            awaitingXrayName.set(telegramId, text);
            await ctx.reply('Промокод принят! Теперь введи своё имя для VPN (латиница, без пробелов, например: `ivan`):', { parse_mode: 'Markdown' });
            return;
        }
        // Ввод имени для xray
        const pendingCode = awaitingXrayName.get(telegramId);
        if (pendingCode) {
            const xrayName = text.toLowerCase().replace(/[^a-z0-9_-]/g, '');
            if (!xrayName || xrayName.length < 2) {
                await ctx.reply('Имя должно содержать минимум 2 латинских символа. Попробуй ещё раз:');
                return;
            }
            awaitingXrayName.delete(telegramId);
            await ctx.reply('Создаю твой VPN-аккаунт...');
            try {
                const link = (0, xray_js_1.addUser)(xrayName);
                // Сохраняем пользователя
                (0, index_js_1.upsertUser)({
                    telegram_id: telegramId,
                    telegram_username: ctx.from.username ?? null,
                    first_name: ctx.from.first_name ?? null,
                    last_name: ctx.from.last_name ?? null,
                    xray_username: xrayName,
                });
                (0, index_js_1.markPromoCodeUsed)(pendingCode, telegramId);
                await ctx.reply(`✅ Аккаунт создан!\n\nИмя: \`${xrayName}\`\n\nСсылка для подключения:\n\`${link}\`\n\nИспользуй /qr для QR-кода или /me для статистики.`, { parse_mode: 'Markdown' });
                // Уведомляем всех админов
                await notifyAdmins(bot, `👤 Новый пользователь зарегистрировался!\n\nTelegram: ${ctx.from.first_name}${ctx.from.username ? ` (@${ctx.from.username})` : ''}\nVPN имя: \`${xrayName}\``);
            }
            catch (e) {
                awaitingXrayName.delete(telegramId);
                await ctx.reply(`Ошибка создания аккаунта: ${e.message}`);
            }
            return;
        }
        return next();
    });
}
async function notifyAdmins(bot, message) {
    const admins = (0, index_js_1.listAdmins)();
    const config = (0, config_js_1.loadConfig)();
    // Уведомляем как из БД, так и из конфига
    const adminIds = new Set([
        ...admins.map(a => a.telegram_id),
        ...config.adminIds,
    ]);
    await Promise.allSettled([...adminIds].map(id => bot.api.sendMessage(id, message, { parse_mode: 'Markdown' })));
}
//# sourceMappingURL=user.js.map