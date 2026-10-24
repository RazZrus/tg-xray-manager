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

export function pingTest(host = '1.1.1.1'): string {
  try {
    return execSync(`ping -c 4 ${host}`, { encoding: 'utf-8', timeout: 15000 }).trim()
  } catch (e: unknown) {
    if (e instanceof Error && 'stdout' in e) {
      return (e as NodeJS.ErrnoException & { stdout: string }).stdout?.trim() || String(e)
    }

    return String(e)
  }
}

export function speedTest(): string {
  try {
    const bytesStr = execSync(
      'curl -o /dev/null -s -w "%{speed_download}" --max-time 20 "https://speed.cloudflare.com/__down?bytes=10000000"',
      { encoding: 'utf-8', timeout: 25000 },
    ).trim()
    const bytesPerSec = parseFloat(bytesStr)
    if (isNaN(bytesPerSec) || bytesPerSec === 0) {

      return 'Не удалось измерить скорость'
    }
    const mbps = ((bytesPerSec * 8) / 1_000_000).toFixed(1)
    const mbs  = (bytesPerSec / 1_000_000).toFixed(2)

    return `📥 ${mbps} Мбит/с (${mbs} МБ/с)\n\nИзмерение: загрузка 10 МБ с Cloudflare`
  } catch {

    return 'Ошибка: не удалось выполнить тест скорости'
  }
}

export function runShellCommand(command: string): string {
  const result = spawnSync('bash', ['-c', command], { encoding: 'utf-8', timeout: 30000 })
  const stdout = result.stdout?.trim() || ''
  const stderr = result.stderr?.trim() || ''
  const combined = [stdout, stderr].filter(Boolean).join('\n')
  
return combined || `(command exited with code ${result.status})`
}
