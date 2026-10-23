import { Bot, Context, InlineKeyboard } from 'grammy';
import crypto from 'crypto';
import {
  listUsers,
  findUser,
  upsertUser,
  deleteUser as dbDeleteUser,
  createPromoCode,
  listPromoCodes,
} from '../db/index.js';
import {
  listUsers as xrayListUsers,
  addUser,
  deleteUser as xrayDeleteUser,
  getUserLink,
  getUserQrPath,
  getXrayStatus,
  restartXray,
  runShellCommand,
  rebootServer,
  shutdownServer,
} from '../services/xray.js';
import { loadConfig } from '../config.js';
import fs from 'fs';

// Ожидание ввода для команд
const awaitingShell = new Set<number>();
const awaitingAddUser = new Set<number>();
const awaitingDelUser = new Set<number>();

// Ожидание подтверждений (reboot/shutdown)
const pendingConfirm = new Map<number, 'reboot' | 'shutdown'>();

export function isAdmin(telegramId: number): boolean {
  const config = loadConfig();
  if (config.adminIds.includes(telegramId)) return true;
  const user = findUser(telegramId);
  return user?.is_admin === 1;
}

export function adminMiddleware(ctx: Context, next: () => Promise<void>): Promise<void> {
  if (!ctx.from) return next();

  // Проверяем только команды /admin и /shell
  const text = ctx.message?.text || ctx.callbackQuery?.data || '';
  const isAdminCommand = text.startsWith('/admin') || text.startsWith('/shell') ||
    awaitingShell.has(ctx.from.id) ||
    awaitingAddUser.has(ctx.from.id) ||
    awaitingDelUser.has(ctx.from.id) ||
    pendingConfirm.has(ctx.from.id);

  if (isAdminCommand && !isAdmin(ctx.from.id)) {
    return ctx.reply('Нет доступа.').then(() => {});
  }

  return next();
}

export function registerAdminHandlers(bot: Bot<Context>): void {
  // /admin — главное меню
  bot.command('admin', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) {
      await ctx.reply('Нет доступа.');
      return;
    }
    await showAdminMenu(ctx);
  });

  async function showAdminMenu(ctx: Context) {
    const keyboard = new InlineKeyboard()
      .text('👥 Пользователи', 'admin:users').row()
      .text('➕ Добавить пользователя', 'admin:add_user').row()
      .text('🎫 Создать промокод', 'admin:gen_code').row()
      .text('📋 Промокоды', 'admin:list_codes').row()
      .text('⚙️ Статус xray', 'admin:status').row()
      .text('🔄 Рестарт xray', 'admin:restart').row()
      .text('💻 Shell-команда', 'admin:shell').row()
      .text('🔁 Перезагрузить сервер', 'admin:reboot')
      .text('⛔ Выключить сервер', 'admin:shutdown');

    await ctx.reply('Панель администратора:', { reply_markup: keyboard });
  }

  // Обработка callback-кнопок админа
  bot.callbackQuery(/^admin:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCallbackQuery('Нет доступа');
      return;
    }

    await ctx.answerCallbackQuery();
    const action = ctx.match[1];

    switch (action) {
      case 'users': {
        await ctx.reply('Загружаю список...');
        try {
          const xrayUsers = xrayListUsers();
          const dbUsers = listUsers();
          const dbMap = new Map(dbUsers.map(u => [u.xray_username, u]));

          if (xrayUsers.length === 0) {
            await ctx.reply('Пользователей нет.');
            return;
          }

          let text = '👥 *Пользователи:*\n\n';
          for (const u of xrayUsers) {
            const dbUser = dbMap.get(u.name);
            const tg = dbUser?.telegram_username ? `@${dbUser.telegram_username}` : dbUser?.first_name || '—';
            text += `• \`${u.name}\` (${tg})\n  ⬆️ ${u.upload} / ⬇️ ${u.download}\n`;
          }
          await ctx.reply(text, { parse_mode: 'Markdown' });
        } catch (e) {
          await ctx.reply(`Ошибка: ${(e as Error).message}`);
        }
        break;
      }

      case 'add_user': {
        awaitingAddUser.add(ctx.from.id);
        await ctx.reply('Введи имя нового пользователя (латиница):');
        break;
      }

      case 'gen_code': {
        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        createPromoCode(code, ctx.from.id);
        await ctx.reply(
          `🎫 Промокод создан:\n\n\`${code}\`\n\nОднократное использование.`,
          { parse_mode: 'Markdown' }
        );
        break;
      }

      case 'list_codes': {
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
        break;
      }

      case 'status': {
        try {
          const status = getXrayStatus();
          await ctx.reply(`\`\`\`\n${status.slice(0, 3800)}\n\`\`\``, { parse_mode: 'Markdown' });
        } catch (e) {
          await ctx.reply(`Ошибка: ${(e as Error).message}`);
        }
        break;
      }

      case 'restart': {
        try {
          restartXray();
          await ctx.reply('✅ xray перезапущен.');
        } catch (e) {
          await ctx.reply(`Ошибка: ${(e as Error).message}`);
        }
        break;
      }

      case 'shell': {
        awaitingShell.add(ctx.from.id);
        await ctx.reply('Введи команду для выполнения:');
        break;
      }

      case 'reboot': {
        pendingConfirm.set(ctx.from.id, 'reboot');
        await ctx.reply(
          '⚠️ Подтверди перезагрузку сервера:',
          {
            reply_markup: new InlineKeyboard()
              .text('✅ Да, перезагрузить', 'confirm:reboot')
              .text('❌ Отмена', 'confirm:cancel'),
          }
        );
        break;
      }

      case 'shutdown': {
        pendingConfirm.set(ctx.from.id, 'shutdown');
        await ctx.reply(
          '⚠️ Подтверди выключение сервера:',
          {
            reply_markup: new InlineKeyboard()
              .text('✅ Да, выключить', 'confirm:shutdown')
              .text('❌ Отмена', 'confirm:cancel'),
          }
        );
        break;
      }
    }
  });

  // Подтверждения опасных действий
  bot.callbackQuery(/^confirm:(.+)$/, async (ctx) => {
    if (!isAdmin(ctx.from.id)) {
      await ctx.answerCallbackQuery('Нет доступа');
      return;
    }

    await ctx.answerCallbackQuery();
    const action = ctx.match[1];

    if (action === 'cancel') {
      pendingConfirm.delete(ctx.from.id);
      await ctx.reply('Отменено.');
      return;
    }

    if (action === 'reboot') {
      await ctx.reply('🔁 Перезагрузка сервера...');
      rebootServer();
      return;
    }

    if (action === 'shutdown') {
      await ctx.reply('⛔ Выключение сервера...');
      shutdownServer();
      return;
    }
  });

  // /shell <command>
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

  // Обработка текстовых сообщений
  bot.on('message:text', async (ctx, next) => {
    const telegramId = ctx.from!.id;
    const text = ctx.message.text.trim();

    // Shell-режим
    if (awaitingShell.has(telegramId)) {
      if (!isAdmin(telegramId)) {
        awaitingShell.delete(telegramId);
        return next();
      }
      awaitingShell.delete(telegramId);
      await executeShell(ctx, text);
      return;
    }

    // Добавление пользователя
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

      await ctx.reply(`Создаю пользователя \`${name}\`...`, { parse_mode: 'Markdown' });
      try {
        const link = addUser(name);
        upsertUser({
          telegram_id: 0, // заглушка — пользователь без TG аккаунта
          telegram_username: null,
          first_name: name,
          last_name: null,
          xray_username: name,
        });
        await ctx.reply(
          `✅ Пользователь \`${name}\` создан!\n\nСсылка:\n\`${link}\``,
          { parse_mode: 'Markdown' }
        );
      } catch (e) {
        await ctx.reply(`Ошибка: ${(e as Error).message}`);
      }
      return;
    }

    return next();
  });

  // /deluser <name>
  bot.command('deluser', async (ctx) => {
    if (!isAdmin(ctx.from!.id)) {
      await ctx.reply('Нет доступа.');
      return;
    }

    const name = ctx.message?.text.replace(/^\/deluser\s*/, '').trim() ?? '';
    if (!name) {
      await ctx.reply('Использование: /deluser <имя>');
      return;
    }

    try {
      xrayDeleteUser(name);
      const dbUser = listUsers().find(u => u.xray_username === name);
      if (dbUser) dbDeleteUser(dbUser.telegram_id);
      await ctx.reply(`✅ Пользователь \`${name}\` удалён.`, { parse_mode: 'Markdown' });
    } catch (e) {
      await ctx.reply(`Ошибка: ${(e as Error).message}`);
    }
  });
}

async function executeShell(ctx: Context, command: string): Promise<void> {
  await ctx.reply(`$ ${command}\n\nВыполняю...`);
  try {
    const output = runShellCommand(command);
    const truncated = output.length > 3800 ? output.slice(0, 3800) + '\n...(обрезано)' : output;
    await ctx.reply(`\`\`\`\n$ ${command}\n\n${truncated}\n\`\`\``, { parse_mode: 'Markdown' });
  } catch (e) {
    await ctx.reply(`Ошибка: ${(e as Error).message}`);
  }
}
