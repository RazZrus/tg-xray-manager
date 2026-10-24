import type Database from 'better-sqlite3'
import { getDb } from './connection.js'

export interface TrafficRecord {
  upload: number;
  download: number;
}

export interface UserTrafficRecord extends TrafficRecord {
  xray_username: string;
}

let s: {
  upsertHourly: Database.Statement;
  querySince: Database.Statement;
  queryAll: Database.Statement;
  queryAllUsersSince: Database.Statement;
  queryAllUsersAll: Database.Statement;
  queryAllUsersRange: Database.Statement;
  queryRange: Database.Statement;
  deleteUser: Database.Statement;
} | undefined

function stmts() {
  if (!s) {
    const db = getDb()
    s = {
      upsertHourly: db.prepare(`
        INSERT INTO traffic_hourly (xray_username, hour_ts, upload, download)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(xray_username, hour_ts) DO UPDATE SET
          upload   = upload   + excluded.upload,
          download = download + excluded.download
      `),
      querySince:          db.prepare('SELECT COALESCE(SUM(upload),0) as upload, COALESCE(SUM(download),0) as download FROM traffic_hourly WHERE xray_username = ? AND hour_ts >= ?'),
      queryAll:            db.prepare('SELECT COALESCE(SUM(upload),0) as upload, COALESCE(SUM(download),0) as download FROM traffic_hourly WHERE xray_username = ?'),
      queryAllUsersSince:  db.prepare('SELECT xray_username, COALESCE(SUM(upload),0) as upload, COALESCE(SUM(download),0) as download FROM traffic_hourly WHERE hour_ts >= ? GROUP BY xray_username'),
      queryAllUsersAll:    db.prepare('SELECT xray_username, COALESCE(SUM(upload),0) as upload, COALESCE(SUM(download),0) as download FROM traffic_hourly GROUP BY xray_username'),
      queryAllUsersRange:  db.prepare('SELECT xray_username, COALESCE(SUM(upload),0) as upload, COALESCE(SUM(download),0) as download FROM traffic_hourly WHERE hour_ts >= ? AND hour_ts < ? GROUP BY xray_username'),
      queryRange:          db.prepare('SELECT COALESCE(SUM(upload),0) as upload, COALESCE(SUM(download),0) as download FROM traffic_hourly WHERE xray_username = ? AND hour_ts >= ? AND hour_ts < ?'),
      deleteUser:          db.prepare('DELETE FROM traffic_hourly WHERE xray_username = ?'),
    }
  }
  
return s
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
      stmts().upsertHourly.run(e.xrayUsername, hourTs, e.upload, e.download)
    }
  })
  tx()
}

export function queryTraffic(xrayUsername: string, sinceMs?: number): TrafficRecord {
  return (sinceMs !== undefined
    ? stmts().querySince.get(xrayUsername, sinceMs)
    : stmts().queryAll.get(xrayUsername)) as TrafficRecord
}

export function queryAllUsersTraffic(sinceMs?: number): UserTrafficRecord[] {
  return (sinceMs !== undefined
    ? stmts().queryAllUsersSince.all(sinceMs)
    : stmts().queryAllUsersAll.all()) as UserTrafficRecord[]
}

export function queryAllUsersTrafficRange(fromMs: number, toMs: number): UserTrafficRecord[] {
  return stmts().queryAllUsersRange.all(fromMs, toMs) as UserTrafficRecord[]
}

export function queryTrafficRange(xrayUsername: string, fromMs: number, toMs: number): TrafficRecord {
  return stmts().queryRange.get(xrayUsername, fromMs, toMs) as TrafficRecord
}

export function deleteUserTraffic(xrayUsername: string): void {
  stmts().deleteUser.run(xrayUsername)
}
