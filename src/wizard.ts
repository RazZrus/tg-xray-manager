import prompts from 'prompts'
import { saveConfig, readXrayDerivedFields, type Config } from './config.js'
import { execSync } from 'child_process'
import os from 'os'

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

  const xrayFields = readXrayDerivedFields()
  const missingXray = (['xrayPort', 'sni', 'statsPort', 'publicKey', 'shortId'] as const)
    .filter(k => !xrayFields[k])

  if (missingXray.length > 0) {
    console.error(`\nERROR: Could not read from xray config: ${missingXray.join(', ')}`)
    console.error('Fix xray config and re-run, or: sudo xray-mgr sync')
    process.exit(1)
  }

  const config: Config = {
    botToken:   answers.botToken.trim(),
    adminIds:   [parseInt((answers.adminId as string).trim(), 10)],
    serverIp:   answers.serverIp.trim(),
    serverName: answers.serverName.trim() || os.hostname(),
    xrayPort:   xrayFields.xrayPort!,
    sni:        xrayFields.sni!,
    statsPort:  xrayFields.statsPort!,
    publicKey:  xrayFields.publicKey!,
    shortId:    xrayFields.shortId!,
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
