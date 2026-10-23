"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
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
        initStatements(db);
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
// Cached prepared statements
let stmts;
function initStatements(db) {
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
        listPromoCodes: db.prepare('SELECT * FROM promo_codes ORDER BY created_at DESC'),
    };
}
function findUser(telegramId) {
    getDb();
    return stmts.findUser.get(telegramId);
}
function findUserByXrayName(xrayUsername) {
    getDb();
    return stmts.findUserByXrayName.get(xrayUsername);
}
function listUsers() {
    getDb();
    return stmts.listUsers.all();
}
function listAdmins() {
    getDb();
    return stmts.listAdmins.all();
}
function upsertUser(user) {
    getDb();
    stmts.upsertUser.run({
        ...user,
        registered_at: Date.now(),
        is_admin: user.is_admin ?? 0,
    });
}
function setAdmin(telegramId, isAdmin) {
    getDb();
    stmts.setAdmin.run(isAdmin ? 1 : 0, telegramId);
}
function deleteUser(telegramId) {
    getDb();
    stmts.deleteUser.run(telegramId);
}
function createPromoCode(code, createdBy) {
    getDb();
    stmts.createPromoCode.run(code, createdBy, Date.now());
}
function findPromoCode(code) {
    getDb();
    return stmts.findPromoCode.get(code);
}
function markPromoCodeUsed(code, usedBy) {
    getDb();
    stmts.markPromoCodeUsed.run(usedBy, Date.now(), code);
}
function listPromoCodes() {
    getDb();
    return stmts.listPromoCodes.all();
}
//# sourceMappingURL=index.js.map