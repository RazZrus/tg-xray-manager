import prompts from 'prompts'
import { saveConfig, type Config } from './config.js'
import { execSync } from 'child_process'
import fs from 'fs'
import os from 'os'

const XRAY_CONFIG = '/usr/local/etc/xray/config.json'

function readXrayPublicKey(): string {
  try {
    const raw = fs.readFileSync(XRAY_CONFIG, 'utf-8')
    const cfg = JSON.parse(raw) as { inbounds?: { tag: string; streamSettings?: { realitySettings?: { publicKey?: string } } }[] }
    const inbound = cfg.inbounds?.find(i => i.tag === 'vless-reality')
    return inbound?.streamSettings?.realitySettings?.publicKey ?? ''
  } catch {
    return ''
  }
}

export async function runWizard(): Promise<Config> {
  console.log('\n=== tg-xray-bot — initial setup ===\n')

  const answers = await prompts(
    [
      {
        type: 'text',
        name: 'botToken',
        message: 'Telegram Bot Token (get from @BotFather):',
        validate: (v: string) => v.trim().length > 10 || 'Enter a valid token',
      },
      {
        type: 'text',
        name: 'adminId',
        message: 'Your Telegram ID (get from @userinfobot):',
        validate: (v: string) => /^\d+$/.test(v.trim()) || 'Digits only',
      },
      {
        type: 'text',
        name: 'serverIp',
        message: 'Server public IP (leave empty for auto-detection):',
        initial: detectServerIp(),
      },
      {
        type: 'number',
        name: 'xrayPort',
        message: 'xray port:',
        initial: 443,
      },
      {
        type: 'text',
        name: 'sni',
        message: 'SNI (masquerade domain):',
        initial: 'www.microsoft.com',
      },
      {
        type: 'number',
        name: 'statsPort',
        message: 'xray gRPC Stats API port:',
        initial: 10085,
      },
      {
        type: 'text',
        name: 'serverName',
        message: 'Server display name (shown in VPN client as config name):',
        initial: os.hostname(),
      },
    ],
    {
      onCancel: () => {
        console.log('\nSetup cancelled.')
        process.exit(0)
      },
    }
  )

  const config: Config = {
    botToken: answers.botToken.trim(),
    adminIds: [parseInt((answers.adminId as string).trim(), 10)],
    serverIp: answers.serverIp.trim(),
    xrayPort: answers.xrayPort,
    sni: answers.sni.trim(),
    statsPort: answers.statsPort,
    serverName: answers.serverName.trim() || os.hostname(),
    publicKey: readXrayPublicKey(),
  }

  saveConfig(config)
  console.log('\nConfig saved.\n')

  return config
}

function detectServerIp(): string {
  try {
    return execSync('curl -s --max-time 3 https://api.ipify.org', { timeout: 5000 }).toString().trim()
  } catch {
    return ''
  }
}
