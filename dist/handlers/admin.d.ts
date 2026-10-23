import { Bot, Context } from 'grammy';
export declare function isAdmin(telegramId: number): boolean;
export declare function adminMiddleware(ctx: Context, next: () => Promise<void>): Promise<void>;
export declare function registerAdminHandlers(bot: Bot<Context>): void;
//# sourceMappingURL=admin.d.ts.map