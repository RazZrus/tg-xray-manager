import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

const DB_DIR = path.join(os.homedir(), '.tg-xray-bot');
const DB_PATH = path.join(DB_DIR, 'db.sqlite');

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
    initStatements(db);
  }
  return db;
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
  `);
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
};

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
  };
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
  getDb();
  return stmts.findUser.get(telegramId) as User | undefined;
}

export function findUserByXrayName(xrayUsername: string): User | undefined {
  getDb();
  return stmts.findUserByXrayName.get(xrayUsername) as User | undefined;
}

export function listUsers(): User[] {
  getDb();
  return stmts.listUsers.all() as User[];
}

export function listAdmins(): User[] {
  getDb();
  return stmts.listAdmins.all() as User[];
}

export function upsertUser(user: Omit<User, 'registered_at' | 'is_admin'> & { is_admin?: number }): void {
  getDb();
  stmts.upsertUser.run({
    ...user,
    registered_at: Date.now(),
    is_admin: user.is_admin ?? 0,
  });
}

export function setAdmin(telegramId: number, isAdmin: boolean): void {
  getDb();
  stmts.setAdmin.run(isAdmin ? 1 : 0, telegramId);
}

export function deleteUser(telegramId: number): void {
  getDb();
  stmts.deleteUser.run(telegramId);
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
  getDb();
  stmts.createPromoCode.run(code, createdBy, Date.now());
}

export function findPromoCode(code: string): PromoCode | undefined {
  getDb();
  return stmts.findPromoCode.get(code) as PromoCode | undefined;
}

export function markPromoCodeUsed(code: string, usedBy: number): void {
  getDb();
  stmts.markPromoCodeUsed.run(usedBy, Date.now(), code);
}

/** Атомарно использовать промокод. Возвращает true если успешно. */
export function redeemPromoCode(code: string, usedBy: number): boolean {
  getDb();
  const result = stmts.redeemPromoCode.run(usedBy, Date.now(), code);
  return result.changes > 0;
}

export function deletePromoCode(code: string): void {
  getDb();
  stmts.deletePromoCode.run(code);
}

export function listPromoCodes(): PromoCode[] {
  getDb();
  return stmts.listPromoCodes.all() as PromoCode[];
}
