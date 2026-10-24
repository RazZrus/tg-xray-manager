import { Bot, Context, InlineKeyboard, InputFile } from 'grammy';
import type { InlineKeyboardMarkup } from 'grammy/types';
import fs from 'fs';
import {
  findUser,
  findPromoCode,
  redeemPromoCode,
  upsertUser,
  listAdmins,
} from '../db/index.js';
import { addUser, getUserLink, getUserGrpcLink, getUserQrPath } from '../services/xray.js';
import { queryUserStats, formatBytes, PERIOD_LABELS, TrafficPeriod } from '../services/stats.js';
import { loadConfig } from '../config.js';
import { escapeHtml } from '../utils.js';

const awaitingPromoCode = new Set<number>();
const awaitingXrayName = new Map<number, string>(); // telegramId → promo code

const HTML = { parse_mode: 'HTML' as const };

export function registerUserHandlers(bot: Bot<Context>): void {
  bot.command('start', async (ctx) => {
    const user = findUser(ctx.from!.id);
    if (user?.xray_username) {
      await ctx.reply(
        `Привет, ${escapeHtml(ctx.from!.first_name ?? '')}! Ты подключён как <code>${escapeHtml(user.xray_username)}</code>.\n\nКоманды:\n/me — твой трафик\n/link — ссылка для подключения\n/qr — QR-код`,
        HTML,
      );
    } else {
      await ctx.reply(
        'Привет! Это VPN-бот.\n\nЧтобы получить доступ, нажми кнопку ниже или используй /register.',
        { reply_markup: new InlineKeyboard().text('Получить доступ', 'register') },
      );
    }
  });

  bot.command('register', startRegister);
  bot.callbackQuery('register', async (ctx) => {
    await ctx.answerCallbackQuery();
    await startRegister(ctx);
  });

  async function startRegister(ctx: Context) {
    const telegramId = ctx.from!.id;
    const user = findUser(telegramId);

    if (user?.xray_username) {
      await ctx.reply('Ты уже зарегистрирован. Используй /me для статистики.');
      return;
    }

    awaitingPromoCode.add(telegramId);
    await ctx.reply('Введи промокод:');
  }

  bot.command('me', async (ctx) => {
    const user = findUser(ctx.from!.id);
    if (!user?.xray_username) {
      await ctx.reply('Ты не зарегистрирован. Используй /register.');
      return;
    }

    const text = buildTrafficMessage(user.xray_username, 'all');
    const keyboard = buildPeriodKeyboard(user.xray_username, 'all');
    await ctx.reply(text, { ...HTML, reply_markup: keyboard });
  });

  bot.callbackQuery(/^my_traffic:(.+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const username = ctx.match[1];
    const period = ctx.match[2] as TrafficPeriod;

    const text = buildTrafficMessage(username, period);
    const keyboard = buildPeriodKeyboard(username, period);
    await ctx.editMessageText(text, { ...HTML, reply_markup: keyboard });
  });

  bot.command('link', async (ctx) => {
    const user = findUser(ctx.from!.id);
    if (!user?.xray_username) {
      await ctx.reply('Ты не зарегистрирован. Используй /register.');
      return;
    }

    try {
      const tcpLink = getUserLink(user.xray_username);
      let grpcLink = '';
      try { grpcLink = getUserGrpcLink(user.xray_username); } catch {}

      const linkText = grpcLink
        ? `TCP:\n<code>${escapeHtml(tcpLink)}</code>\n\ngRPC:\n<code>${escapeHtml(grpcLink)}</code>`
        : `<code>${escapeHtml(tcpLink)}</code>`;

      await ctx.reply(`Ссылка для подключения:\n\n${linkText}`, HTML);
    } catch (e) {
      await ctx.reply(`Ошибка: ${escapeHtml((e as Error).message)}`, HTML);
    }
  });

  bot.command('qr', async (ctx) => {
    const user = findUser(ctx.from!.id);
    if (!user?.xray_username) {
      await ctx.reply('Ты не зарегистрирован. Используй /register.');
      return;
    }

    let qrPath: string | undefined;
    try {
      qrPath = getUserQrPath(user.xray_username);
      await ctx.replyWithPhoto(new InputFile(qrPath));
    } catch (e) {
      await ctx.reply(`Ошибка генерации QR: ${escapeHtml((e as Error).message)}`, HTML);
    } finally {
      if (qrPath) try { fs.unlinkSync(qrPath); } catch {}
    }
  });

  bot.on('message:text', async (ctx, next) => {
    const telegramId = ctx.from!.id;
    const text = ctx.message.text.trim();

    if (awaitingPromoCode.has(telegramId)) {
      awaitingPromoCode.delete(telegramId);

      const promo = findPromoCode(text);
      if (!promo) {
        await ctx.reply('Неверный промокод. Попробуй ещё раз или обратись к администратору.');
        return;
      }
      if (promo.used_by !== null) {
        await ctx.reply('Этот промокод уже использован.');
        return;
      }

      awaitingXrayName.set(telegramId, text);
      await ctx.reply(
        'Промокод принят! Теперь введи своё имя для VPN (латиница, без пробелов, например: <code>ivan</code>):',
        HTML,
      );
      return;
    }

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
        if (!redeemPromoCode(pendingCode, telegramId)) {
          await ctx.reply('Этот промокод уже использован.');
          return;
        }

        const tcpLink = addUser(xrayName);

        upsertUser({
          telegram_id: telegramId,
          telegram_username: ctx.from!.username ?? null,
          first_name: ctx.from!.first_name ?? null,
          last_name: ctx.from!.last_name ?? null,
          xray_username: xrayName,
        });

        let grpcLink = '';
        try { grpcLink = getUserGrpcLink(xrayName); } catch {}
        const linkText = grpcLink
          ? `TCP:\n<code>${escapeHtml(tcpLink)}</code>\n\ngRPC:\n<code>${escapeHtml(grpcLink)}</code>`
          : `<code>${escapeHtml(tcpLink)}</code>`;

        await ctx.reply(
          `✅ Аккаунт создан!\n\nИмя: <code>${escapeHtml(xrayName)}</code>\n\nСсылка для подключения:\n${linkText}\n\nИспользуй /qr для QR-кода или /me для статистики.`,
          HTML,
        );

        await notifyAdmins(
          bot,
          `👤 Новый пользователь зарегистрировался!\n\nTelegram: ${escapeHtml(ctx.from!.first_name ?? '')}${ctx.from!.username ? ` (@${escapeHtml(ctx.from!.username)})` : ''}\nVPN имя: <code>${escapeHtml(xrayName)}</code>`,
        );
      } catch (e) {
        awaitingXrayName.delete(telegramId);
        await ctx.reply(`Ошибка создания аккаунта: ${escapeHtml((e as Error).message)}`, HTML);
      }
      return;
    }

    return next();
  });
}

function buildTrafficMessage(username: string, period: TrafficPeriod): string {
  const stats = queryUserStats(username, period);
  const label = PERIOD_LABELS[period];
  return (
    `📊 <b>${escapeHtml(username)}</b> — ${label}\n\n` +
    `⬆️ Отправлено: ${formatBytes(stats.upload)}\n` +
    `⬇️ Получено:   ${formatBytes(stats.download)}\n` +
    `📦 Итого:      ${formatBytes(stats.upload + stats.download)}`
  );
}

function buildPeriodKeyboard(username: string, current: TrafficPeriod): InlineKeyboardMarkup {
  const periods: TrafficPeriod[] = ['hour', 'day', 'week', 'month', 'year', 'all'];
  const kb = new InlineKeyboard();
  for (const p of periods) {
    const label = p === current ? `· ${PERIOD_LABELS[p]} ·` : PERIOD_LABELS[p];
    kb.text(label, `my_traffic:${username}:${p}`);
  }
  return kb;
}

async function notifyAdmins(bot: Bot<Context>, message: string): Promise<void> {
  const admins = listAdmins();
  const config = loadConfig();

  const adminIds = new Set([
    ...admins.map(a => a.telegram_id),
    ...config.adminIds,
  ]);

  await Promise.allSettled(
    [...adminIds].map(id => bot.api.sendMessage(id, message, HTML))
  );
}

export { notifyAdmins };
