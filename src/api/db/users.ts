import type Database from 'better-sqlite3'
import { getDb } from './connection.js'

export interface User {
  telegram_id: number;
  telegram_username: string | null;
  first_name: string | null;
  last_name: string | null;
  xray_username: string | null;
  registered_at: number;
  is_admin: number;
}

export type UserUpsert = Omit<User, 'registered_at' | 'is_admin'> & { is_admin?: number };

let s: {
  findUser: Database.Statement;
  findUserByXrayName: Database.Statement;
  listUsers: Database.Statement;
  listAdmins: Database.Statement;
  upsertUser: Database.Statement;
  setAdmin: Database.Statement;
  deleteUser: Database.Statement;
} | undefined

function stmts() {
  if (!s) {
    const db = getDb()
    s = {
      findUser:          db.prepare('SELECT * FROM users WHERE telegram_id = ?'),
      findUserByXrayName: db.prepare('SELECT * FROM users WHERE xray_username = ?'),
      listUsers:         db.prepare('SELECT * FROM users ORDER BY registered_at ASC'),
      listAdmins:        db.prepare('SELECT * FROM users WHERE is_admin = 1'),
      upsertUser:        db.prepare(`
        INSERT INTO users (telegram_id, telegram_username, first_name, last_name, xray_username, registered_at, is_admin)
        VALUES (@telegram_id, @telegram_username, @first_name, @last_name, @xray_username, @registered_at, @is_admin)
        ON CONFLICT(telegram_id) DO UPDATE SET
          telegram_username = excluded.telegram_username,
          first_name        = excluded.first_name,
          last_name         = excluded.last_name,
          xray_username     = COALESCE(excluded.xray_username, xray_username),
          is_admin          = excluded.is_admin
      `),
      setAdmin:    db.prepare('UPDATE users SET is_admin = ? WHERE telegram_id = ?'),
      deleteUser:  db.prepare('DELETE FROM users WHERE telegram_id = ?'),
    }
  }
  
return s
}

export function findUser(telegramId: number): User | undefined {
  return stmts().findUser.get(telegramId) as User | undefined
}

export function findUserByXrayName(xrayUsername: string): User | undefined {
  return stmts().findUserByXrayName.get(xrayUsername) as User | undefined
}

export function listUsers(): User[] {
  return stmts().listUsers.all() as User[]
}

export function listAdmins(): User[] {
  return stmts().listAdmins.all() as User[]
}

export function upsertUser(user: UserUpsert): void {
  stmts().upsertUser.run({ ...user, registered_at: Date.now(), is_admin: user.is_admin ?? 0 })
}

export function setAdmin(telegramId: number, isAdmin: boolean): void {
  stmts().setAdmin.run(isAdmin ? 1 : 0, telegramId)
}

export function deleteUser(telegramId: number): void {
  stmts().deleteUser.run(telegramId)
}
