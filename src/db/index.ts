import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'

const DB_DIR = path.join(os.homedir(), '.tg-xray-bot')
const DB_PATH = path.join(DB_DIR, 'db.sqlite')

let db: Database.Database

function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(DB_DIR, { recursive: true })
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    migrate(db)
    initStatements(db)
  }
  
return db
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
  `)
}

// Cached prepared statements
let stmts: {
  findUser: Database.Statement;
  findUserByXrayName: Database.Statement;
  listUsers: Database.Statement;
  listAdmins: Database.Statement;
  upsertUser: Database.Statement;
  setAdmin: Database.Statement;
  deleteUser: Database.Statement;
  createPromoCode: Database.Statement;
  findPromoCode: Database.Statement;
  markPromoCodeUsed: Database.Statement;
  redeemPromoCode: Database.Statement;
  deletePromoCode: Database.Statement;
  listPromoCodes: Database.Statement;
  upsertTrafficHourly: Database.Statement;
  queryTrafficSince: Database.Statement;
  queryTrafficAll: Database.Statement;
  queryAllUsersTrafficSince: Database.Statement;
  queryAllUsersTrafficAll: Database.Statement;
  queryAllUsersTrafficRange: Database.Statement;
  queryTrafficRange: Database.Statement;
  deleteUserTraffic: Database.Statement;
}

function initStatements(db: Database.Database): void {
  stmts = {
    findUser: db.prepare('SELECT * FROM users WHERE telegram_id = ?'),
    findUserByXrayName: db.prepare('SELECT * FROM users WHERE xray_username = ?'),
    listUsers: db.prepare('SELECT * FROM users ORDER BY registered_at ASC'),
    listAdmins: db.prepare('SELECT * FROM users WHERE is_admin = 1'),
    upsertUser: db.prepare(`
      INSERT INTO users (telegram_id, telegram_username, first_name, last_name, xray_username, registered_at, is_admin)
      VALUES (@telegram_id, @telegram_username, @first_name, @last_name, @xray_username, @registered_at, @is_admin)
      ON CONFLICT(telegram_id) DO UPDATE SET
        telegram_username = excluded.telegram_username,
        first_name        = excluded.first_name,
        last_name         = excluded.last_name,
        xray_username     = COALESCE(excluded.xray_username, xray_username),
        is_admin          = excluded.is_admin
    `),
    setAdmin: db.prepare('UPDATE users SET is_admin = ? WHERE telegram_id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE telegram_id = ?'),
    createPromoCode: db.prepare('INSERT INTO promo_codes (code, created_by, created_at) VALUES (?, ?, ?)'),
    findPromoCode: db.prepare('SELECT * FROM promo_codes WHERE code = ?'),
    markPromoCodeUsed: db.prepare('UPDATE promo_codes SET used_by = ?, used_at = ? WHERE code = ?'),
    redeemPromoCode: db.prepare('UPDATE promo_codes SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL'),
    deletePromoCode: db.prepare('DELETE FROM promo_codes WHERE code = ?'),
    listPromoCodes: db.prepare('SELECT * FROM promo_codes ORDER BY created_at DESC'),
    upsertTrafficHourly: db.prepare(`
      INSERT INTO traffic_hourly (xray_username, hour_ts, upload, download)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(xray_username, hour_ts) DO UPDATE SET
        upload   = upload   + excluded.upload,
        download = download + excluded.download
    `),
    queryTrafficSince: db.prepare(
      'SELECT COALESCE(SUM(upload),0) as upload, COALESCE(SUM(download),0) as download FROM traffic_hourly WHERE xray_username = ? AND hour_ts >= ?'
    ),
    queryTrafficAll: db.prepare(
      'SELECT COALESCE(SUM(upload),0) as upload, COALESCE(SUM(download),0) as download FROM traffic_hourly WHERE xray_username = ?'
    ),
    queryAllUsersTrafficSince: db.prepare(
      'SELECT xray_username, COALESCE(SUM(upload),0) as upload, COALESCE(SUM(download),0) as download FROM traffic_hourly WHERE hour_ts >= ? GROUP BY xray_username'
    ),
    queryAllUsersTrafficAll: db.prepare(
      'SELECT xray_username, COALESCE(SUM(upload),0) as upload, COALESCE(SUM(download),0) as download FROM traffic_hourly GROUP BY xray_username'
    ),
    queryAllUsersTrafficRange: db.prepare(
      'SELECT xray_username, COALESCE(SUM(upload),0) as upload, COALESCE(SUM(download),0) as download FROM traffic_hourly WHERE hour_ts >= ? AND hour_ts < ? GROUP BY xray_username'
    ),
    queryTrafficRange: db.prepare(
      'SELECT COALESCE(SUM(upload),0) as upload, COALESCE(SUM(download),0) as download FROM traffic_hourly WHERE xray_username = ? AND hour_ts >= ? AND hour_ts < ?'
    ),
    deleteUserTraffic: db.prepare('DELETE FROM traffic_hourly WHERE xray_username = ?'),
  }
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface User {
  telegram_id: number;
  telegram_username: string | null;
  first_name: string | null;
  last_name: string | null;
  xray_username: string | null;
  registered_at: number;
  is_admin: number;
}

export function findUser(telegramId: number): User | undefined {
  getDb()
  
return stmts.findUser.get(telegramId) as User | undefined
}

export function findUserByXrayName(xrayUsername: string): User | undefined {
  getDb()
  
return stmts.findUserByXrayName.get(xrayUsername) as User | undefined
}

export function listUsers(): User[] {
  getDb()
  
return stmts.listUsers.all() as User[]
}

export function listAdmins(): User[] {
  getDb()
  
return stmts.listAdmins.all() as User[]
}

export function upsertUser(user: Omit<User, 'registered_at' | 'is_admin'> & { is_admin?: number }): void {
  getDb()
  stmts.upsertUser.run({
    ...user,
    registered_at: Date.now(),
    is_admin: user.is_admin ?? 0,
  })
}

export function setAdmin(telegramId: number, isAdmin: boolean): void {
  getDb()
  stmts.setAdmin.run(isAdmin ? 1 : 0, telegramId)
}

export function deleteUser(telegramId: number): void {
  getDb()
  stmts.deleteUser.run(telegramId)
}

// ─── Promo codes ──────────────────────────────────────────────────────────────

export interface PromoCode {
  code: string;
  created_by: number;
  used_by: number | null;
  created_at: number;
  used_at: number | null;
}

export function createPromoCode(code: string, createdBy: number): void {
  getDb()
  stmts.createPromoCode.run(code, createdBy, Date.now())
}

export function findPromoCode(code: string): PromoCode | undefined {
  getDb()
  
return stmts.findPromoCode.get(code) as PromoCode | undefined
}

export function markPromoCodeUsed(code: string, usedBy: number): void {
  getDb()
  stmts.markPromoCodeUsed.run(usedBy, Date.now(), code)
}

/** Atomically redeem a promo code. Returns true on success. */
export function redeemPromoCode(code: string, usedBy: number): boolean {
  getDb()
  const result = stmts.redeemPromoCode.run(usedBy, Date.now(), code)
  
return result.changes > 0
}

export function deletePromoCode(code: string): void {
  getDb()
  stmts.deletePromoCode.run(code)
}

export function listPromoCodes(): PromoCode[] {
  getDb()
  
return stmts.listPromoCodes.all() as PromoCode[]
}

// ─── Traffic log ─────────────────────────────────────────────────────────────

export interface TrafficRecord {
  upload: number;
  download: number;
}

export interface UserTrafficRecord extends TrafficRecord {
  xray_username: string;
}

function currentHourTs(): number {
  const now = Date.now()
  
return now - (now % (60 * 60 * 1000))
}

export function insertTrafficBatch(entries: { xrayUsername: string; upload: number; download: number }[]): void {
  const db = getDb()
  const hourTs = currentHourTs()
  const tx = db.transaction(() => {
    for (const e of entries) {
      stmts.upsertTrafficHourly.run(e.xrayUsername, hourTs, e.upload, e.download)
    }
  })
  tx()
}

export function queryTraffic(xrayUsername: string, sinceMs?: number): TrafficRecord {
  getDb()
  if (sinceMs !== undefined) {
    return stmts.queryTrafficSince.get(xrayUsername, sinceMs) as TrafficRecord
  }
  
return stmts.queryTrafficAll.get(xrayUsername) as TrafficRecord
}

export function queryAllUsersTraffic(sinceMs?: number): UserTrafficRecord[] {
  getDb()
  if (sinceMs !== undefined) {
    return stmts.queryAllUsersTrafficSince.all(sinceMs) as UserTrafficRecord[]
  }
  
return stmts.queryAllUsersTrafficAll.all() as UserTrafficRecord[]
}

export function queryAllUsersTrafficRange(fromMs: number, toMs: number): UserTrafficRecord[] {
  getDb()
  
return stmts.queryAllUsersTrafficRange.all(fromMs, toMs) as UserTrafficRecord[]
}

export function queryTrafficRange(xrayUsername: string, fromMs: number, toMs: number): TrafficRecord {
  getDb()
  
return stmts.queryTrafficRange.get(xrayUsername, fromMs, toMs) as TrafficRecord
}

export function deleteUserTraffic(xrayUsername: string): void {
  getDb()
  stmts.deleteUserTraffic.run(xrayUsername)
}

export function closeDb(): void {
  if (db) {
    db.close();
    (db as unknown) = undefined
  }
}
