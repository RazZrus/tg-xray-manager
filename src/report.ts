/**
 * Standalone daily traffic report — invoked by systemd timer, not by the bot process.
 * Reads config + DB, sends message to all admins via Telegram Bot API, exits.
 */
import { queryAllUsersTrafficRange } from './api/db/traffic.js'
import { listAdmins } from './api/db/users.js'
import { loadConfig } from './config.js'
import { TrafficService } from './services/TrafficService.js'
import { escapeHtml } from './utils.js'

const traffic = new TrafficService()

function yesterdayRange(): { from: number; to: number } {
  const todayMidnight = new Date()
  todayMidnight.setHours(0, 0, 0, 0)
  
return {
    from: todayMidnight.getTime() - 24 * 60 * 60 * 1000,
    to:   todayMidnight.getTime(),
  }
}

async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.warn(`[report] sendMessage to ${chatId} failed: ${res.status} ${body}`)
  }
}

async function main(): Promise<void> {
  const config = loadConfig()
  const { from, to } = yesterdayRange()
  const rows = queryAllUsersTrafficRange(from, to)

  if (rows.length === 0) {
    console.log('[report] No traffic data for yesterday, skipping.')
    process.exit(0)
  }

  rows.sort((a, b) => (b.upload + b.download) - (a.upload + a.download))

  const dateStr = new Date(from).toLocaleDateString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })

  let totalUp = 0, totalDown = 0, lines = ''
  for (const r of rows) {
    totalUp   += r.upload
    totalDown += r.download
    lines += `• <code>${escapeHtml(r.xray_username)}</code> — ⬆️ ${traffic.formatBytes(r.upload)} / ⬇️ ${traffic.formatBytes(r.download)} <b>(${traffic.formatBytes(r.upload + r.download)})</b>\n`
  }

  const msg =
    `📊 <b>Отчёт за ${dateStr}</b>\n\n` +
    lines +
    `${'─'.repeat(24)}\n` +
    `Итого: ⬆️ ${traffic.formatBytes(totalUp)} / ⬇️ ${traffic.formatBytes(totalDown)} — <b>${traffic.formatBytes(totalUp + totalDown)}</b>`

  const admins   = listAdmins()
  const adminIds = new Set([...config.adminIds, ...admins.map(a => a.telegram_id)])

  await Promise.allSettled(
    [...adminIds].map(id => sendMessage(config.botToken, id, msg))
  )

  console.log(`[report] Sent to ${adminIds.size} admin(s)`)
  process.exit(0)
}

main().catch((err) => {
  console.error('[report] Fatal:', err)
  process.exit(1)
})
