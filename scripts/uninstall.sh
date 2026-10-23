#!/usr/bin/env bash
# Remove tg-xray-bot from server
# xray and its config are NOT touched — only the bot and xray-mgr
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║       tg-xray-bot uninstaller        ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "Will be removed:"
echo "  • systemd service $SERVICE_NAME"
echo "  • /usr/local/bin/xray-mgr"
echo "  • $CONFIG_DIR (config and DB)"
echo "  • $INSTALL_DIR (bot code)"
echo ""
echo -e "${YELLOW}xray and its config will NOT be affected.${NC}"
echo ""
read -rp "Continue? [y/N]: " confirm </dev/tty
[[ "${confirm,,}" == "y" ]] || { echo "Cancelled."; exit 0; }

# Service
step "Stopping service"
if systemctl is-active "$SERVICE_NAME" &>/dev/null; then
  systemctl stop "$SERVICE_NAME"
fi
if [[ -f /etc/systemd/system/${SERVICE_NAME}.service ]]; then
  systemctl disable "$SERVICE_NAME"
  rm /etc/systemd/system/${SERVICE_NAME}.service
  systemctl daemon-reload
  log "Service removed"
else
  warn "Service not found"
fi

# xray-mgr
step "Removing xray-mgr"
if [[ -f /usr/local/bin/xray-mgr ]]; then
  rm /usr/local/bin/xray-mgr
  log "xray-mgr removed"
else
  warn "xray-mgr not found"
fi

# npm link
step "Removing global link"
if command -v tg-xray-bot &>/dev/null; then
  npm unlink -g tg-xray-bot 2>/dev/null || true
  log "tg-xray-bot link removed"
fi

# Config and DB
step "Removing data"
if [[ -d "$CONFIG_DIR" ]]; then
  BACKUP="/tmp/tg-xray-bot-backup-$(date +%Y%m%d%H%M%S).tar.gz"
  tar -czf "$BACKUP" "$CONFIG_DIR"
  log "Backup: $BACKUP"
  rm -rf "$CONFIG_DIR"
  log "$CONFIG_DIR removed"
else
  warn "$CONFIG_DIR not found"
fi

# Code
step "Removing code"
if [[ -d "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  log "$INSTALL_DIR removed"
else
  warn "$INSTALL_DIR not found"
fi

echo ""
log "Uninstall complete. xray is still running."
