"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configExists = configExists;
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const CONFIG_DIR = path_1.default.join(os_1.default.homedir(), '.tg-xray-bot');
const CONFIG_PATH = path_1.default.join(CONFIG_DIR, 'config.json');
let cachedConfig = null;
function configExists() {
    return fs_1.default.existsSync(CONFIG_PATH);
}
function loadConfig() {
    if (cachedConfig)
        return cachedConfig;
    if (!configExists()) {
        throw new Error(`Конфиг не найден: ${CONFIG_PATH}. Запустите tg-xray-bot без аргументов для настройки.`);
    }
    const raw = fs_1.default.readFileSync(CONFIG_PATH, 'utf-8');
    cachedConfig = JSON.parse(raw);
    return cachedConfig;
}
function saveConfig(config) {
    fs_1.default.mkdirSync(CONFIG_DIR, { recursive: true });
    fs_1.default.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
    cachedConfig = config;
}
//# sourceMappingURL=config.js.map