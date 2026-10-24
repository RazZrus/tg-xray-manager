import { Bot, Context, InlineKeyboard, InputFile } from 'grammy'
import type { InlineKeyboardMarkup } from 'grammy/types'
import fs from 'fs'
import { store } from '../store/index.js'
import { TrafficPeriod } from '../services/TrafficService.js'
import { loadConfig } from '../config.js'
import { escapeHtml } from '../utils.js'

const awaitingPromoCode = new Set<number>()
const awaitingXrayName  = new Map<number, string>() // telegramId → promo code

const HTML = { parse_mode: 'HTML' as const }

export function registerUserHandlers(bot: Bot<Context>): void {
  const registeredMenuKb = new InlineKeyboard()
    .text('🔗 Ссылка', 'user:link').text('📱 QR-код', 'user:qr').row()
    .text('📊 Трафик', 'user:me').text('📖 Инструкция', 'guide:menu')

  bot.command('start', async (ctx) => {
    const user = store.users.find(ctx.from!.id)
    if (user?.xray_username) {
      await ctx.reply(
        `Привет, ${escapeHtml(ctx.from!.first_name ?? '')}! Ты подключён как <code>${escapeHtml(user.xray_username)}</code>.`,
        { ...HTML, reply_markup: registeredMenuKb }
      )
    } else {
      await ctx.reply(
        'Привет! Это VPN-бот.\n\nЧтобы получить доступ, нажми кнопку ниже или используй /register.',
        { reply_markup: new InlineKeyboard().text('Получить доступ', 'register').row().text('📖 Инструкция по подключению', 'guide:menu') }
      )
    }
  })

  bot.callbackQuery('user:link', async (ctx) => {
    await ctx.answerCallbackQuery()
    const user = store.users.find(ctx.from.id)
    if (!user?.xray_username) {return}
    try {
      const tcpLink = store.users.getLink(user.xray_username)
      let grpcLink = ''
      try { grpcLink = store.users.getGrpcLink(user.xray_username) } catch { /* gRPC inbound optional */ }
      const linkText = grpcLink
        ? `TCP:\n<code>${escapeHtml(tcpLink)}</code>\n\ngRPC:\n<code>${escapeHtml(grpcLink)}</code>`
        : `<code>${escapeHtml(tcpLink)}</code>`
      await ctx.reply(`Ссылка для подключения:\n\n${linkText}`, HTML)
    } catch (e) {
      await ctx.reply(`Ошибка: ${escapeHtml((e as Error).message)}`, HTML)
    }
  })

  bot.callbackQuery('user:qr', async (ctx) => {
    await ctx.answerCallbackQuery()
    const user = store.users.find(ctx.from.id)
    if (!user?.xray_username) {return}
    let qrPath: string | undefined
    try {
      qrPath = store.users.getQrPath(user.xray_username)
      await ctx.replyWithPhoto(new InputFile(qrPath))
    } catch (e) {
      await ctx.reply(`Ошибка генерации QR: ${escapeHtml((e as Error).message)}`, HTML)
    } finally {
      if (qrPath) {try { fs.unlinkSync(qrPath) } catch { /* cleanup best-effort */ }}
    }
  })

  bot.callbackQuery('user:me', async (ctx) => {
    await ctx.answerCallbackQuery()
    const user = store.users.find(ctx.from.id)
    if (!user?.xray_username) {return}
    const text     = buildTrafficMessage(user.xray_username, 'all')
    const keyboard = buildPeriodKeyboard(user.xray_username, 'all')
    await ctx.reply(text, { ...HTML, reply_markup: keyboard })
  })

  bot.command('register', startRegister)
  bot.callbackQuery('register', async (ctx) => {
    await ctx.answerCallbackQuery()
    await startRegister(ctx)
  })

  async function startRegister(ctx: Context) {
    const telegramId = ctx.from!.id
    const user = store.users.find(telegramId)
    if (user?.xray_username) {
      await ctx.reply('Ты уже зарегистрирован. Используй /me для статистики.')
      
return
    }
    awaitingPromoCode.add(telegramId)
    await ctx.reply('Введи промокод:')
  }

  bot.command('me', async (ctx) => {
    const user = store.users.find(ctx.from!.id)
    if (!user?.xray_username) {
      await ctx.reply('Ты не зарегистрирован. Используй /register.')
      
return
    }
    const text     = buildTrafficMessage(user.xray_username, 'all')
    const keyboard = buildPeriodKeyboard(user.xray_username, 'all')
    await ctx.reply(text, { ...HTML, reply_markup: keyboard })
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

  bot.command('link', async (ctx) => {
    const user = store.users.find(ctx.from!.id)
    if (!user?.xray_username) {
      await ctx.reply('Ты не зарегистрирован. Используй /register.')
      
return
    }
    try {
      const tcpLink = store.users.getLink(user.xray_username)
      let grpcLink = ''
      try { grpcLink = store.users.getGrpcLink(user.xray_username) } catch { /* gRPC inbound optional */ }
      const linkText = grpcLink
        ? `TCP:\n<code>${escapeHtml(tcpLink)}</code>\n\ngRPC:\n<code>${escapeHtml(grpcLink)}</code>`
        : `<code>${escapeHtml(tcpLink)}</code>`
      await ctx.reply(`Ссылка для подключения:\n\n${linkText}`, HTML)
    } catch (e) {
      await ctx.reply(`Ошибка: ${escapeHtml((e as Error).message)}`, HTML)
    }
  })

  bot.command('qr', async (ctx) => {
    const user = store.users.find(ctx.from!.id)
    if (!user?.xray_username) {
      await ctx.reply('Ты не зарегистрирован. Используй /register.')
      
return
    }
    let qrPath: string | undefined
    try {
      qrPath = store.users.getQrPath(user.xray_username)
      await ctx.replyWithPhoto(new InputFile(qrPath))
    } catch (e) {
      await ctx.reply(`Ошибка генерации QR: ${escapeHtml((e as Error).message)}`, HTML)
    } finally {
      if (qrPath) {try { fs.unlinkSync(qrPath) } catch { /* cleanup best-effort */ }}
    }
  })

  // ─── Guide ───────────────────────────────────────────────────────────────

  const guideMenuKb = new InlineKeyboard()
    .text('🤖 Android', 'guide:android').text('🍎 iOS',    'guide:ios').row()
    .text('🖥 Windows', 'guide:windows').text('🍏 macOS',  'guide:mac')

  const guideText = {
    menu: '📖 <b>Инструкция по подключению</b>\n\nВыбери свою платформу:',

    android: `📱 <b>Android — Happ</b>

1. Скачай <a href="https://play.google.com/store/apps/details?id=com.happproxy">Happ</a> из Google Play

2. Открой бота, введи /link — скопируй ссылку <code>vless://...</code>

3. В Happ нажми <b>+</b> → вставь ссылку

4. Включи VPN`,

    ios: `📱 <b>iOS — Happ</b>

1. Установи через TestFlight:
   • <a href="https://testflight.apple.com/join/XMls6Ckd">Global</a>
   • <a href="https://testflight.apple.com/join/ystvnbsP">Россия</a>

2. Открой бота, введи /qr — получи QR-код

3. В Happ нажми <b>+</b> → <b>Scan QR Code</b>
   или нажми <b>+</b> → вставь ссылку из /link

4. Включи VPN`,

    windows: `🖥 <b>Windows — Happ</b>

1. <a href="https://github.com/Happ-proxy/happ-desktop/releases/latest/download/setup-Happ.x64.exe">Скачай Happ</a> и установи

2. Открой бота, введи /link — скопируй ссылку <code>vless://...</code>

3. В Happ нажми <b>+</b> → вставь ссылку

4. Включи VPN`,

    mac: `🖥 <b>macOS — Happ</b>

1. <a href="https://github.com/Happ-proxy/happ-desktop/releases/latest/download/Happ.macOS.universal.dmg">Скачай Happ DMG</a> и перенеси в Applications

2. Открой бота, введи /link — скопируй ссылку <code>vless://...</code>

3. В Happ нажми <b>+</b> → вставь ссылку

4. Включи VPN`,
  }

  bot.command('guide', async (ctx) => {
    await ctx.reply(guideText.menu, {
      ...HTML, reply_markup: guideMenuKb, link_preview_options: { is_disabled: true },
    })
  })

  bot.callbackQuery('guide:menu', async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.reply(guideText.menu, {
      ...HTML, reply_markup: guideMenuKb, link_preview_options: { is_disabled: true },
    })
  })

  for (const platform of ['android', 'ios', 'windows', 'mac'] as const) {
    bot.callbackQuery(`guide:${platform}`, async (ctx) => {
      await ctx.answerCallbackQuery()
      await ctx.editMessageText(guideText[platform], {
        ...HTML,
        reply_markup: new InlineKeyboard().text('◀️ Назад', 'guide:back'),
        link_preview_options: { is_disabled: true },
      })
    })
  }

  bot.callbackQuery('guide:back', async (ctx) => {
    await ctx.answerCallbackQuery()
    await ctx.editMessageText(guideText.menu, {
      ...HTML, reply_markup: guideMenuKb, link_preview_options: { is_disabled: true },
    })
  })

  // ─── Text input ───────────────────────────────────────────────────────────

  bot.on('message:text', async (ctx, next) => {
    const telegramId = ctx.from.id
    const text       = ctx.message.text.trim()

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
          ? `Основной способ (TCP):\n<code>${escapeHtml(tcpLink)}</code>\n\nРезервный способ (gRPC):\n<code>${escapeHtml(grpcLink)}</code>`
          : `<code>${escapeHtml(tcpLink)}</code>`
        await ctx.reply(
          `✅ Аккаунт создан!\n\nИмя: <code>${escapeHtml(xrayName)}</code>\n\nСсылка для подключения:\n${linkText}\n\nИспользуй /qr для QR-кода или /me для статистики.`,
          HTML
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
    `✅ Аккаунт привязан!\n\nVPN имя: <code>${escapeHtml(xrayName)}</code>\n\nКоманды: /me — трафик, /link — ссылка, /qr — QR-код.`,
    HTML
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
    kb.text(label, `my_traffic:${username}:${p}`)
  }
  
return kb
}

async function notifyAdmins(bot: Bot<Context>, message: string): Promise<void> {
  const admins   = store.users.listAdmins()
  const config   = loadConfig()
  const adminIds = new Set([...admins.map(a => a.telegram_id), ...config.adminIds])
  await Promise.allSettled([...adminIds].map(id => bot.api.sendMessage(id, message, HTML)))
}

export { notifyAdmins }
