import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_DIR = path.join(os.homedir(), '.tg-xray-bot');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export interface Config {
  botToken: string;
  adminIds: number[];
  serverIp: string;
  xrayPort: number;
  sni: string;
  statsPort: number;
}

export function configExists(): boolean {
  return fs.existsSync(CONFIG_PATH);
}

export function loadConfig(): Config {
  if (!configExists()) {
    throw new Error(`Конфиг не найден: ${CONFIG_PATH}. Запустите tg-xray-bot без аргументов для настройки.`);
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw) as Config;
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}
