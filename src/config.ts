import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'

const CONFIG_DIR  = path.join(os.homedir(), '.tg-xray-bot')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')
const XRAY_CONFIG = '/usr/local/etc/xray/config.json'

interface XrayInbound {
  tag: string;
  port?: number;
  streamSettings?: {
    realitySettings?: {
      publicKey?: string;
      privateKey?: string;
      serverNames?: string[];
    };
  };
}

function derivePublicKey(privateKey: string): string {
  try {
    const result = execSync(`/usr/local/bin/xray x25519 -i ${privateKey}`, {
      encoding: 'utf-8',
      timeout: 5000,
    })
    const match = result.match(/Public key:\s*(\S+)/)

    return match ? match[1] : ''
  } catch {
    return ''
  }
}

function readFromXray(): Partial<Config> {
  try {
    const raw = fs.readFileSync(XRAY_CONFIG, 'utf-8')
    const cfg = JSON.parse(raw) as { inbounds?: XrayInbound[] }
    const vless = cfg.inbounds?.find(i => i.tag === 'vless-reality')
    const api   = cfg.inbounds?.find(i => i.tag === 'api')
    const rs    = vless?.streamSettings?.realitySettings

    const publicKey = rs?.publicKey || (rs?.privateKey ? derivePublicKey(rs.privateKey) : '')

    return {
      ...(vless?.port          && { xrayPort:  vless.port }),
      ...(rs?.serverNames?.[0] && { sni:       rs.serverNames[0] }),
      ...(publicKey            && { publicKey }),
      ...(api?.port            && { statsPort:  api.port }),
    }
  } catch {
    return {}
  }
}

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
  const config = JSON.parse(raw) as Config

  const migratable: (keyof Config)[] = ['publicKey', 'xrayPort', 'sni', 'statsPort']
  const missing = migratable.filter(k => !config[k])
  if (missing.length > 0) {
    const fromXray = readFromXray()
    const filled = missing.filter(k => fromXray[k] !== undefined)
    if (filled.length > 0) {
      Object.assign(config, Object.fromEntries(filled.map(k => [k, fromXray[k]])))
      saveConfig(config)
      console.log(`[config] migrated from xray config: ${filled.join(', ')}`)
    }
  }

  cachedConfig = config

return cachedConfig
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
  cachedConfig = config
}
