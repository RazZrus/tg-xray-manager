import { execSync, spawnSync, spawn } from 'child_process';

const XRAY_MGR = process.env.XRAY_MGR_PATH || 'xray-mgr';

function run(args: string[]): string {
  const result = spawnSync(XRAY_MGR, args, {
    encoding: 'utf-8',
    timeout: 30000,
  });

  if (result.error) {
    throw new Error(`xray-mgr не найден: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `xray-mgr завершился с кодом ${result.status}`);
  }

  return result.stdout?.trim() || '';
}

export interface XrayUser {
  name: string;
  upload: string;
  download: string;
}

export function listUsers(): XrayUser[] {
  const output = run(['list']);
  const lines = output.split('\n').filter(l => l.trim());
  // Пропускаем заголовок (первые 2 строки)
  return lines.slice(2).map(line => {
    const parts = line.trim().split(/\s+/);
    return {
      name: parts[0] || '',
      upload: parts[1] ? `${parts[1]} ${parts[2] || ''}`.trim() : '0 B',
      download: parts[3] ? `${parts[3]} ${parts[4] || ''}`.trim() : '0 B',
    };
  }).filter(u => u.name);
}

export function addUser(name: string): string {
  const output = run(['add', name]);
  // Возвращаем vless:// ссылку из вывода
  const lines = output.split('\n');
  const link = lines.find(l => l.startsWith('vless://'));
  return link || output;
}

export function deleteUser(name: string): void {
  run(['del', name]);
}

export function getUserLink(name: string): string {
  return run(['link', name]);
}

export function getUserQrPath(name: string): string {
  // Генерируем QR в файл PNG для отправки в Telegram
  const link = getUserLink(name);
  const tmpFile = `/tmp/xray-qr-${name}-${Date.now()}.png`;

  const result = spawnSync('qrencode', ['-o', tmpFile, '-s', '6', link], {
    encoding: 'utf-8',
    timeout: 10000,
  });

  if (result.status !== 0 || result.error) {
    throw new Error('qrencode не найден или ошибка генерации QR. Установите: apt-get install qrencode');
  }

  return tmpFile;
}

export function getXrayStatus(): string {
  try {
    return execSync('systemctl status xray --no-pager', {
      encoding: 'utf-8',
      timeout: 10000,
    }).trim();
  } catch (e: unknown) {
    // systemctl status возвращает non-zero если сервис не активен — это нормально
    if (e instanceof Error && 'stdout' in e) {
      return (e as NodeJS.ErrnoException & { stdout: string }).stdout?.trim() || String(e);
    }
    return String(e);
  }
}

export function restartXray(): void {
  execSync('systemctl restart xray', { timeout: 30000 });
}

export function runShellCommand(command: string): string {
  const result = spawnSync('bash', ['-c', command], {
    encoding: 'utf-8',
    timeout: 30000,
  });

  const stdout = result.stdout?.trim() || '';
  const stderr = result.stderr?.trim() || '';
  const combined = [stdout, stderr].filter(Boolean).join('\n');

  return combined || `(команда завершилась с кодом ${result.status})`;
}

export function rebootServer(): void {
  const child = spawn('reboot', [], { detached: true, stdio: 'ignore' });
  child.unref();
}

export function shutdownServer(): void {
  const child = spawn('shutdown', ['-h', 'now'], { detached: true, stdio: 'ignore' });
  child.unref();
}
