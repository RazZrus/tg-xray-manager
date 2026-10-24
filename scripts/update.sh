#!/usr/bin/env bash
# Update tg-xray-bot from GitHub
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

BOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

step "Updating tg-xray-bot"
echo "Directory: $BOT_DIR"

step "Fetching updates"
cd "$BOT_DIR"
git fetch origin main
git reset --hard origin/main
log "Code updated"

step "Building"
npm install
npm run build
log "Build complete"

step "Updating xray-mgr"
if [[ -f "$BOT_DIR/scripts/xray-mgr.sh" && $EUID -eq 0 ]]; then
  cp "$BOT_DIR/scripts/xray-mgr.sh" /usr/local/bin/xray-mgr
  chmod +x /usr/local/bin/xray-mgr
  log "xray-mgr updated"
fi

step "Restarting"
if systemctl is-active "$SERVICE_NAME" &>/dev/null; then
  systemctl restart "$SERVICE_NAME"
  log "Bot restarted"
else
  warn "Service not running. Start it: systemctl start $SERVICE_NAME"
fi

# Reload timer unit in case it changed
if systemctl list-unit-files tg-xray-report.timer &>/dev/null; then
  systemctl daemon-reload
  systemctl restart tg-xray-report.timer
  log "Report timer reloaded"
fi

echo ""
log "Update complete"
