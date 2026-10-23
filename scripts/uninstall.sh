#!/usr/bin/env bash
# Удаление tg-xray-bot с сервера
# xray и его конфиг НЕ трогаются — только бот и xray-mgr
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
step() { echo -e "\n━━━ $*"; }

echo ""
echo "╔══════════════════════════════════════╗"
echo "║       tg-xray-bot uninstaller        ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "Будет удалено:"
echo "  • PM2-процесс tg-xray-bot"
echo "  • /usr/local/bin/xray-mgr"
echo "  • ~/.tg-xray-bot/ (конфиг и база данных)"
echo ""
echo -e "${YELLOW}xray и его конфиг НЕ будут затронуты.${NC}"
echo ""
read -rp "Продолжить? [y/N]: " confirm </dev/tty
[[ "${confirm,,}" == "y" ]] || { echo "Отменено."; exit 0; }

# PM2
step "Остановка PM2-процесса"
if command -v pm2 &>/dev/null; then
  if pm2 describe tg-xray-bot &>/dev/null; then
    pm2 stop tg-xray-bot
    pm2 delete tg-xray-bot
    pm2 save
    log "PM2-процесс удалён"
  else
    warn "PM2-процесс tg-xray-bot не найден"
  fi
else
  warn "PM2 не установлен"
fi

# xray-mgr
step "Удаление xray-mgr"
if [[ -f /usr/local/bin/xray-mgr ]]; then
  if [[ $EUID -eq 0 ]]; then
    rm /usr/local/bin/xray-mgr
    log "xray-mgr удалён"
  else
    warn "Нужен root для удаления xray-mgr: sudo rm /usr/local/bin/xray-mgr"
  fi
else
  warn "xray-mgr не найден"
fi

# Конфиг и БД
step "Удаление конфига и базы данных"
CONFIG_DIR="$HOME/.tg-xray-bot"
if [[ -d "$CONFIG_DIR" ]]; then
  # Бэкап на всякий случай
  BACKUP="/tmp/tg-xray-bot-backup-$(date +%Y%m%d%H%M%S).tar.gz"
  tar -czf "$BACKUP" "$CONFIG_DIR"
  log "Бэкап сохранён: $BACKUP"
  rm -rf "$CONFIG_DIR"
  log "Удалено: $CONFIG_DIR"
else
  warn "$CONFIG_DIR не найден"
fi

echo ""
log "Удаление завершено. Бот остановлен, xray продолжает работу."
echo ""
echo "Для повторной установки: bash scripts/install.sh"
