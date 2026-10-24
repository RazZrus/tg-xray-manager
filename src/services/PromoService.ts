import * as dbPromo from '../api/db/promo.js'

export type { PromoCode } from '../api/db/promo.js'

export class PromoService {
  create(code: string, createdBy: number): void {
    dbPromo.createPromoCode(code, createdBy)
  }

  delete(code: string): void {
    dbPromo.deletePromoCode(code)
  }

  list() {
    return dbPromo.listPromoCodes()
  }

  find(code: string) {
    return dbPromo.findPromoCode(code)
  }

  /** Atomically redeem a promo code. Returns true on success. */
  redeem(code: string, usedBy: number): boolean {
    return dbPromo.redeemPromoCode(code, usedBy)
  }
}
