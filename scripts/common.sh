#!/usr/bin/env bash
# Shared utilities for tg-xray-bot scripts

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }
step()  { echo -e "\n${BLUE}━━━${NC} $*"; }

INSTALL_DIR="/opt/tg-xray-manager"
SERVICE_NAME="tg-xray-bot"
CONFIG_DIR="$HOME/.tg-xray-bot"

require_root() {
  [[ $EUID -eq 0 ]] || error "Run as root: sudo $0"
}
