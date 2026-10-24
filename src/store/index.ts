import { UserService }    from '../services/UserService.js'
import { TrafficService } from '../services/TrafficService.js'
import { PromoService }   from '../services/PromoService.js'
import { VersionService } from '../services/VersionService.js'
import * as system        from '../api/system/index.js'
import * as settingsDb    from '../api/db/settings.js'
import { closeDb }        from '../api/db/connection.js'

export class BotStore {
  private static _instance: BotStore

  readonly users:    UserService
  readonly traffic:  TrafficService
  readonly promo:    PromoService
  readonly version:  VersionService
  readonly system:   typeof system
  readonly settings: typeof settingsDb

  private constructor() {
    this.users    = new UserService()
    this.traffic  = new TrafficService()
    this.promo    = new PromoService()
    this.version  = new VersionService()
    this.system   = system
    this.settings = settingsDb
  }

  static get instance(): BotStore {
    if (!this._instance) {this._instance = new BotStore()}
    
return this._instance
  }

  shutdown(): void {
    this.traffic.stop()
    closeDb()
  }
}

export const store = BotStore.instance
