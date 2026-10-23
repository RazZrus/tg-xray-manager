"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWizard = runWizard;
const prompts_1 = __importDefault(require("prompts"));
const config_js_1 = require("./config.js");
const child_process_1 = require("child_process");
async function runWizard() {
    console.log('\n=== tg-xray-bot — первоначальная настройка ===\n');
    const answers = await (0, prompts_1.default)([
        {
            type: 'text',
            name: 'botToken',
            message: 'Telegram Bot Token (получить у @BotFather):',
            validate: (v) => v.trim().length > 10 || 'Введите корректный токен',
        },
        {
            type: 'text',
            name: 'adminId',
            message: 'Ваш Telegram ID (узнать у @userinfobot):',
            validate: (v) => /^\d+$/.test(v.trim()) || 'Только цифры',
        },
        {
            type: 'text',
            name: 'serverIp',
            message: 'Внешний IP сервера (оставьте пустым для автоопределения):',
            initial: detectServerIp(),
        },
        {
            type: 'number',
            name: 'xrayPort',
            message: 'Порт xray:',
            initial: 443,
        },
        {
            type: 'text',
            name: 'sni',
            message: 'SNI (домен для маскировки):',
            initial: 'www.microsoft.com',
        },
        {
            type: 'number',
            name: 'statsPort',
            message: 'Порт gRPC Stats API xray:',
            initial: 10085,
        },
    ], {
        onCancel: () => {
            console.log('\nНастройка отменена.');
            process.exit(0);
        },
    });
    const config = {
        botToken: answers.botToken.trim(),
        adminIds: [parseInt(answers.adminId.trim(), 10)],
        serverIp: answers.serverIp.trim(),
        xrayPort: answers.xrayPort,
        sni: answers.sni.trim(),
        statsPort: answers.statsPort,
    };
    (0, config_js_1.saveConfig)(config);
    console.log('\nКонфиг сохранён.\n');
    return config;
}
function detectServerIp() {
    try {
        return (0, child_process_1.execSync)('curl -s --max-time 3 https://api.ipify.org', { timeout: 5000 }).toString().trim();
    }
    catch {
        return '';
    }
}
//# sourceMappingURL=wizard.js.map