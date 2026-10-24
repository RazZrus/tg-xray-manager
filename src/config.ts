import fs from 'fs'
import path from 'path'
import os from 'os'
import { execSync } from 'child_process'

const CONFIG_DIR  = path.join(os.homedir(), '.tg-xray-bot')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')
const XRAY_CONFIG = '/usr/local/etc/xray/config.json'

// Fields in two groups:
// USER_PROVIDED:  botToken, adminIds, serverIp, serverName
//                 (set by wizard, never overwritten by sync)
// XRAY_DERIVED:   xrayPort, sni, statsPort, publicKey, shortId
//                 (written by xray-mgr sync / startup sync, not asked in wizard)

export interface Config {
  botToken:   string;
  adminIds:   number[];
  serverIp:   string;
  serverName: string;
  xrayPort:   number;
  sni:        string;
  statsPort:  number;
  publicKey:  string;
  shortId:    string;
}

interface XrayInbound {
  tag: string;
  port?: number;
  streamSettings?: {
    realitySettings?: {
      publicKey?:  string;
      privateKey?: string;
      serverNames?: string[];
      shortIds?:   string[];
    };
  };
}

function derivePublicKey(privateKey: string): string {
  try {
    const result = execSync(`/usr/local/bin/xray x25519 -i ${privateKey}`, {
      encoding: 'utf-8',
      timeout: 5000,
    })
    const match = result.match(/PublicKey\)?:\s*(\S+)/i)

    return match ? match[1] : ''
  } catch {
    return ''
  }
}

export function readXrayDerivedFields(): Partial<Config> {
  try {
    const raw = fs.readFileSync(XRAY_CONFIG, 'utf-8')
    const cfg = JSON.parse(raw) as { inbounds?: XrayInbound[] }
    const vless = cfg.inbounds?.find(i => i.tag === 'vless-reality')
    const api   = cfg.inbounds?.find(i => i.tag === 'api')
    const rs    = vless?.streamSettings?.realitySettings

    const publicKey = rs?.publicKey || (rs?.privateKey ? derivePublicKey(rs.privateKey) : '')

    return {
      ...(vless?.port           && { xrayPort:  vless.port }),
      ...(rs?.serverNames?.[0]  && { sni:       rs.serverNames[0] }),
      ...(publicKey              && { publicKey }),
      ...(api?.port             && { statsPort:  api.port }),
      ...(rs?.shortIds?.[0]     && { shortId:   rs.shortIds[0] }),
    }
  } catch {
    return {}
  }
}

const XRAY_DERIVED: (keyof Config)[] = ['xrayPort', 'sni', 'statsPort', 'publicKey', 'shortId']

let cachedConfig: Config | null = null

export function configExists(): boolean {
  return fs.existsSync(CONFIG_PATH)
}

export function loadConfig(): Config {
  if (cachedConfig) {
    return cachedConfig
  }

  if (!configExists()) {
    throw new Error(`Config not found: ${CONFIG_PATH}. Run tg-xray-bot without arguments to configure.`)
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
  const config = JSON.parse(raw) as Config

  // Migration: fill any missing xray-derived fields from xray config (one-time on upgrade)
  const missing = XRAY_DERIVED.filter(k => !config[k])
  if (missing.length > 0) {
    const fromXray = readXrayDerivedFields()
    const filled = missing.filter(k => fromXray[k] !== undefined)
    if (filled.length > 0) {
      Object.assign(config, Object.fromEntries(filled.map(k => [k, fromXray[k]])))
      saveConfig(config)
      console.log(`[config] migrated from xray config: ${filled.join(', ')}`)
    }
  }

  // Validate all xray-derived fields are present
  const stillMissing = XRAY_DERIVED.filter(k => !config[k])
  if (stillMissing.length > 0) {
    throw new Error(
      `Config missing xray fields: ${stillMissing.join(', ')}.\nRun: sudo xray-mgr sync`,
    )
  }

  cachedConfig = config

  return cachedConfig
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 })
  cachedConfig = config
}
