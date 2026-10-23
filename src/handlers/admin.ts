import { Bot, Context, InlineKeyboard, Keyboard } from 'grammy';
import crypto from 'crypto';
import {
  listUsers,
  findUser,
  findUserByXrayName,
  upsertUser,
  deleteUser as dbDeleteUser,
  createPromoCode,
  deletePromoCode,
  listPromoCodes,
} from '../db/index.js';
import {
  listUsers as xrayListUsers,
  addUser,
  deleteUser as xrayDeleteUser,
  getXrayStatus,
  restartXray,
  runShellCommand,
  rebootServer,
  shutdownServer,
} from '../services/xray.js';
import { loadConfig } from '../config.js';

const awaitingShell = new Set<number>();
const awaitingAddUser = new Set<number>();

// ID последнего сообщения меню для редактирования
const menuMessageId = new Map<number, number>();

export function isAdmin(telegramId: number): boolean {
  const config = loadConfig();
  if (config.adminIds.includes(telegramId)) return true;
  const user = findUser(telegramId);
  return user?.is_admin === 1;
}

// ─── Клавиатуры ─────────────────────────────────────────────────────────────

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

// ─── Утилиты ────────────────────────────────────────────────────────────────

/** Отправить или отредактировать сообщение меню */
async function sendOrEditMenu(ctx: Context, text: string, keyboard: Keyboard): Promise<void> {
  const chatId = ctx.chat!.id;
  const msgId = menuMessageId.get(ctx.from!.id);

  if (msgId) {
    try {
      await ctx.api.editMessageText(chatId, msgId, text);
      // Reply keyboard нельзя обновить через edit — отправляем невидимое обновление
      await ctx.reply(text, { reply_markup: keyboard });
      const sent = await ctx.reply(text, { reply_markup: keyboard });
      menuMessageId.set(ctx.from!.id, sent.message_id);
      // Удаляем старое сообщение
      try { await ctx.api.deleteMessage(chatId, msgId); } catch {}
      return;
    } catch {
      // Не удалось отредактировать — отправим новое
    }
  }

  const sent = await ctx.reply(text, { reply_markup: keyboard });
  menuMessageId.set(ctx.from!.id, sent.message_id);
}

/** Удалить сообщение пользователя (нажатую кнопку) чтобы не засорять чат */
async function deleteUserMessage(ctx: Context): Promise<void> {
  try {
    if (ctx.message) {
      await ctx.api.deleteMessage(ctx.chat!.id, ctx.message.message_id);
    }
  } catch {}
}

// Текущий раздел для каждого пользователя (чтобы различать одинаковые кнопки)
type Section = 'main' | 'users' | 'promo' | 'server';
const currentSection = new Map<number, Section>();

// ─── Регистрация ────────────────────────────────────────────────────────────

export function registerAdminHandlers(bot: Bot<Context>): void {
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) {
      await ctx.reply('Нет доступа.');
      return;
    }
    currentSection.set(ctx.from!.id, 'main');
    const sent = await ctx.reply('⚡ *Панель администратора*', {
      parse_mode: 'Markdown',
      reply_markup: mainKeyboard,
    });
    menuMessageId.set(ctx.from!.id, sent.message_id);
  });

  // ─── Навигация ──────────────────────────────────────────────────────────

  bot.hears('👥 Пользователи', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    await deleteUserMessage(ctx);
    currentSection.set(ctx.from!.id, 'users');
    await sendOrEditMenu(ctx, '👥 *Пользователи*', usersKeyboard);
  });

  bot.hears('🎫 Промокоды', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    await deleteUserMessage(ctx);
    currentSection.set(ctx.from!.id, 'promo');
    await sendOrEditMenu(ctx, '🎫 *Промокоды*', promoKeyboard);
  });

  bot.hears('⚙️ Сервер', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    await deleteUserMessage(ctx);
    currentSection.set(ctx.from!.id, 'server');
    await sendOrEditMenu(ctx, '⚙️ *Сервер*', serverKeyboard);
  });

  bot.hears('💻 Терминал', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    awaitingShell.add(ctx.from!.id);
    await ctx.reply('Введи команду:');
  });

  bot.hears('◀️ Назад', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    await deleteUserMessage(ctx);
    currentSection.set(ctx.from!.id, 'main');
    await sendOrEditMenu(ctx, '⚡ *Панель администратора*', mainKeyboard);
  });

  // ─── Пользователи ──────────────────────────────────────────────────────

  bot.hears('📋 Список', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    const section = currentSection.get(ctx.from!.id);

    if (section === 'promo') {
      // Список промокодов
      const codes = listPromoCodes();
      if (codes.length === 0) {
        await ctx.reply('Промокодов нет.');
        return;
      }
      let text = '📋 *Промокоды:*\n\n';
      for (const c of codes.slice(0, 20)) {
        const status = c.used_by ? '✅ использован' : '⏳ активен';
        text += `• \`${c.code}\` — ${status}\n`;
      }
      await ctx.reply(text, { parse_mode: 'Markdown' });
      return;
    }

    // Список пользователей (по умолчанию)
    try {
      const xrayUsers = xrayListUsers();
      const dbUsers = listUsers();
      const dbMap = new Map(dbUsers.map(u => [u.xray_username, u]));

      if (xrayUsers.length === 0) {
        await ctx.reply('Пользователей нет.');
        return;
      }

      let text = `👥 *Пользователи (${xrayUsers.length}):*\n\n`;
      for (const u of xrayUsers) {
        const dbUser = dbMap.get(u.name);
        const tg = dbUser?.telegram_username ? `@${dbUser.telegram_username}` : dbUser?.first_name || '—';
        text += `• \`${u.name}\` (${tg})\n  ⬆️ ${u.upload} / ⬇️ ${u.download}\n`;
      }
      await ctx.reply(text, { parse_mode: 'Markdown' });
    } catch (e) {
      await ctx.reply(`Ошибка: ${(e as Error).message}`);
    }
  });

  bot.hears('➕ Добавить', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    awaitingAddUser.add(ctx.from!.id);
    await ctx.reply('Введи имя нового пользователя (латиница):');
  });

  bot.hears('🗑 Удалить', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    const section = currentSection.get(ctx.from!.id);

    if (section === 'promo') {
      // Удаление промокода
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

    // Удаление пользователя (по умолчанию)
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
      await ctx.reply(`Ошибка: ${(e as Error).message}`);
    }
  });

  bot.hears('🎫 Создать', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    createPromoCode(code, ctx.from!.id);
    await ctx.reply(`🎫 Создан: \`${code}\``, { parse_mode: 'Markdown' });
  });

  // ─── Inline: удаление пользователей ────────────────────────────────────

  bot.callbackQuery(/^del_user:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCallbackQuery('Нет доступа');
      return;
    }
    await ctx.answerCallbackQuery();
    const name = ctx.match[1];

    await ctx.editMessageText(`Удалить \`${name}\`?`, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('✅ Да', `confirm_del:${name}`)
        .text('❌ Нет', 'confirm_del:cancel'),
    });
  });

  bot.callbackQuery(/^confirm_del:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCallbackQuery('Нет доступа');
      return;
    }
    await ctx.answerCallbackQuery();
    const name = ctx.match[1];

    if (name === 'cancel') {
      await ctx.editMessageText('Отменено.');
      return;
    }

    try {
      xrayDeleteUser(name);
      const dbUser = findUserByXrayName(name);
      if (dbUser) dbDeleteUser(dbUser.telegram_id);
      await ctx.editMessageText(`✅ \`${name}\` удалён.`, { parse_mode: 'Markdown' });
    } catch (e) {
      await ctx.editMessageText(`Ошибка: ${(e as Error).message}`);
    }
  });

  // ─── Inline: удаление промокодов ───────────────────────────────────────

  bot.callbackQuery(/^del_promo:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCallbackQuery('Нет доступа');
      return;
    }
    await ctx.answerCallbackQuery();
    const code = ctx.match[1];

    try {
      deletePromoCode(code);
      await ctx.editMessageText(`✅ \`${code}\` удалён.`, { parse_mode: 'Markdown' });
    } catch (e) {
      await ctx.editMessageText(`Ошибка: ${(e as Error).message}`);
    }
  });

  // ─── Сервер ─────────────────────────────────────────────────────────────

  bot.hears('📊 Статус', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    try {
      const status = getXrayStatus();
      await ctx.reply(`\`\`\`\n${status.slice(0, 3800)}\n\`\`\``, { parse_mode: 'Markdown' });
    } catch (e) {
      await ctx.reply(`Ошибка: ${(e as Error).message}`);
    }
  });

  bot.hears('🔄 Рестарт', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) return;
    try {
      restartXray();
      await ctx.reply('✅ xray перезапущен.');
    } catch (e) {
      await ctx.reply(`Ошибка: ${(e as Error).message}`);
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
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCallbackQuery('Нет доступа');
      return;
    }
    await ctx.answerCallbackQuery();
    const action = ctx.match[1];

    if (action === 'cancel') {
      await ctx.editMessageText('Отменено.');
      return;
    }
    if (action === 'reboot') {
      await ctx.editMessageText('🔁 Перезагрузка сервера...');
      rebootServer();
      return;
    }
    if (action === 'shutdown') {
      await ctx.editMessageText('⛔ Выключение сервера...');
      shutdownServer();
      return;
    }
  });

  // ─── Shell ──────────────────────────────────────────────────────────────

  bot.command('shell', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) {
      await ctx.reply('Нет доступа.');
      return;
    }
    const command = ctx.message?.text.replace(/^\/shell\s*/, '').trim() ?? '';
    if (!command) {
      awaitingShell.add(ctx.from!.id);
      await ctx.reply('Введи команду:');
      return;
    }
    await executeShell(ctx, command);
  });

  // ─── Текстовый ввод ────────────────────────────────────────────────────

  bot.on('message:text', async (ctx, next) => {
    const telegramId = ctx.from!.id;
    const text = ctx.message.text.trim();

    if (awaitingShell.has(telegramId)) {
      if (!isAdmin(telegramId)) {
        awaitingShell.delete(telegramId);
        return next();
      }
      awaitingShell.delete(telegramId);
      await executeShell(ctx, text);
      return;
    }

    if (awaitingAddUser.has(telegramId)) {
      if (!isAdmin(telegramId)) {
        awaitingAddUser.delete(telegramId);
        return next();
      }
      awaitingAddUser.delete(telegramId);

      const name = text.toLowerCase().replace(/[^a-z0-9_-]/g, '');
      if (!name || name.length < 2) {
        await ctx.reply('Некорректное имя. Используй латинские буквы.');
        return;
      }

      await ctx.reply(`Создаю \`${name}\`...`, { parse_mode: 'Markdown' });
      try {
        const link = addUser(name);
        upsertUser({
          telegram_id: 0,
          telegram_username: null,
          first_name: name,
          last_name: null,
          xray_username: name,
        });
        await ctx.reply(
          `✅ \`${name}\` создан!\n\nСсылка:\n\`${link}\``,
          { parse_mode: 'Markdown' },
        );
      } catch (e) {
        await ctx.reply(`Ошибка: ${(e as Error).message}`);
      }
      return;
    }

    return next();
  });
}

async function executeShell(ctx: Context, command: string): Promise<void> {
  const msg = await ctx.reply(`\`$ ${command}\`\n\nВыполняю...`, { parse_mode: 'Markdown' });
  try {
    const output = runShellCommand(command);
    const truncated = output.length > 3800 ? output.slice(0, 3800) + '\n...(обрезано)' : output;
    await ctx.api.editMessageText(
      ctx.chat!.id, msg.message_id,
      `\`\`\`\n$ ${command}\n\n${truncated}\n\`\`\``,
      { parse_mode: 'Markdown' },
    );
  } catch (e) {
    await ctx.api.editMessageText(
      ctx.chat!.id, msg.message_id,
      `Ошибка: ${(e as Error).message}`,
    );
  }
}
