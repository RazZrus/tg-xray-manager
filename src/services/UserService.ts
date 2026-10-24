import * as dbUsers from '../api/db/users.js'
import * as xrayUsers from '../api/xray/users.js'
import * as xrayLinks from '../api/xray/links.js'
import { deleteUserTraffic } from '../api/db/traffic.js'

export type { User, UserUpsert } from '../api/db/users.js'
export type { XrayUser } from '../api/xray/runner.js'

export class UserService {
  // ─── DB ───────────────────────────────────────────────────────────────────

  find(telegramId: number) {
    return dbUsers.findUser(telegramId)
  }

  findByXrayName(xrayName: string) {
    return dbUsers.findUserByXrayName(xrayName)
  }

  upsert(user: dbUsers.UserUpsert) {
    return dbUsers.upsertUser(user)
  }

  delete(telegramId: number) {
    return dbUsers.deleteUser(telegramId)
  }

  listAll() {
    return dbUsers.listUsers()
  }

  listAdmins() {
    return dbUsers.listAdmins()
  }

  // ─── xray CLI ─────────────────────────────────────────────────────────────

  xrayList() {
    return xrayUsers.listUsers()
  }

  /** Add xray user. Returns TCP vless:// link. */
  xrayAdd(name: string): string {
    return xrayUsers.addUser(name)
  }

  xrayDelete(name: string) {
    return xrayUsers.deleteUser(name)
  }

  xrayFindByUuid(uuid: string): string | null {
    return xrayUsers.findUserByUuid(uuid)
  }

  // ─── Links ────────────────────────────────────────────────────────────────

  getLink(name: string): string {
    return xrayLinks.getUserLink(name)
  }

  getGrpcLink(name: string): string {
    return xrayLinks.getUserGrpcLink(name)
  }

  getQrPath(name: string): string {
    return xrayLinks.getUserQrPath(name)
  }

  deleteTraffic(xrayUsername: string): void {
    deleteUserTraffic(xrayUsername)
  }
}
