import { execSync, spawnSync, spawn } from 'child_process'

export function getXrayStatus(): string {
  try {
    return execSync('systemctl status xray --no-pager', { encoding: 'utf-8', timeout: 10000 }).trim()
  } catch (e: unknown) {
    if (e instanceof Error && 'stdout' in e) {
      return (e as NodeJS.ErrnoException & { stdout: string }).stdout?.trim() || String(e)
    }
    
return String(e)
  }
}

export function restartXray(): void {
  execSync('systemctl restart xray', { timeout: 30000 })
}

export function rebootServer(): void {
  const child = spawn('reboot', [], { detached: true, stdio: 'ignore' })
  child.unref()
}

export function shutdownServer(): void {
  const child = spawn('shutdown', ['-h', 'now'], { detached: true, stdio: 'ignore' })
  child.unref()
}

export function runShellCommand(command: string): string {
  const result = spawnSync('bash', ['-c', command], { encoding: 'utf-8', timeout: 30000 })
  const stdout = result.stdout?.trim() || ''
  const stderr = result.stderr?.trim() || ''
  const combined = [stdout, stderr].filter(Boolean).join('\n')
  
return combined || `(command exited with code ${result.status})`
}
