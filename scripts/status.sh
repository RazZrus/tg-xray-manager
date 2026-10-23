#!/usr/bin/env bash
# tg-xray-bot and xray status
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║       tg-xray-bot status             ║"
echo "╚══════════════════════════════════════╝"
echo ""

step "Bot ($SERVICE_NAME)"
if systemctl is-active "$SERVICE_NAME" &>/dev/null; then
  log "Running"
  systemctl show "$SERVICE_NAME" --property=ActiveEnterTimestamp --value | xargs -I{} echo "  Up since: {}"
else
  warn "Not running"
fi

step "xray"
if systemctl is-active xray &>/dev/null; then
  log "Running"
  systemctl show xray --property=ActiveEnterTimestamp --value | xargs -I{} echo "  Up since: {}"
else
  warn "Not running"
fi

step "Config"
if [[ -f "$CONFIG_DIR/config.json" ]]; then
  log "$CONFIG_DIR/config.json"
else
  warn "Config not found"
fi

step "Database"
if [[ -f "$CONFIG_DIR/bot.db" ]]; then
  local_size=$(du -h "$CONFIG_DIR/bot.db" | cut -f1)
  log "$CONFIG_DIR/bot.db ($local_size)"
else
  warn "Database not found"
fi

echo ""
