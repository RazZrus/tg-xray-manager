#!/usr/bin/env bash
# View tg-xray-bot logs
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/common.sh"

LINES="${1:-50}"
SERVICE="${2:-$SERVICE_NAME}"

case "$SERVICE" in
  bot|tg-xray-bot)
    echo "$SERVICE_NAME logs (last $LINES lines):"
    journalctl -u "$SERVICE_NAME" -n "$LINES" --no-pager
    ;;
  xray)
    echo "xray logs (last $LINES lines):"
    journalctl -u xray -n "$LINES" --no-pager
    ;;
  all)
    echo "$SERVICE_NAME logs (last $LINES lines):"
    journalctl -u "$SERVICE_NAME" -n "$LINES" --no-pager
    echo ""
    echo "xray logs (last $LINES lines):"
    journalctl -u xray -n "$LINES" --no-pager
    ;;
  *)
    echo "Usage: logs.sh [lines] [bot|xray|all]"
    echo "  Default: last 50 lines of bot logs"
    exit 1
    ;;
esac
