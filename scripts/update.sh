#!/usr/bin/env bash
# Обновление tg-xray-bot из GitHub
set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
step() { echo -e "\n━━━ $*"; }

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step "Обновление tg-xray-bot"
echo "Директория: $BOT_DIR"

# 1. Получаем последние изменения
step "git pull"
cd "$BOT_DIR"
git fetch origin main
git reset --hard origin/main
log "Код обновлён"

# 2. Устанавливаем зависимости (dist/ уже в репо, сборка не нужна)
step "npm install"
npm install --omit=dev
log "Зависимости обновлены"

# 4. Обновляем xray-mgr если он изменился
step "Обновление xray-mgr"
if [[ -f "$BOT_DIR/scripts/xray-mgr.sh" ]]; then
  if [[ $EUID -eq 0 ]]; then
    cp "$BOT_DIR/scripts/xray-mgr.sh" /usr/local/bin/xray-mgr
    chmod +x /usr/local/bin/xray-mgr
    log "xray-mgr обновлён"
  else
    warn "Для обновления xray-mgr нужен root: sudo cp $BOT_DIR/scripts/xray-mgr.sh /usr/local/bin/xray-mgr"
  fi
fi

# 5. Перезапуск сервиса
step "Перезапуск tg-xray-bot"
if systemctl is-active tg-xray-bot &>/dev/null; then
  systemctl restart tg-xray-bot
  log "Бот перезапущен"
else
  warn "Сервис tg-xray-bot не запущен. Запустите: systemctl start tg-xray-bot"
fi

echo ""
log "Обновление завершено"
