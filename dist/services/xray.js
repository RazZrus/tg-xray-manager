"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listUsers = listUsers;
exports.addUser = addUser;
exports.deleteUser = deleteUser;
exports.getUserLink = getUserLink;
exports.getUserQrPath = getUserQrPath;
exports.getUserStats = getUserStats;
exports.getBlockedStats = getBlockedStats;
exports.getXrayStatus = getXrayStatus;
exports.restartXray = restartXray;
exports.runShellCommand = runShellCommand;
exports.rebootServer = rebootServer;
exports.shutdownServer = shutdownServer;
const child_process_1 = require("child_process");
const XRAY_MGR = process.env.XRAY_MGR_PATH || 'xray-mgr';
function run(args) {
    const result = (0, child_process_1.spawnSync)(XRAY_MGR, args, {
        encoding: 'utf-8',
        timeout: 30000,
    });
    if (result.error) {
        throw new Error(`xray-mgr не найден: ${result.error.message}`);
    }
    const output = (result.stdout || '') + (result.stderr || '');
    if (result.status !== 0) {
        throw new Error(result.stderr?.trim() || `xray-mgr завершился с кодом ${result.status}`);
    }
    return result.stdout?.trim() || '';
}
function listUsers() {
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
function addUser(name) {
    const output = run(['add', name]);
    // Возвращаем vless:// ссылку из вывода
    const lines = output.split('\n');
    const link = lines.find(l => l.startsWith('vless://'));
    return link || output;
}
function deleteUser(name) {
    run(['del', name]);
}
function getUserLink(name) {
    return run(['link', name]);
}
function getUserQrPath(name) {
    // Генерируем QR в файл PNG для отправки в Telegram
    const link = getUserLink(name);
    const tmpFile = `/tmp/xray-qr-${name}-${Date.now()}.png`;
    const result = (0, child_process_1.spawnSync)('qrencode', ['-o', tmpFile, '-s', '6', link], {
        encoding: 'utf-8',
        timeout: 10000,
    });
    if (result.status !== 0 || result.error) {
        throw new Error('qrencode не найден или ошибка генерации QR. Установите: apt-get install qrencode');
    }
    return tmpFile;
}
function getUserStats(name) {
    return run(['stats', name]);
}
function getBlockedStats(user, period) {
    const args = ['blocked'];
    if (user)
        args.push(user);
    if (period)
        args.push(period);
    return run(args);
}
function getXrayStatus() {
    try {
        return (0, child_process_1.execSync)('systemctl status xray --no-pager', {
            encoding: 'utf-8',
            timeout: 10000,
        }).trim();
    }
    catch (e) {
        // systemctl status возвращает non-zero если сервис не активен — это нормально
        if (e instanceof Error && 'stdout' in e) {
            return e.stdout?.trim() || String(e);
        }
        return String(e);
    }
}
function restartXray() {
    (0, child_process_1.execSync)('systemctl restart xray', { timeout: 30000 });
}
function runShellCommand(command) {
    const result = (0, child_process_1.spawnSync)('bash', ['-c', command], {
        encoding: 'utf-8',
        timeout: 30000,
    });
    const stdout = result.stdout?.trim() || '';
    const stderr = result.stderr?.trim() || '';
    const combined = [stdout, stderr].filter(Boolean).join('\n');
    return combined || `(команда завершилась с кодом ${result.status})`;
}
function rebootServer() {
    const child = (0, child_process_1.spawn)('reboot', [], { detached: true, stdio: 'ignore' });
    child.unref();
}
function shutdownServer() {
    const child = (0, child_process_1.spawn)('shutdown', ['-h', 'now'], { detached: true, stdio: 'ignore' });
    child.unref();
}
//# sourceMappingURL=xray.js.map