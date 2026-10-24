import type Database from 'better-sqlite3'
import { getDb } from './connection.js'

export interface UserSettings {
  telegram_id:    number
  lang:           'ru' | 'en'
  mini_ui:        number
  midnight_stats: number
  display_name:   string | null
}

type SettingKey = keyof Omit<UserSettings, 'telegram_id'>

const DEFAULTS: Omit<UserSettings, 'telegram_id'> = {
  lang:           'ru',
  mini_ui:        0,
  midnight_stats: 0,
  display_name:   null,
}

const ALLOWED_KEYS: SettingKey[] = ['lang', 'mini_ui', 'midnight_stats', 'display_name']

let s: {
  get:    Database.Statement
  upsert: Database.Statement
} | undefined

const setters = new Map<string, Database.Statement>()

function stmts() {
  if (!s) {
    const db = getDb()
    s = {
      get: db.prepare('SELECT * FROM user_settings WHERE telegram_id = ?'),
      upsert: db.prepare(`
        INSERT INTO user_settings (telegram_id, lang, mini_ui, midnight_stats, display_name)
        VALUES (@telegram_id, @lang, @mini_ui, @midnight_stats, @display_name)
        ON CONFLICT(telegram_id) DO NOTHING
      `),
    }
  }

  return s
}

function setter(key: SettingKey): Database.Statement {
  if (!setters.has(key)) {
    setters.set(key, getDb().prepare(`UPDATE user_settings SET ${key} = ? WHERE telegram_id = ?`))
  }

  return setters.get(key)!
}

function ensureRow(telegramId: number): void {
  stmts().upsert.run({ telegram_id: telegramId, ...DEFAULTS })
}

export function getSettings(telegramId: number): UserSettings {
  ensureRow(telegramId)

  return stmts().get.get(telegramId) as UserSettings
}

export function setSetting(
  telegramId: number,
  key: SettingKey,
  value: string | number | null,
): void {
  if (!ALLOWED_KEYS.includes(key)) { throw new Error(`Unknown settings key: ${key}`) }
  ensureRow(telegramId)
  setter(key).run(value, telegramId)
}
