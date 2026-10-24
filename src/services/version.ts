import { Bot, Context } from 'grammy';
import { loadConfig } from '../config.js';
import { listAdmins } from '../db/index.js';

const CURRENT_VERSION: string = (require('../../package.json') as { version: string }).version;
const REPO = 'RazZrus/tg-xray-manager';

function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

export async function checkForUpdates(bot: Bot<Context>): Promise<void> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'tg-xray-manager' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return;

    const data = await res.json() as { tag_name: string };
    const latest = data.tag_name.replace(/^v/, '');

    if (!isNewer(latest, CURRENT_VERSION)) return;

    const config = loadConfig();
    const admins = listAdmins();
    const adminIds = new Set([...config.adminIds, ...admins.map(a => a.telegram_id)]);

    const msg =
      `🔔 <b>Доступна новая версия ${latest}!</b>\n\n` +
      `Текущая: <code>${CURRENT_VERSION}</code>\n\n` +
      `Обновить:\n<code>bash /opt/tg-xray-manager/scripts/update.sh</code>`;

    await Promise.allSettled(
      [...adminIds].map(id => bot.api.sendMessage(id, msg, { parse_mode: 'HTML' }))
    );
  } catch {
    // Non-critical — silently skip if GitHub is unreachable
  }
}
