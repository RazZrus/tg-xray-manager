import type Database from 'better-sqlite3'
import { getDb } from './connection.js'

export interface PromoCode {
  code: string;
  created_by: number;
  used_by: number | null;
  created_at: number;
  used_at: number | null;
}

let s: {
  create: Database.Statement;
  find: Database.Statement;
  markUsed: Database.Statement;
  redeem: Database.Statement;
  delete: Database.Statement;
  list: Database.Statement;
} | undefined

function stmts() {
  if (!s) {
    const db = getDb()
    s = {
      create:   db.prepare('INSERT INTO promo_codes (code, created_by, created_at) VALUES (?, ?, ?)'),
      find:     db.prepare('SELECT * FROM promo_codes WHERE code = ?'),
      markUsed: db.prepare('UPDATE promo_codes SET used_by = ?, used_at = ? WHERE code = ?'),
      redeem:   db.prepare('UPDATE promo_codes SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL'),
      delete:   db.prepare('DELETE FROM promo_codes WHERE code = ?'),
      list:     db.prepare('SELECT * FROM promo_codes ORDER BY created_at DESC'),
    }
  }
  
return s
}

export function createPromoCode(code: string, createdBy: number): void {
  stmts().create.run(code, createdBy, Date.now())
}

export function findPromoCode(code: string): PromoCode | undefined {
  return stmts().find.get(code) as PromoCode | undefined
}

export function markPromoCodeUsed(code: string, usedBy: number): void {
  stmts().markUsed.run(usedBy, Date.now(), code)
}

/** Atomically redeem a promo code. Returns true on success. */
export function redeemPromoCode(code: string, usedBy: number): boolean {
  return stmts().redeem.run(usedBy, Date.now(), code).changes > 0
}

export function deletePromoCode(code: string): void {
  stmts().delete.run(code)
}

export function listPromoCodes(): PromoCode[] {
  return stmts().list.all() as PromoCode[]
}
