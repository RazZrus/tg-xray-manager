import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'

const DB_DIR  = path.join(os.homedir(), '.tg-xray-bot')
const DB_PATH = path.join(DB_DIR, 'db.sqlite')

let _db: Database.Database | undefined

export function getDb(): Database.Database {
  if (!_db) {
    fs.mkdirSync(DB_DIR, { recursive: true })
    _db = new Database(DB_PATH)
    _db.pragma('journal_mode = WAL')
    _db.pragma('foreign_keys = ON')
    migrate(_db)
  }
  
return _db
}

export function closeDb(): void {
  if (_db) {
    _db.close()
    _db = undefined
  }
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id       INTEGER PRIMARY KEY,
      telegram_username TEXT,
      first_name        TEXT,
      last_name         TEXT,
      xray_username     TEXT UNIQUE,
      registered_at     INTEGER NOT NULL,
      is_admin          INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS promo_codes (
      code        TEXT PRIMARY KEY,
      created_by  INTEGER NOT NULL,
      used_by     INTEGER,
      created_at  INTEGER NOT NULL,
      used_at     INTEGER
    );

    CREATE TABLE IF NOT EXISTS traffic_hourly (
      xray_username TEXT    NOT NULL,
      hour_ts       INTEGER NOT NULL,
      upload        INTEGER NOT NULL DEFAULT 0,
      download      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (xray_username, hour_ts)
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      telegram_id    INTEGER PRIMARY KEY,
      lang           TEXT    NOT NULL DEFAULT 'ru',
      mini_ui        INTEGER NOT NULL DEFAULT 0,
      midnight_stats INTEGER NOT NULL DEFAULT 0,
      display_name   TEXT
    );
  `)
}
