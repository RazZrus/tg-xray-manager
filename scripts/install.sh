#!/usr/bin/env bash
# tg-xray-manager installer
#
# One-line install:
#   bash <(curl -fsSL https://raw.githubusercontent.com/RazZrus/tg-xray-manager/main/scripts/install.sh)
set -euo pipefail

REPO_URL="https://github.com/RazZrus/tg-xray-manager.git"
INSTALL_DIR="/opt/tg-xray-manager"
XRAY_MGR_URL="https://raw.githubusercontent.com/RazZrus/tg-xray-manager/main/scripts/xray-mgr.sh"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }
step()  { echo -e "\n${BLUE}━━━${NC} $*"; }

require_root() {
  [[ $EUID -eq 0 ]] || error "Run as root: sudo bash ..."
}

# ─── Interactive UI ─────────────────────────────────────────────────────────

DIM='\033[2m'
BOLD='\033[1m'
CYAN='\033[0;36m'

# Arrow-key selector: select_option <result_var> <title> <label1> <label2> ...
# Writes the 0-based index into result_var
select_option() {
  local _var="$1" title="$2"; shift 2
  local options=("$@")
  local count=${#options[@]}
  local selected=0

  # Hide cursor
  printf '\e[?25l' >/dev/tty

  # Restore cursor on return
  trap 'printf "\e[?25h" >/dev/tty' RETURN

  # Initial render
  printf '\n  %b%s%b\n\n' "$BOLD" "$title" "$NC" >/dev/tty
  for i in "${!options[@]}"; do
    if (( i == selected )); then
      printf '  %b❯ %s%b\n' "$CYAN" "${options[$i]}" "$NC" >/dev/tty
    else
      printf '    %b%s%b\n' "$DIM" "${options[$i]}" "$NC" >/dev/tty
    fi
  done

  while true; do
    local key
    IFS= read -rsn1 key </dev/tty

    if [[ "$key" == $'\x1b' ]]; then
      read -rsn2 rest </dev/tty
      key+="$rest"
    fi

    case "$key" in
      $'\x1b[A'|k) # Up
        (( selected > 0 )) && (( selected-- ))
        ;;
      $'\x1b[B'|j) # Down
        (( selected < count - 1 )) && (( selected++ ))
        ;;
      '') # Enter
        break
        ;;
      *) continue ;;
    esac

    # Redraw: move up count lines
    printf '\e[%dA' "$count" >/dev/tty
    for i in "${!options[@]}"; do
      printf '\r\e[2K' >/dev/tty
      if (( i == selected )); then
        printf '  %b❯ %s%b\n' "$CYAN" "${options[$i]}" "$NC" >/dev/tty
      else
        printf '    %b%s%b\n' "$DIM" "${options[$i]}" "$NC" >/dev/tty
      fi
    done
  done

  echo "" >/dev/tty
  eval "$_var=$selected"
}

# Text input with default: prompt_input <result_var> <label> [default]
prompt_input() {
  local _var="$1" label="$2" default="${3:-}"
  local value

  if [[ -n "$default" ]]; then
    printf '  %b%s%b %b(%s)%b: ' "$BOLD" "$label" "$NC" "$DIM" "$default" "$NC" >/dev/tty
  else
    printf '  %b%s%b: ' "$BOLD" "$label" "$NC" >/dev/tty
  fi

  IFS= read -r value </dev/tty
  value="${value:-$default}"
  eval "$_var=\$value"
}

# Confirmation: confirm <message> → return 0 (yes) / 1 (no)
confirm() {
  local msg="$1" reply
  printf '  %s %b[y/N]%b: ' "$msg" "$DIM" "$NC" >/dev/tty
  IFS= read -rn1 reply </dev/tty
  echo "" >/dev/tty
  [[ "${reply,,}" == "y" ]]
}

# ─── OS detection ───────────────────────────────────────────────────────────

detect_os() {
  if [[ -f /etc/os-release ]]; then
    . /etc/os-release
  else
    error "Could not detect OS. Ubuntu 22.04+ is supported"
  fi
  if [[ "${ID:-}" != "ubuntu" ]] && [[ "${ID:-}" != "debian" ]]; then
    warn "Tested on Ubuntu 22.04+. Current OS: ${ID:-unknown} ${VERSION_ID:-}"
  fi
}

# ─── Node.js ────────────────────────────────────────────────────────────────

install_nodejs() {
  if command -v node &>/dev/null; then
    local ver
    ver=$(node --version | sed 's/v//' | cut -d. -f1)
    if (( ver >= 20 )); then
      log "Node.js $(node --version) already installed"
      return
    fi
    warn "Node.js $(node --version) is outdated, upgrading..."
  fi
  step "Installing Node.js 20 LTS"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  log "Node.js $(node --version) installed"
}

# ─── xray-core ──────────────────────────────────────────────────────────────

install_xray() {
  step "Installing xray-core"
  bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
  log "xray installed"
}

# ─── Generate xray config from scratch ──────────────────────────────────────

generate_xray_config() {
  local server_ip="$1" port="${2:-443}" sni="${3:-www.microsoft.com}"

  step "Generating xray config (VLESS+REALITY+TCP+gRPC Stats)"

  local keypair private_key public_key short_id
  keypair=$(xray x25519)
  private_key=$(echo "$keypair" | grep 'Private key' | awk '{print $NF}')
  public_key=$(echo "$keypair"  | grep 'Public key'  | awk '{print $NF}')
  short_id=$(openssl rand -hex 8)

  mkdir -p /usr/local/etc/xray /var/log/xray

  cat > /usr/local/etc/xray/config.json <<EOF
{
  "log": {
    "loglevel": "warning",
    "access": "/var/log/xray/access.log",
    "error": "/var/log/xray/error.log"
  },
  "stats": {},
  "api": { "tag": "api", "services": ["StatsService"] },
  "policy": {
    "levels": { "0": { "statsUserUplink": true, "statsUserDownlink": true } },
    "system": {
      "statsInboundUplink": true, "statsInboundDownlink": true,
      "statsOutboundUplink": true, "statsOutboundDownlink": true
    }
  },
  "inbounds": [
    {
      "tag": "vless-in",
      "listen": "0.0.0.0",
      "port": ${port},
      "protocol": "vless",
      "settings": { "clients": [], "decryption": "none" },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "${sni}:443",
          "xver": 0,
          "serverNames": ["${sni}"],
          "privateKey": "${private_key}",
          "publicKey": "${public_key}",
          "shortIds": ["${short_id}"]
        }
      },
      "sniffing": { "enabled": true, "destOverride": ["http", "tls"] }
    },
    {
      "tag": "api-in",
      "listen": "127.0.0.1",
      "port": 10085,
      "protocol": "dokodemo-door",
      "settings": { "address": "127.0.0.1" }
    }
  ],
  "outbounds": [
    { "tag": "direct",  "protocol": "freedom",   "settings": {} },
    { "tag": "blocked", "protocol": "blackhole",  "settings": {} }
  ],
  "routing": {
    "domainStrategy": "IPIfNonMatch",
    "rules": [
      { "type": "field", "inboundTag": ["api-in"], "outboundTag": "api" },
      { "type": "field", "ip": ["geoip:ru","geoip:cn","geoip:by"], "outboundTag": "blocked" },
      { "type": "field", "domain": ["geosite:category-ads-all"],   "outboundTag": "blocked" },
      { "type": "field", "protocol": ["bittorrent"],                "outboundTag": "blocked" }
    ]
  }
}
EOF
  log "Config generated (public key: ${public_key})"
}

# ─── Patch existing config for Stats API ────────────────────────────────────

patch_xray_config_for_stats() {
  local config="/usr/local/etc/xray/config.json"
  [[ -f "$config" ]] || error "xray config not found: $config"

  step "Adding Stats API to xray config"

  if jq -e '.stats' "$config" &>/dev/null; then
    log "Stats API already configured"
    return
  fi

  local tmp
  tmp=$(mktemp)
  jq '
    . + {
      "stats": {},
      "api": { "tag": "api", "services": ["StatsService"] },
      "policy": {
        "levels": { "0": { "statsUserUplink": true, "statsUserDownlink": true } },
        "system": {
          "statsInboundUplink": true, "statsInboundDownlink": true,
          "statsOutboundUplink": true, "statsOutboundDownlink": true
        }
      }
    }
    | .inbounds += [{
        "tag": "api-in", "listen": "127.0.0.1", "port": 10085,
        "protocol": "dokodemo-door", "settings": { "address": "127.0.0.1" }
      }]
    | .routing.rules = ([{
        "type": "field", "inboundTag": ["api-in"], "outboundTag": "api"
      }] + (.routing.rules // []))
  ' "$config" > "$tmp"
  cp "$tmp" "$config" && rm "$tmp"
  log "Stats API added to config"
}

# ─── Dependencies ───────────────────────────────────────────────────────────

install_deps() {
  step "Installing system dependencies"
  apt-get install -y jq qrencode bc curl git
  log "Dependencies installed"
}

# ─── xray-mgr ──────────────────────────────────────────────────────────────

install_xray_mgr() {
  step "Installing xray-mgr"

  # Repo already cloned — use local file
  if [[ -f "${INSTALL_DIR}/scripts/xray-mgr.sh" ]]; then
    cp "${INSTALL_DIR}/scripts/xray-mgr.sh" /usr/local/bin/xray-mgr
  else
    curl -fsSL "$XRAY_MGR_URL" -o /usr/local/bin/xray-mgr
  fi

  chmod +x /usr/local/bin/xray-mgr
  log "xray-mgr installed → /usr/local/bin/xray-mgr"
}

# ─── Bot ────────────────────────────────────────────────────────────────────

install_bot() {
  step "Installing tg-xray-manager from GitHub"

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    warn "$INSTALL_DIR already exists — updating"
    git -C "$INSTALL_DIR" fetch origin main
    git -C "$INSTALL_DIR" reset --hard origin/main
  else
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi

  cd "$INSTALL_DIR"
  npm install
  npm run build
  npm link
  log "tg-xray-manager installed in $INSTALL_DIR"
}

# ─── systemd service ────────────────────────────────────────────────────────

setup_systemd_service() {
  step "Setting up systemd service"

  cat > /etc/systemd/system/tg-xray-bot.service <<EOF
[Unit]
Description=Telegram Xray VPN Manager Bot
After=network.target xray.service

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=$(command -v node) ${INSTALL_DIR}/dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable tg-xray-bot
  log "Service tg-xray-bot created and enabled"
}

# ─── Bot configuration ──────────────────────────────────────────────────────

configure_bot() {
  local config_dir="/root/.tg-xray-bot"
  local config_path="${config_dir}/config.json"

  if [[ -f "$config_path" ]]; then
    if ! confirm "Bot config already exists. Reconfigure?"; then
      log "Using existing config"
      return
    fi
  fi

  step "Configuring Telegram bot"

  local bot_token admin_id stats_port
  prompt_input bot_token  "Bot Token (from @BotFather)" ""
  prompt_input admin_id   "Your Telegram ID (get it from @userinfobot)" ""
  prompt_input stats_port "gRPC Stats API port" "10085"

  # Detect server_ip and xray_port from xray config if available
  local server_ip xray_port sni
  if [[ -f /usr/local/etc/xray/config.json ]]; then
    xray_port=$(jq -r '[.inbounds[] | select(.protocol == "vless")][0].port // 443' /usr/local/etc/xray/config.json)
    sni=$(jq -r '[.inbounds[] | select(.protocol == "vless")][0].streamSettings.realitySettings.serverNames[0] // "www.microsoft.com"' /usr/local/etc/xray/config.json)
  else
    xray_port=443
    sni="www.microsoft.com"
  fi
  server_ip=$(curl -s --max-time 3 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')

  mkdir -p "$config_dir"
  cat > "$config_path" <<EOF
{
  "botToken": "${bot_token}",
  "adminIds": [${admin_id}],
  "serverIp": "${server_ip}",
  "xrayPort": ${xray_port},
  "sni": "${sni}",
  "statsPort": ${stats_port}
}
EOF
  chmod 600 "$config_path"
  log "Bot config saved: $config_path"
}

# ─── Main ───────────────────────────────────────────────────────────────────

main() {
  require_root
  detect_os

  echo ""
  echo -e "${BOLD}  tg-xray-manager installer${NC}"
  echo ""

  local mode
  select_option mode "Installation mode:" \
    "Bot + xray-mgr only  (xray already installed)" \
    "Full install from scratch  (xray + config + bot)"

  case "$mode" in
    0)
      install_deps
      install_nodejs
      install_bot
      install_xray_mgr
      patch_xray_config_for_stats
      systemctl restart xray
      configure_bot
      setup_systemd_service
      systemctl start tg-xray-bot
      ;;
    1)
      local auto_ip
      auto_ip=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')

      local server_ip xray_port sni
      prompt_input server_ip "Server public IP" "$auto_ip"
      prompt_input xray_port "xray port" "443"
      prompt_input sni       "SNI (masquerade domain)" "www.microsoft.com"

      install_deps
      install_nodejs
      install_xray
      generate_xray_config "$server_ip" "$xray_port" "$sni"
      systemctl enable --now xray
      install_bot
      install_xray_mgr
      configure_bot
      setup_systemd_service
      systemctl start tg-xray-bot
      ;;
  esac

  clear
  echo ""
  log "Installation complete! Bot is running."
  echo ""
  echo "  Manage:     systemctl {start|stop|restart} tg-xray-bot"
  echo "  Status:     bash ${INSTALL_DIR}/scripts/status.sh"
  echo "  Logs:       bash ${INSTALL_DIR}/scripts/logs.sh [lines] [bot|xray|all]"
  echo "  Update:     bash ${INSTALL_DIR}/scripts/update.sh"
  echo "  Uninstall:  bash ${INSTALL_DIR}/scripts/uninstall.sh"
  echo ""
}

main "$@"
