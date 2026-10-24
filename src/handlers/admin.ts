import { Bot, Context, InlineKeyboard } from 'grammy';
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
import { flushTraffic } from '../services/traffic-collector.js';

// ─── State ───────────────────────────────────────────────────────────────────

const awaitingShell    = new Set<number>();
const awaitingAddUser  = new Set<number>();

function addWithTTL(set: Set<number>, id: number, ttlMs = 5 * 60_000): void {
  set.add(id);
  setTimeout(() => set.delete(id), ttlMs);
}

/** Message ID of the persistent admin panel per user */
const panelMessageId = new Map<number, number>();

export function isAdmin(telegramId: number): boolean {
  const config = loadConfig();
  if (config.adminIds.includes(telegramId)) return true;
  const user = findUser(telegramId);
  return user?.is_admin === 1;
}

// ─── Inline keyboards ────────────────────────────────────────────────────────

const HTML = { parse_mode: 'HTML' as const };

const mainKb = new InlineKeyboard()
  .text('👥 Пользователи', 'admin:users').text('🎫 Промокоды', 'admin:promo').row()
  .text('⚙️ Сервер',        'admin:server').text('💻 Терминал',  'admin:terminal');

const usersKb = new InlineKeyboard()
  .text('📋 Список', 'admin:users:list').text('➕ Добавить', 'admin:users:add').text('🗑 Удалить', 'admin:users:del').row()
  .text('◀️ Назад',  'admin:main');

const promoKb = new InlineKeyboard()
  .text('🎫 Создать', 'admin:promo:create').text('📋 Список', 'admin:promo:list').text('🗑 Удалить', 'admin:promo:del').row()
  .text('◀️ Назад',   'admin:main');

const serverKb = new InlineKeyboard()
  .text('📊 Статус', 'admin:server:status').text('🔄 Рестарт', 'admin:server:restart').row()
  .text('🔁 Перезагрузка', 'admin:server:reboot').text('⛔ Выключение', 'admin:server:shutdown').row()
  .text('◀️ Назад', 'admin:main');

const panelText: Record<string, string> = {
  main:    '⚡ <b>Панель администратора</b>',
  users:   '👥 <b>Пользователи</b>',
  promo:   '🎫 <b>Промокоды</b>',
  server:  '⚙️ <b>Сервер</b>',
  terminal: '💻 <b>Терминал</b>\n\nВведи команду:',
};

const panelKb: Record<string, InlineKeyboard> = {
  main:    mainKb,
  users:   usersKb,
  promo:   promoKb,
  server:  serverKb,
  terminal: new InlineKeyboard().text('◀️ Назад', 'admin:main'),
};

// ─── Panel helpers ────────────────────────────────────────────────────────────

async function openPanel(ctx: Context, section = 'main'): Promise<void> {
  const userId = ctx.from!.id;
  const existing = panelMessageId.get(userId);

  if (existing) {
    try {
      await ctx.api.editMessageText(ctx.chat!.id, existing, panelText[section], {
        ...HTML,
        reply_markup: panelKb[section],
      });
      return;
    } catch {
      // Message deleted or too old — fall through to send new
    }
  }

  const sent = await ctx.reply(panelText[section], { ...HTML, reply_markup: panelKb[section] });
  panelMessageId.set(userId, sent.message_id);
}

// ─── User detail helpers ──────────────────────────────────────────────────────

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
    if (!isAdmin(ctx.from!.id)) { await ctx.reply('Нет доступа.'); return; }
    await openPanel(ctx, 'main');
  });

  // ─── Navigation callbacks (edit panel in-place, no new messages) ──────────

  bot.callbackQuery('admin:main', async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText(panelText['main'], { ...HTML, reply_markup: panelKb['main'] });
    panelMessageId.set(ctx.from.id, ctx.callbackQuery.message!.message_id);
  });

  for (const section of ['users', 'promo', 'server'] as const) {
    bot.callbackQuery(`admin:${section}`, async (ctx) => {
      if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(panelText[section], { ...HTML, reply_markup: panelKb[section] });
    });
  }

  bot.callbackQuery('admin:terminal', async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    addWithTTL(awaitingShell, ctx.from.id);
    await ctx.editMessageText(panelText['terminal'], { ...HTML, reply_markup: panelKb['terminal'] });
  });

  // ─── Users ───────────────────────────────────────────────────────────────

  bot.callbackQuery('admin:users:list', async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    try {
      const xrayUsers = xrayListUsers();
      const dbUsers = listUsers();
      const dbMap = new Map(dbUsers.map(u => [u.xray_username, u]));

      if (xrayUsers.length === 0) { await ctx.reply('Пользователей нет.'); return; }

      const allStats = queryAllStats('all');
      const statsMap = new Map(allStats.map(s => [s.name, s]));

      const kb = new InlineKeyboard();
      let text = `👥 <b>Пользователи (${xrayUsers.length}):</b>\n\n`;
      for (const u of xrayUsers) {
        const dbUser = dbMap.get(u.name);
        const tg = dbUser?.telegram_username
          ? `@${escapeHtml(dbUser.telegram_username)}`
          : escapeHtml(dbUser?.first_name || '—');
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

  bot.callbackQuery('admin:users:add', async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    addWithTTL(awaitingAddUser, ctx.from.id);
    await ctx.editMessageText(
      '👥 <b>Пользователи</b>\n\nВведи имя нового пользователя (латиница):',
      { ...HTML, reply_markup: new InlineKeyboard().text('◀️ Отмена', 'admin:users') },
    );
  });

  bot.callbackQuery('admin:users:del', async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    try {
      const xrayUsers = xrayListUsers();
      if (xrayUsers.length === 0) { await ctx.answerCallbackQuery('Пользователей нет'); return; }
      const kb = new InlineKeyboard();
      for (const u of xrayUsers) kb.text(`❌ ${u.name}`, `del_user:${u.name}`).row();
      kb.text('◀️ Назад', 'admin:users');
      await ctx.editMessageText('👥 <b>Удалить пользователя:</b>', { ...HTML, reply_markup: kb });
    } catch (e) {
      await ctx.reply(`Ошибка: ${escapeHtml((e as Error).message)}`, HTML);
    }
  });

  // ─── Promos ───────────────────────────────────────────────────────────────

  bot.callbackQuery('admin:promo:create', async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    createPromoCode(code, ctx.from.id);
    await ctx.reply(`🎫 Создан: <code>${code}</code>`, HTML);
  });

  bot.callbackQuery('admin:promo:list', async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    const codes = listPromoCodes();
    if (codes.length === 0) { await ctx.reply('Промокодов нет.'); return; }
    let text = '📋 <b>Промокоды:</b>\n\n';
    for (const c of codes.slice(0, 20)) {
      const status = c.used_by ? '✅ использован' : '⏳ активен';
      text += `• <code>${escapeHtml(c.code)}</code> — ${status}\n`;
    }
    await ctx.reply(text, HTML);
  });

  bot.callbackQuery('admin:promo:del', async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    const codes = listPromoCodes().filter(c => c.used_by === null);
    if (codes.length === 0) { await ctx.answerCallbackQuery('Нет активных промокодов'); return; }
    const kb = new InlineKeyboard();
    for (const c of codes.slice(0, 20)) kb.text(`❌ ${c.code}`, `del_promo:${c.code}`).row();
    kb.text('◀️ Назад', 'admin:promo');
    await ctx.editMessageText('🎫 <b>Удалить промокод:</b>', { ...HTML, reply_markup: kb });
  });

  // ─── Server ───────────────────────────────────────────────────────────────

  bot.callbackQuery('admin:server:status', async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    try {
      const status = getXrayStatus();
      await ctx.reply(`<pre>${escapeHtml(status.slice(0, 3800))}</pre>`, HTML);
    } catch (e) {
      await ctx.reply(`Ошибка: ${escapeHtml((e as Error).message)}`, HTML);
    }
  });

  bot.callbackQuery('admin:server:restart', async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    try {
      await flushTraffic();
      restartXray();
      await ctx.editMessageText('✅ xray перезапущен.', { ...HTML, reply_markup: new InlineKeyboard().text('◀️ Назад', 'admin:server') });
    } catch (e) {
      await ctx.reply(`Ошибка: ${escapeHtml((e as Error).message)}`, HTML);
    }
  });

  bot.callbackQuery('admin:server:reboot', async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('⚠️ Перезагрузить сервер?', {
      reply_markup: new InlineKeyboard()
        .text('✅ Да', 'confirm:reboot')
        .text('❌ Отмена', 'admin:server'),
    });
  });

  bot.callbackQuery('admin:server:shutdown', async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('⚠️ Выключить сервер?', {
      reply_markup: new InlineKeyboard()
        .text('✅ Да', 'confirm:shutdown')
        .text('❌ Отмена', 'admin:server'),
    });
  });

  bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) { await ctx.answerCallbackQuery('Нет доступа'); return; }
    await ctx.answerCallbackQuery();
    const action = ctx.match[1];
    if (action === 'reboot')   { await ctx.editMessageText('🔁 Перезагрузка сервера...'); rebootServer(); return; }
    if (action === 'shutdown') { await ctx.editMessageText('⛔ Выключение сервера...'); shutdownServer(); return; }
  });

  // ─── User detail ─────────────────────────────────────────────────────────

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
    const name   = ctx.match[1];
    const period = ctx.match[2] as TrafficPeriod;
    await ctx.editMessageText(
      buildUserDetailMessage(name, period),
      { ...HTML, reply_markup: buildUserDetailKeyboard(name, period) },
    );
  });

  // ─── Delete user ─────────────────────────────────────────────────────────

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
    if (name === 'cancel') { await ctx.editMessageText('Отменено.'); return; }
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

  // ─── Delete promo ─────────────────────────────────────────────────────────

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

  // ─── Shell command ────────────────────────────────────────────────────────

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

  // ─── Text input handler ───────────────────────────────────────────────────

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
        // Restore panel
        await openPanel(ctx, 'users');
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
    await ctx.api.editMessageText(
      ctx.chat!.id, msg.message_id,
      `Ошибка: ${escapeHtml((e as Error).message)}`,
      HTML,
    );
  }
}
