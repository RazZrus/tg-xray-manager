import { Bot, Context, InlineKeyboard, InputFile } from 'grammy'
import type { InlineKeyboardMarkup } from 'grammy/types'
import fs from 'fs'
import { store } from '../store/index.js'
import { TrafficPeriod } from '../services/TrafficService.js'
import { loadConfig } from '../config.js'
import { escapeHtml } from '../utils.js'
import type { UserSettings } from '../api/db/settings.js'

const awaitingPromoCode   = new Set<number>()
const awaitingXrayName    = new Map<number, string>() // telegramId → promo code
const awaitingDisplayName = new Set<number>()

const HTML       = { parse_mode: 'HTML' as const }
const NO_PREVIEW = { link_preview_options: { is_disabled: true } }

function checkIsAdmin(userId: number): boolean {
  const config = loadConfig()

  return config.adminIds.includes(userId) || store.users.find(userId)?.is_admin === 1
}

function getDisplayName(userId: number, firstName: string): string {
  const s = store.settings.getSettings(userId)

  return s.display_name || firstName
}

function buildUserMenuKb(userId: number): InlineKeyboard {
  const s = store.settings.getSettings(userId)
  const m = s.mini_ui === 1
  const kb = new InlineKeyboard()
    .text(m ? '🔗' : '🔗 Ссылки',    'user:link').row()
    .text(m ? '📱' : '📱 QR-код',     'user:qr').row()
    .text(m ? '📊' : '📊 Трафик',     'user:me').row()
    .text(m ? '📖' : '📖 Инструкция', 'guide:menu').row()
    .text(m ? '⚙️' : '⚙️ Настройки', 'settings:menu')
  if (checkIsAdmin(userId)) {
    kb.row().text(m ? '⚡' : '⚡ Админ-панель', 'admin:main')
  }

  return kb
}

// ─── Settings helpers ─────────────────────────────────────────────────────────

function buildSettingsText(s: UserSettings, firstName: string): string {
  const langLabel = s.lang === 'en' ? '🇬🇧 English' : '🇷🇺 Русский'
  const uiLabel   = s.mini_ui ? 'Мини (только иконки)' : 'Стандартный'
  const nameLabel = escapeHtml(s.display_name || firstName || '—')

  return (
    `⚙️ <b>Настройки</b>\n\n` +
    `🌐 Язык: ${langLabel}\n` +
    `📱 Интерфейс: ${uiLabel}\n` +
    `👤 Имя: ${nameLabel}`
  )
}

function buildSettingsKb(s: UserSettings, isAdmin: boolean): InlineKeyboard {
  const langLabel  = s.lang === 'en' ? '🌐 Язык: 🇬🇧 English' : '🌐 Язык: 🇷🇺 Русский'
  const uiLabel    = s.mini_ui ? '📱 Мини-интерфейс: вкл ✅' : '📱 Мини-интерфейс: выкл'
  const kb = new InlineKeyboard()
    .text(langLabel, 'settings:lang').row()
    .text(uiLabel,   'settings:mini_ui').row()
    .text('👤 Сменить имя',   'settings:name').row()
    .text('📡 Пинг',          'settings:ping').row()
    .text('💨 Тест скорости', 'settings:speed').row()
  if (isAdmin) {
    const statsLabel = s.midnight_stats ? '🌙 Отчёт в полночь: вкл ✅' : '🌙 Отчёт в полночь: выкл'
    kb.text(statsLabel, 'settings:midnight_stats').row()
  }
  kb.text('◀️ Назад', 'user:menu')

  return kb
}

export function registerUserHandlers(bot: Bot<Context>): void {

  // ─── Start / Main menu ───────────────────────────────────────────────────

  bot.command('start', async (ctx) => {
    const user = store.users.find(ctx.from!.id)
    if (user?.xray_username) {
      const name = getDisplayName(ctx.from!.id, ctx.from!.first_name ?? '')
      await ctx.reply(
        `Привет, ${escapeHtml(name)}! Ты подключён как <code>${escapeHtml(user.xray_username)}</code>.`,
        { ...HTML, reply_markup: buildUserMenuKb(ctx.from!.id) }
      )
    } else {
      await ctx.reply(
        'Привет! Это VPN-бот.\n\nЧтобы получить доступ, нажми кнопку ниже.',
        {
          reply_markup: new InlineKeyboard()
            .text('🔑 Получить доступ', 'register').row()
            .text('📖 Инструкция по подключению', 'guide:menu'),
        }
      )
    }
  })

  // Shows main menu — tries to edit current message, falls back to new message
  bot.callbackQuery('user:menu', async (ctx) => {
    await ctx.answerCallbackQuery()
    const user = store.users.find(ctx.from.id)
    if (user?.xray_username) {
      const name = getDisplayName(ctx.from.id, ctx.from.first_name ?? '')
      const text = `Привет, ${escapeHtml(name)}! Ты подключён как <code>${escapeHtml(user.xray_username)}</code>.`
      const kb   = buildUserMenuKb(ctx.from.id)
      try {
        await ctx.editMessageText(text, { ...HTML, reply_markup: kb })
      } catch {
        await ctx.reply(text, { ...HTML, reply_markup: kb })
      }
    } else {
      const text = 'Привет! Это VPN-бот.\n\nЧтобы получить доступ, нажми кнопку ниже.'
      const kb   = new InlineKeyboard()
        .text('🔑 Получить доступ', 'register').row()
        .text('📖 Инструкция по подключению', 'guide:menu')
      try {
        await ctx.editMessageText(text, { reply_markup: kb })
      } catch {
        await ctx.reply(text, { reply_markup: kb })
      }
    }
  })

  // ─── Links ───────────────────────────────────────────────────────────────

  async function sendLinks(ctx: Context): Promise<void> {
    const user = store.users.find(ctx.from!.id)
    if (!user?.xray_username) {return}
    try {
      const tcpLink = store.users.getLink(user.xray_username)
      let grpcLink = ''
      try { grpcLink = store.users.getGrpcLink(user.xray_username) } catch { /* gRPC inbound optional */ }
      const linkText = grpcLink
        ? `TCP (основной):\n<code>${escapeHtml(tcpLink)}</code>\n\ngRPC (резервный):\n<code>${escapeHtml(grpcLink)}</code>`
        : `<code>${escapeHtml(tcpLink)}</code>`
      await ctx.reply(
        `🔗 <b>Ссылки на подключение</b> — нажми, чтобы скопировать\n\n${linkText}`,
        { ...HTML, reply_markup: new InlineKeyboard().text('◀️ Назад', 'user:menu') }
      )
    } catch (e) {
      await ctx.reply(`Ошибка: ${escapeHtml((e as Error).message)}`, HTML)
    }
  }

  bot.callbackQuery('user:link', async (ctx) => {
    await ctx.answerCallbackQuery()
    const user = store.users.find(ctx.from.id)
    if (!user?.xray_username) {return}
    await sendLinks(ctx)
  })

  bot.command('link', async (ctx) => {
    const user = store.users.find(ctx.from!.id)
    if (!user?.xray_username) { await ctx.reply('Ты не зарегистрирован. Используй /register.'); return }
    await sendLinks(ctx)
  })

  // ─── QR ──────────────────────────────────────────────────────────────────

  async function sendQr(ctx: Context): Promise<void> {
    const user = store.users.find(ctx.from!.id)
    if (!user?.xray_username) {return}
    let qrPath: string | undefined
    try {
      const serverName = loadConfig().serverName
      qrPath = store.users.getQrPath(user.xray_username)
      await ctx.replyWithPhoto(new InputFile(qrPath), {
        caption: `📱 QR-код — ${escapeHtml(serverName)}`,
        ...HTML,
        reply_markup: new InlineKeyboard().text('◀️ Назад', 'user:menu'),
      })
    } catch (e) {
      await ctx.reply(`Ошибка генерации QR: ${escapeHtml((e as Error).message)}`, HTML)
    } finally {
      if (qrPath) {try { fs.unlinkSync(qrPath) } catch { /* cleanup best-effort */ }}
    }
  }

  bot.callbackQuery('user:qr', async (ctx) => {
    await ctx.answerCallbackQuery()
    const user = store.users.find(ctx.from.id)
    if (!user?.xray_username) {return}
    await sendQr(ctx)
  })

  bot.command('qr', async (ctx) => {
    const user = store.users.find(ctx.from!.id)
    if (!user?.xray_username) { await ctx.reply('Ты не зарегистрирован. Используй /register.'); return }
    await sendQr(ctx)
  })

  // ─── Traffic ─────────────────────────────────────────────────────────────

  bot.callbackQuery('user:me', async (ctx) => {
    await ctx.answerCallbackQuery()
    const user = store.users.find(ctx.from.id)
    if (!user?.xray_username) {return}
    const text = buildTrafficMessage(user.xray_username, 'all')
    const kb   = buildPeriodKeyboard(user.xray_username, 'all')
    try {
      await ctx.editMessageText(text, { ...HTML, reply_markup: kb })
    } catch {
      await ctx.reply(text, { ...HTML, reply_markup: kb })
    }
  })

  bot.command('me', async (ctx) => {
    const user = store.users.find(ctx.from!.id)
    if (!user?.xray_username) { await ctx.reply('Ты не зарегистрирован. Используй /register.'); return }
    const text = buildTrafficMessage(user.xray_username, 'all')
    const kb   = buildPeriodKeyboard(user.xray_username, 'all')
    await ctx.reply(text, { ...HTML, reply_markup: kb })
  })

  bot.callbackQuery(/^my_traffic:(.+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const username = ctx.match[1]
    const period   = ctx.match[2] as TrafficPeriod
    await ctx.editMessageText(
      buildTrafficMessage(username, period),
      { ...HTML, reply_markup: buildPeriodKeyboard(username, period) }
    )
  })

  // ─── Settings ─────────────────────────────────────────────────────────────

  async function showSettings(ctx: Context): Promise<void> {
    const userId  = ctx.from!.id
    const s       = store.settings.getSettings(userId)
    const isAdmin = checkIsAdmin(userId)
    const text    = buildSettingsText(s, ctx.from!.first_name ?? '')
    const kb      = buildSettingsKb(s, isAdmin)
    try {
      await ctx.editMessageText(text, { ...HTML, reply_markup: kb })
    } catch {
      await ctx.reply(text, { ...HTML, reply_markup: kb })
    }
  }

  bot.callbackQuery('settings:menu', async (ctx) => {
    await ctx.answerCallbackQuery()
    await showSettings(ctx)
  })

  bot.callbackQuery('settings:lang', async (ctx) => {
    await ctx.answerCallbackQuery()
    const userId = ctx.from.id
    const s = store.settings.getSettings(userId)
    store.settings.setSetting(userId, 'lang', s.lang === 'ru' ? 'en' : 'ru')
    await showSettings(ctx)
  })

  bot.callbackQuery('settings:mini_ui', async (ctx) => {
    await ctx.answerCallbackQuery()
    const userId = ctx.from.id
    const s = store.settings.getSettings(userId)
    store.settings.setSetting(userId, 'mini_ui', s.mini_ui ? 0 : 1)
    await showSettings(ctx)
  })

  bot.callbackQuery('settings:name', async (ctx) => {
    await ctx.answerCallbackQuery()
    const userId = ctx.from.id
    awaitingDisplayName.add(userId)
    try {
      await ctx.editMessageText(
        '👤 <b>Смена имени</b>\n\nВведи новое имя (до 64 символов):',
        { ...HTML, reply_markup: new InlineKeyboard().text('❌ Отмена', 'settings:menu') }
      )
    } catch {
      await ctx.reply('Введи новое имя:', HTML)
    }
  })

  bot.callbackQuery('settings:ping', async (ctx) => {
    await ctx.answerCallbackQuery('Пингую 1.1.1.1...')
    const msg = await ctx.reply('📡 <b>Пинг до 1.1.1.1...</b>', HTML)
    const result = store.system.pingTest()
    await ctx.api.editMessageText(
      ctx.chat!.id, msg.message_id,
      `📡 <b>Пинг</b>\n\n<pre>${escapeHtml(result)}</pre>`,
      { ...HTML, reply_markup: new InlineKeyboard().text('◀️ Назад', 'settings:menu') }
    )
  })

  bot.callbackQuery('settings:speed', async (ctx) => {
    await ctx.answerCallbackQuery('Запускаю тест...')
    const msg = await ctx.reply('💨 <b>Тест скорости</b>\n\nЗагружаю 10 МБ с Cloudflare...\nЭто займёт до 20 секунд.', HTML)
    const result = store.system.speedTest()
    await ctx.api.editMessageText(
      ctx.chat!.id, msg.message_id,
      `💨 <b>Скорость сервера</b>\n\n${escapeHtml(result)}`,
      { ...HTML, reply_markup: new InlineKeyboard().text('◀️ Назад', 'settings:menu') }
    )
  })

  bot.callbackQuery('settings:midnight_stats', async (ctx) => {
    await ctx.answerCallbackQuery()
    const userId = ctx.from.id
    if (!checkIsAdmin(userId)) {return}
    const s = store.settings.getSettings(userId)
    store.settings.setSetting(userId, 'midnight_stats', s.midnight_stats ? 0 : 1)
    await showSettings(ctx)
  })

  // ─── Register ────────────────────────────────────────────────────────────

  bot.command('register', startRegister)
  bot.callbackQuery('register', async (ctx) => {
    await ctx.answerCallbackQuery()
    await startRegister(ctx)
  })

  async function startRegister(ctx: Context) {
    const telegramId = ctx.from!.id
    const user = store.users.find(telegramId)
    if (user?.xray_username) {
      await ctx.reply(`Ты уже зарегистрирован как <code>${escapeHtml(user.xray_username)}</code>.`, HTML)

      return
    }
    awaitingPromoCode.add(telegramId)
    await ctx.reply('Введи промокод:')
  }

  // ─── Guide ───────────────────────────────────────────────────────────────

  const guideMenuKb = new InlineKeyboard()
    .text('🤖 Android', 'guide:android').row()
    .text('🍎 iOS',     'guide:ios').row()
    .text('🖥 Windows', 'guide:windows').row()
    .text('🍏 macOS',   'guide:mac').row()
    .text('◀️ Назад',   'user:menu')

  const guidePlatformKb = new InlineKeyboard()
    .text('🔗 Получить ссылки', 'user:link').row()
    .text('◀️ Назад', 'guide:back')

  const guideText = {
    menu: '📖 <b>Инструкция по подключению</b>\n\nВыбери свою платформу:',

    android: `📱 <b>Android — Happ</b>

1. Скачай <a href="https://play.google.com/store/apps/details?id=com.happproxy">Happ</a> из Google Play

2. Нажми кнопку ниже — скопируй ссылку <code>vless://...</code>

3. В Happ нажми <b>+</b> → вставь ссылку

4. Включи VPN`,

    ios: `📱 <b>iOS — Happ</b>

1. Установи через TestFlight:
   • <a href="https://testflight.apple.com/join/XMls6Ckd">Global</a>
   • <a href="https://testflight.apple.com/join/ystvnbsP">Россия</a>

2. Нажми кнопку ниже — скопируй ссылку или получи QR-код

3. В Happ нажми <b>+</b> → вставь ссылку или <b>Scan QR Code</b>

4. Включи VPN`,

    windows: `🖥 <b>Windows — Happ</b>

1. <a href="https://github.com/Happ-proxy/happ-desktop/releases/latest/download/setup-Happ.x64.exe">Скачай Happ</a> и установи

2. Нажми кнопку ниже — скопируй ссылку <code>vless://...</code>

3. В Happ нажми <b>+</b> → вставь ссылку

4. Включи VPN`,

    mac: `🍏 <b>macOS — Happ</b>

1. <a href="https://github.com/Happ-proxy/happ-desktop/releases/latest/download/Happ.macOS.universal.dmg">Скачай Happ DMG</a> и перенеси в Applications

2. Нажми кнопку ниже — скопируй ссылку <code>vless://...</code>

3. В Happ нажми <b>+</b> → вставь ссылку

4. Включи VPN`,
  }

  bot.command('guide', async (ctx) => {
    await ctx.reply(guideText.menu, { ...HTML, reply_markup: guideMenuKb, ...NO_PREVIEW })
  })

  bot.callbackQuery('guide:menu', async (ctx) => {
    await ctx.answerCallbackQuery()
    try {
      await ctx.editMessageText(guideText.menu, { ...HTML, reply_markup: guideMenuKb, ...NO_PREVIEW })
    } catch {
      await ctx.reply(guideText.menu, { ...HTML, reply_markup: guideMenuKb, ...NO_PREVIEW })
    }
  })

  for (const platform of ['android', 'ios', 'windows', 'mac'] as const) {
    bot.callbackQuery(`guide:${platform}`, async (ctx) => {
      await ctx.answerCallbackQuery()
      await ctx.editMessageText(guideText[platform], {
        ...HTML, reply_markup: guidePlatformKb, ...NO_PREVIEW,
      })
    })
  }

  bot.callbackQuery('guide:back', async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.editMessageText(guideText.menu, { ...HTML, reply_markup: guideMenuKb, ...NO_PREVIEW })
  })

  // ─── Text input ───────────────────────────────────────────────────────────

  bot.on('message:text', async (ctx, next) => {
    const telegramId = ctx.from.id
    const text       = ctx.message.text.trim()

    if (awaitingDisplayName.has(telegramId)) {
      awaitingDisplayName.delete(telegramId)
      const name = text.slice(0, 64)
      if (!name) {
        await ctx.reply('Имя не может быть пустым.')

        return
      }
      store.settings.setSetting(telegramId, 'display_name', name)
      await ctx.reply(
        `✅ Имя изменено: <b>${escapeHtml(name)}</b>`,
        { ...HTML, reply_markup: new InlineKeyboard().text('⚙️ Настройки', 'settings:menu') }
      )

      return
    }

    if (awaitingPromoCode.has(telegramId)) {
      awaitingPromoCode.delete(telegramId)
      const promo = store.promo.find(text)
      if (!promo) {
        await ctx.reply('Неверный промокод. Попробуй ещё раз или обратись к администратору.')

        return
      }
      if (promo.used_by !== null) {
        await ctx.reply('Этот промокод уже использован.')

        return
      }
      awaitingXrayName.set(telegramId, text)
      await ctx.reply(
        'Промокод принят! Теперь введи своё имя для VPN (латиница, без пробелов, например: <code>ivan</code>):',
        HTML
      )

      return
    }

    if (text.startsWith('vless://')) {
      await handleVlessLink(ctx, text)

      return
    }

    const pendingCode = awaitingXrayName.get(telegramId)
    if (pendingCode) {
      const xrayName = text.toLowerCase().replace(/[^a-z0-9_-]/g, '')
      if (!xrayName || xrayName.length < 2) {
        await ctx.reply('Имя должно содержать минимум 2 латинских символа. Попробуй ещё раз:')

        return
      }
      awaitingXrayName.delete(telegramId)
      await ctx.reply('Создаю твой VPN-аккаунт...')
      try {
        if (!store.promo.redeem(pendingCode, telegramId)) {
          await ctx.reply('Этот промокод уже использован.')

          return
        }
        const tcpLink = store.users.xrayAdd(xrayName)
        store.users.upsert({
          telegram_id:       telegramId,
          telegram_username: ctx.from.username  ?? null,
          first_name:        ctx.from.first_name ?? null,
          last_name:         ctx.from.last_name  ?? null,
          xray_username:     xrayName,
        })
        let grpcLink = ''
        try { grpcLink = store.users.getGrpcLink(xrayName) } catch { /* gRPC inbound optional */ }
        const linkText = grpcLink
          ? `TCP (основной):\n<code>${escapeHtml(tcpLink)}</code>\n\ngRPC (резервный):\n<code>${escapeHtml(grpcLink)}</code>`
          : `<code>${escapeHtml(tcpLink)}</code>`
        await ctx.reply(
          `✅ <b>Аккаунт создан!</b>\n\nИмя: <code>${escapeHtml(xrayName)}</code>\n\n🔗 <b>Ссылки на подключение</b> — нажми, чтобы скопировать:\n\n${linkText}`,
          { ...HTML, reply_markup: buildUserMenuKb(telegramId) }
        )
        await notifyAdmins(
          bot,
          `👤 Новый пользователь зарегистрировался!\n\nTelegram: ${escapeHtml(ctx.from.first_name ?? '')}${ctx.from.username ? ` (@${escapeHtml(ctx.from.username)})` : ''}\nVPN имя: <code>${escapeHtml(xrayName)}</code>`
        )
      } catch (e) {
        awaitingXrayName.delete(telegramId)
        await ctx.reply(`Ошибка создания аккаунта: ${escapeHtml((e as Error).message)}`, HTML)
      }

      return
    }

    return next()
  })
}

async function handleVlessLink(ctx: Context, link: string): Promise<void> {
  const telegramId = ctx.from!.id
  const existing   = store.users.find(telegramId)
  if (existing?.xray_username) {
    await ctx.reply(`Ты уже зарегистрирован как <code>${escapeHtml(existing.xray_username)}</code>.`, HTML)

    return
  }
  const match = link.match(/^vless:\/\/([0-9a-f-]{36})@/i)
  if (!match) {
    await ctx.reply('Не удалось распознать ссылку. Убедись, что это vless:// ссылка от этого сервера.')

    return
  }
  const xrayName = store.users.xrayFindByUuid(match[1])
  if (!xrayName) {
    await ctx.reply('Ссылка не найдена в системе. Обратись к администратору.')

    return
  }
  const taken = store.users.findByXrayName(xrayName)
  if (taken && taken.telegram_id !== telegramId) {
    await ctx.reply('Этот VPN-аккаунт уже привязан к другому пользователю Telegram.')

    return
  }
  store.users.upsert({
    telegram_id:       telegramId,
    telegram_username: ctx.from!.username  ?? null,
    first_name:        ctx.from!.first_name ?? null,
    last_name:         ctx.from!.last_name  ?? null,
    xray_username:     xrayName,
  })
  await ctx.reply(
    `✅ <b>Аккаунт привязан!</b>\n\nVPN имя: <code>${escapeHtml(xrayName)}</code>`,
    { ...HTML, reply_markup: buildUserMenuKb(telegramId) }
  )
}

function buildTrafficMessage(username: string, period: TrafficPeriod): string {
  const stats = store.traffic.queryUser(username, period)
  const label = store.traffic.PERIOD_LABELS[period]

  return (
    `📊 <b>${escapeHtml(username)}</b> — ${label}\n\n` +
    `⬆️ Отправлено: ${store.traffic.formatBytes(stats.upload)}\n` +
    `⬇️ Получено:   ${store.traffic.formatBytes(stats.download)}\n` +
    `📦 Итого:      ${store.traffic.formatBytes(stats.upload + stats.download)}`
  )
}

function buildPeriodKeyboard(username: string, current: TrafficPeriod): InlineKeyboardMarkup {
  const periods: TrafficPeriod[] = ['hour', 'day', 'week', 'month', 'year', 'all']
  const kb = new InlineKeyboard()
  for (const p of periods) {
    const label = p === current ? `· ${store.traffic.PERIOD_LABELS[p]} ·` : store.traffic.PERIOD_LABELS[p]
    kb.text(label, `my_traffic:${username}:${p}`).row()
  }
  kb.text('◀️ Назад', 'user:menu')

  return kb
}

async function notifyAdmins(bot: Bot<Context>, message: string): Promise<void> {
  const admins   = store.users.listAdmins()
  const config   = loadConfig()
  const adminIds = new Set([...admins.map(a => a.telegram_id), ...config.adminIds])
  await Promise.allSettled([...adminIds].map(id => bot.api.sendMessage(id, message, HTML)))
}

export { notifyAdmins }
