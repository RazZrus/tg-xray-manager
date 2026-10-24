import { spawnSync } from 'child_process'

const XRAY_MGR = process.env.XRAY_MGR_PATH || 'xray-mgr'

export function run(args: string[]): string {
  const result = spawnSync(XRAY_MGR, args, { encoding: 'utf-8', timeout: 30000 })

  if (result.error) {throw new Error(`xray-mgr not found: ${result.error.message}`)}
  if (result.status !== 0) {throw new Error(result.stderr?.trim() || `xray-mgr exited with code ${result.status}`)}

  return result.stdout?.trim() || ''
}

export interface XrayUser {
  name: string;
  upload: string;
  download: string;
}
