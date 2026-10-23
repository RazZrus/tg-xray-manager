"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDb = getDb;
exports.findUser = findUser;
exports.findUserByXrayName = findUserByXrayName;
exports.listUsers = listUsers;
exports.listAdmins = listAdmins;
exports.upsertUser = upsertUser;
exports.setAdmin = setAdmin;
exports.deleteUser = deleteUser;
exports.createPromoCode = createPromoCode;
exports.findPromoCode = findPromoCode;
exports.markPromoCodeUsed = markPromoCodeUsed;
exports.listPromoCodes = listPromoCodes;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const fs_1 = __importDefault(require("fs"));
const DB_DIR = path_1.default.join(os_1.default.homedir(), '.tg-xray-bot');
const DB_PATH = path_1.default.join(DB_DIR, 'db.sqlite');
let db;
function getDb() {
    if (!db) {
        fs_1.default.mkdirSync(DB_DIR, { recursive: true });
        db = new better_sqlite3_1.default(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        migrate(db);
    }
    return db;
}
function migrate(db) {
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
function findUser(telegramId) {
    return getDb()
        .prepare('SELECT * FROM users WHERE telegram_id = ?')
        .get(telegramId);
}
function findUserByXrayName(xrayUsername) {
    return getDb()
        .prepare('SELECT * FROM users WHERE xray_username = ?')
        .get(xrayUsername);
}
function listUsers() {
    return getDb()
        .prepare('SELECT * FROM users ORDER BY registered_at ASC')
        .all();
}
function listAdmins() {
    return getDb()
        .prepare('SELECT * FROM users WHERE is_admin = 1')
        .all();
}
function upsertUser(user) {
    getDb()
        .prepare(`
      INSERT INTO users (telegram_id, telegram_username, first_name, last_name, xray_username, registered_at, is_admin)
      VALUES (@telegram_id, @telegram_username, @first_name, @last_name, @xray_username, @registered_at, @is_admin)
      ON CONFLICT(telegram_id) DO UPDATE SET
        telegram_username = excluded.telegram_username,
        first_name        = excluded.first_name,
        last_name         = excluded.last_name,
        xray_username     = COALESCE(excluded.xray_username, xray_username),
        is_admin          = excluded.is_admin
    `)
        .run({
        ...user,
        registered_at: Date.now(),
        is_admin: user.is_admin ?? 0,
    });
}
function setAdmin(telegramId, isAdmin) {
    getDb()
        .prepare('UPDATE users SET is_admin = ? WHERE telegram_id = ?')
        .run(isAdmin ? 1 : 0, telegramId);
}
function deleteUser(telegramId) {
    getDb()
        .prepare('DELETE FROM users WHERE telegram_id = ?')
        .run(telegramId);
}
function createPromoCode(code, createdBy) {
    getDb()
        .prepare('INSERT INTO promo_codes (code, created_by, created_at) VALUES (?, ?, ?)')
        .run(code, createdBy, Date.now());
}
function findPromoCode(code) {
    return getDb()
        .prepare('SELECT * FROM promo_codes WHERE code = ?')
        .get(code);
}
function markPromoCodeUsed(code, usedBy) {
    getDb()
        .prepare('UPDATE promo_codes SET used_by = ?, used_at = ? WHERE code = ?')
        .run(usedBy, Date.now(), code);
}
function listPromoCodes() {
    return getDb()
        .prepare('SELECT * FROM promo_codes ORDER BY created_at DESC')
        .all();
}
//# sourceMappingURL=index.js.map