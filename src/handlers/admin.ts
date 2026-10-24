import { Bot, Context, InlineKeyboard, Keyboard } from 'grammy';
import crypto from 'crypto';
import {
  listUsers,
  findUser,
  findUserByXrayName,
  deleteUser as dbDeleteUser,
  deleteUserTraffic,
  createPromoCode,
  deletePromoCode,
  listPromoCodes,
} from '../db/index.js';
import {
  listUsers as xrayListUsers,
  addUser,
  deleteUser as xrayDeleteUser,
  getUserGrpcLink,
  getXrayStatus,
  restartXray,
  runShellCommand,
  rebootServer,
  shutdownServer,
} from '../services/xray.js';
import {
  queryUserStats,
  queryAllStats,
  formatBytes,
  PERIOD_LABELS,
  TrafficPeriod,
} from '../services/stats.js';
import { loadConfig } from '../config.js';
import { escapeHtml } from '../utils.js';

const awaitingShell = new Set<number>();
const awaitingAddUser = new Set<number>();

function addWithTTL(set: Set<number>, id: number, ttlMs = 5 * 60_000): void {
  set.add(id);
  setTimeout(() => set.delete(id), ttlMs);
}

const menuMessageId = new Map<number, number>();

export function isAdmin(telegramId: number): boolean {
  const config = loadConfig();
  if (config.adminIds.includes(telegramId)) return true;
  const user = findUser(telegramId);
  return user?.is_admin === 1;
}

// ─── Keyboards ───────────────────────────────────────────────────────────────

const mainKeyboard = new Keyboard()
  .text('👥 Пользователи').text('🎫 Промокоды').row()
  .text('⚙️ Сервер').text('💻 Терминал').row()
  .resized();

const usersKeyboard = new Keyboard()
  .text('📋 Список').text('➕ Добавить').text('🗑 Удалить').row()
  .text('◀️ Назад').row()
  .resized();

const promoKeyboard = new Keyboard()
  .text('🎫 Создать').text('📋 Список').text('🗑 Удалить').row()
  .text('◀️ Назад').row()
  .resized();

const serverKeyboard = new Keyboard()
  .text('📊 Статус').text('🔄 Рестарт').row()
  .text('🔁 Перезагрузка').text('⛔ Выключение').row()
  .text('◀️ Назад').row()
  .resized();

// ─── Utilities ───────────────────────────────────────────────────────────────

const HTML = { parse_mode: 'HTML' as const };

async function sendOrEditMenu(ctx: Context, text: string, keyboard: Keyboard): Promise<void> {
  const chatId = ctx.chat!.id;
  const oldMsgId = menuMessageId.get(ctx.from!.id);

  const sent = await ctx.reply(text, { ...HTML, reply_markup: keyboard });
  menuMessageId.set(ctx.from!.id, sent.message_id);

  if (oldMsgId) {
    try { await ctx.api.deleteMessage(chatId, oldMsgId); } catch {}
  }
}

async function deleteUserMessage(ctx: Context): Promise<void> {
  try {
    if (ctx.message) {
      await ctx.api.deleteMessage(ctx.chat!.id, ctx.message.message_id);
    }
  } catch {}
}

type Section = 'main' | 'users' | 'promo' | 'server';
const currentSection = new Map<number, Section>();

// ─── User detail ─────────────────────────────────────────────────────────────

function buildUserDetailMessage(xrayUsername: string, period: TrafficPeriod): string {
  const stats = queryUserStats(xrayUsername, period);
  const label = PERIOD_LABELS[period];
  return (
    `👤 <b>${escapeHtml(xrayUsername)}</b> — ${label}\n\n` +
    `⬆️ Отправлено: ${formatBytes(stats.upload)}\n` +
    `⬇️ Получено:   ${formatBytes(stats.download)}\n` +
    `📦 Итого:      ${formatBytes(stats.upload + stats.download)}`
  );
}

function buildUserDetailKeyboard(xrayUsername: string, current: TrafficPeriod): InlineKeyboard {
  const periods: TrafficPeriod[] = ['hour', 'day', 'week', 'month', 'year', 'all'];
  const kb = new InlineKeyboard();
  for (const p of periods) {
    const label = p === current ? `· ${PERIOD_LABELS[p]} ·` : PERIOD_LABELS[p];
    kb.text(label, `user_traffic:${xrayUsername}:${p}`);
  }
  kb.row().text('🗑 Удалить', `del_user:${xrayUsername}`);
  return kb;
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerAdminHandlers(bot: Bot<Context>): void {
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) {
      await ctx.reply('Нет доступа.');
      return;
    }
    currentSection.set(ctx.from!.id, 'main');
    const sent = await ctx.reply('⚡ <b>Панель администратора</b>', {
      ...HTML,
      reply_markup: mainKeyboard,
    });
    menuMessageId.set(ctx.from!.id, sent.message_id);
  });

  // ─── Navigation ──────────────────────────────────────────────────────────

  bot.hears('👥 Пользователи', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    await deleteUserMessage(ctx);
    currentSection.set(ctx.from!.id, 'users');
    await sendOrEditMenu(ctx, '👥 <b>Пользователи</b>', usersKeyboard);
  });

  bot.hears('🎫 Промокоды', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    await deleteUserMessage(ctx);
    currentSection.set(ctx.from!.id, 'promo');
    await sendOrEditMenu(ctx, '🎫 <b>Промокоды</b>', promoKeyboard);
  });

  bot.hears('⚙️ Сервер', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    await deleteUserMessage(ctx);
    currentSection.set(ctx.from!.id, 'server');
    await sendOrEditMenu(ctx, '⚙️ <b>Сервер</b>', serverKeyboard);
  });

  bot.hears('💻 Терминал', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    addWithTTL(awaitingShell, ctx.from!.id);
    await ctx.reply('Введи команду:');
  });

  bot.hears('◀️ Назад', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    await deleteUserMessage(ctx);
    currentSection.set(ctx.from!.id, 'main');
    await sendOrEditMenu(ctx, '⚡ <b>Панель администратора</b>', mainKeyboard);
  });

  // ─── Users ───────────────────────────────────────────────────────────────

  bot.hears('📋 Список', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    const section = currentSection.get(ctx.from!.id);

    if (section === 'promo') {
      const codes = listPromoCodes();
      if (codes.length === 0) {
        await ctx.reply('Промокодов нет.');
        return;
      }
      let text = '📋 <b>Промокоды:</b>\n\n';
      for (const c of codes.slice(0, 20)) {
        const status = c.used_by ? '✅ использован' : '⏳ активен';
        text += `• <code>${escapeHtml(c.code)}</code> — ${status}\n`;
      }
      await ctx.reply(text, HTML);
      return;
    }

    try {
      const xrayUsers = xrayListUsers();
      const dbUsers = listUsers();
      const dbMap = new Map(dbUsers.map(u => [u.xray_username, u]));

      if (xrayUsers.length === 0) {
        await ctx.reply('Пользователей нет.');
        return;
      }

      const allStats = queryAllStats('all');
      const statsMap = new Map(allStats.map(s => [s.name, s]));

      const kb = new InlineKeyboard();
      let text = `👥 <b>Пользователи (${xrayUsers.length}):</b>\n\n`;
      for (const u of xrayUsers) {
        const dbUser = dbMap.get(u.name);
        const tg = dbUser?.telegram_username ? `@${escapeHtml(dbUser.telegram_username)}` : escapeHtml(dbUser?.first_name || '—');
        const s = statsMap.get(u.name);
        const total = s ? formatBytes(s.upload + s.download) : '—';
        text += `• <code>${escapeHtml(u.name)}</code> (${tg}) — ${total}\n`;
        kb.text(`📊 ${u.name}`, `user_detail:${u.name}`).row();
      }
      await ctx.reply(text, { ...HTML, reply_markup: kb });
    } catch (e) {
      await ctx.reply(`Ошибка: ${escapeHtml((e as Error).message)}`, HTML);
    }
  });

  bot.hears('➕ Добавить', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    addWithTTL(awaitingAddUser, ctx.from!.id);
    await ctx.reply('Введи имя нового пользователя (латиница):');
  });

  bot.hears('🗑 Удалить', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    const section = currentSection.get(ctx.from!.id);

    if (section === 'promo') {
      const codes = listPromoCodes().filter(c => c.used_by === null);
      if (codes.length === 0) {
        await ctx.reply('Нет активных промокодов.');
        return;
      }
      const keyboard = new InlineKeyboard();
      for (const c of codes.slice(0, 20)) {
        keyboard.text(`❌ ${c.code}`, `del_promo:${c.code}`).row();
      }
      await ctx.reply('Выбери промокод:', { reply_markup: keyboard });
      return;
    }

    try {
      const xrayUsers = xrayListUsers();
      if (xrayUsers.length === 0) {
        await ctx.reply('Пользователей нет.');
        return;
      }
      const keyboard = new InlineKeyboard();
      for (const u of xrayUsers) {
        keyboard.text(`❌ ${u.name}`, `del_user:${u.name}`).row();
      }
      await ctx.reply('Выбери пользователя:', { reply_markup: keyboard });
    } catch (e) {
      await ctx.reply(`Ошибка: ${escapeHtml((e as Error).message)}`, HTML);
    }
  });

  bot.hears('🎫 Создать', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    createPromoCode(code, ctx.from!.id);
    await ctx.reply(`🎫 Создан: <code>${code}</code>`, HTML);
  });

  // ─── User detail with period breakdown ───────────────────────────────────

  bot.callbackQuery(/^user_detail:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    const name = ctx.match[1];
    await ctx.reply(
      buildUserDetailMessage(name, 'all'),
      { ...HTML, reply_markup: buildUserDetailKeyboard(name, 'all') },
    );
  });

  bot.callbackQuery(/^user_traffic:(.+):(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    const name = ctx.match[1];
    const period = ctx.match[2] as TrafficPeriod;
    await ctx.editMessageText(
      buildUserDetailMessage(name, period),
      { ...HTML, reply_markup: buildUserDetailKeyboard(name, period) },
    );
  });

  // ─── Inline: delete user ─────────────────────────────────────────────────

  bot.callbackQuery(/^del_user:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    const name = ctx.match[1];
    await ctx.editMessageText(`Удалить <code>${escapeHtml(name)}</code>?`, {
      ...HTML,
      reply_markup: new InlineKeyboard()
        .text('✅ Да', `confirm_del:${name}`)
        .text('❌ Нет', 'confirm_del:cancel'),
    });
  });

  bot.callbackQuery(/^confirm_del:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    const name = ctx.match[1];

    if (name === 'cancel') {
      await ctx.editMessageText('Отменено.');
      return;
    }

    try {
      xrayDeleteUser(name);
      deleteUserTraffic(name);
      const dbUser = findUserByXrayName(name);
      if (dbUser) dbDeleteUser(dbUser.telegram_id);
      await ctx.editMessageText(`✅ <code>${escapeHtml(name)}</code> удалён.`, HTML);
    } catch (e) {
      await ctx.editMessageText(`Ошибка: ${escapeHtml((e as Error).message)}`, HTML);
    }
  });

  // ─── Inline: delete promo ────────────────────────────────────────────────

  bot.callbackQuery(/^del_promo:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    const code = ctx.match[1];
    try {
      deletePromoCode(code);
      await ctx.editMessageText(`✅ <code>${escapeHtml(code)}</code> удалён.`, HTML);
    } catch (e) {
      await ctx.editMessageText(`Ошибка: ${escapeHtml((e as Error).message)}`, HTML);
    }
  });

  // ─── Server ──────────────────────────────────────────────────────────────

  bot.hears('📊 Статус', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    try {
      const status = getXrayStatus();
      await ctx.reply(`<pre>${escapeHtml(status.slice(0, 3800))}</pre>`, HTML);
    } catch (e) {
      await ctx.reply(`Ошибка: ${escapeHtml((e as Error).message)}`, HTML);
    }
  });

  bot.hears('🔄 Рестарт', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    try {
      restartXray();
      await ctx.reply('✅ xray перезапущен.');
    } catch (e) {
      await ctx.reply(`Ошибка: ${escapeHtml((e as Error).message)}`, HTML);
    }
  });

  bot.hears('🔁 Перезагрузка', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    await ctx.reply('⚠️ Перезагрузить сервер?', {
      reply_markup: new InlineKeyboard()
        .text('✅ Да', 'confirm:reboot')
        .text('❌ Отмена', 'confirm:cancel'),
    });
  });

  bot.hears('⛔ Выключение', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    await ctx.reply('⚠️ Выключить сервер?', {
      reply_markup: new InlineKeyboard()
        .text('✅ Да', 'confirm:shutdown')
        .text('❌ Отмена', 'confirm:cancel'),
    });
  });

  bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    const action = ctx.match[1];
    if (action === 'cancel')   { await ctx.editMessageText('Отменено.'); return; }
    if (action === 'reboot')   { await ctx.editMessageText('🔁 Перезагрузка сервера...'); rebootServer(); return; }
    if (action === 'shutdown') { await ctx.editMessageText('⛔ Выключение сервера...'); shutdownServer(); return; }
  });

  // ─── Shell ───────────────────────────────────────────────────────────────

  bot.command('shell', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) { await ctx.reply('Нет доступа.'); return; }
    const command = ctx.message?.text.replace(/^\/shell\s*/, '').trim() ?? '';
    if (!command) {
      addWithTTL(awaitingShell, ctx.from!.id);
      await ctx.reply('Введи команду:');
      return;
    }
    await executeShell(ctx, command);
  });

  // ─── Text input ──────────────────────────────────────────────────────────

  bot.on('message:text', async (ctx, next) => {
    const telegramId = ctx.from!.id;
    const text = ctx.message.text.trim();

    if (awaitingShell.has(telegramId)) {
      if (!isAdmin(telegramId)) { awaitingShell.delete(telegramId); return next(); }
      awaitingShell.delete(telegramId);
      await executeShell(ctx, text);
      return;
    }

    if (awaitingAddUser.has(telegramId)) {
      if (!isAdmin(telegramId)) { awaitingAddUser.delete(telegramId); return next(); }
      awaitingAddUser.delete(telegramId);

      const name = text.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!name || name.length < 2) {
        await ctx.reply('Некорректное имя. Используй латинские буквы.');
        return;
      }

      await ctx.reply(`Создаю <code>${escapeHtml(name)}</code>...`, HTML);
      try {
        const tcpLink = addUser(name);
        let grpcLink = '';
        try { grpcLink = getUserGrpcLink(name); } catch {}
        const linkText = grpcLink
          ? `TCP:\n<code>${escapeHtml(tcpLink)}</code>\n\ngRPC:\n<code>${escapeHtml(grpcLink)}</code>`
          : `<code>${escapeHtml(tcpLink)}</code>`;
        await ctx.reply(
          `✅ <code>${escapeHtml(name)}</code> создан!\n\nСсылка:\n${linkText}`,
          HTML,
        );
      } catch (e) {
        await ctx.reply(`Ошибка: ${escapeHtml((e as Error).message)}`, HTML);
      }
      return;
    }

    return next();
  });
}

async function executeShell(ctx: Context, command: string): Promise<void> {
  const msg = await ctx.reply(`<code>$ ${escapeHtml(command)}</code>\n\nВыполняю...`, HTML);
  try {
    const output = runShellCommand(command);
    const truncated = output.length > 3800 ? output.slice(0, 3800) + '\n...(обрезано)' : output;
    await ctx.api.editMessageText(
      ctx.chat!.id, msg.message_id,
      `<pre>$ ${escapeHtml(command)}\n\n${escapeHtml(truncated)}</pre>`,
      HTML,
    );
  } catch (e) {
    await ctx.api.editMessageText(ctx.chat!.id, msg.message_id, `Ошибка: ${escapeHtml((e as Error).message)}`, HTML);
  }
}
