import fs from 'fs'
import path from 'path'
import os from 'os'

const CONFIG_DIR = path.join(os.homedir(), '.tg-xray-bot')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

export interface Config {
  botToken: string;
  adminIds: number[];
  serverIp: string;
  xrayPort: number;
  sni: string;
  statsPort: number;
  serverName: string;
  publicKey: string;
}

let cachedConfig: Config | null = null

export function configExists(): boolean {
  return fs.existsSync(CONFIG_PATH)
}

export function loadConfig(): Config {
  if (cachedConfig) {return cachedConfig}

  if (!configExists()) {
    throw new Error(`Config not found: ${CONFIG_PATH}. Run tg-xray-bot without arguments to configure.`)
  }
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
  cachedConfig = JSON.parse(raw) as Config
  
return cachedConfig
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
  cachedConfig = config
}
