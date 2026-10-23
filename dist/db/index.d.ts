import Database from 'better-sqlite3';
export declare function getDb(): Database.Database;
export interface User {
    telegram_id: number;
    telegram_username: string | null;
    first_name: string | null;
    last_name: string | null;
    xray_username: string | null;
    registered_at: number;
    is_admin: number;
}
export declare function findUser(telegramId: number): User | undefined;
export declare function findUserByXrayName(xrayUsername: string): User | undefined;
export declare function listUsers(): User[];
export declare function listAdmins(): User[];
export declare function upsertUser(user: Omit<User, 'registered_at' | 'is_admin'> & {
    is_admin?: number;
}): void;
export declare function setAdmin(telegramId: number, isAdmin: boolean): void;
export declare function deleteUser(telegramId: number): void;
export interface PromoCode {
    code: string;
    created_by: number;
    used_by: number | null;
    created_at: number;
    used_at: number | null;
}
export declare function createPromoCode(code: string, createdBy: number): void;
export declare function findPromoCode(code: string): PromoCode | undefined;
export declare function markPromoCodeUsed(code: string, usedBy: number): void;
export declare function listPromoCodes(): PromoCode[];
//# sourceMappingURL=index.d.ts.map