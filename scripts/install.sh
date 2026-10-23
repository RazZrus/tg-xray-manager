#!/usr/bin/env bash
# tg-xray-manager installer
#
# Установка одной командой:
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
  [[ $EUID -eq 0 ]] || error "Запустите от root: sudo bash ..."
}

# ─── whiptail ────────────────────────────────────────────────────────────────

ensure_whiptail() {
  command -v whiptail &>/dev/null || apt-get install -y whiptail
}

# Меню со стрелками: menu <title> <item1> <desc1> <item2> <desc2> ...
# Возвращает выбранный item в stdout
menu() {
  local title="$1"; shift
  local items=("$@")
  whiptail --title "tg-xray-manager installer" \
           --menu "$title" 15 60 "${#items[@]}" \
           "${items[@]}" \
           3>&1 1>&2 2>&3 3>&- </dev/tty
}

# Поле ввода: inputbox <title> <default>
inputbox() {
  local title="$1" default="${2:-}"
  whiptail --title "tg-xray-manager installer" \
           --inputbox "$title" 10 60 "$default" \
           3>&1 1>&2 2>&3 3>&- </dev/tty
}

# Диалог подтверждения
confirm() {
  local msg="$1"
  whiptail --title "tg-xray-manager installer" \
           --yesno "$msg" 10 60 \
           </dev/tty
}

# ─── Определение ОС ──────────────────────────────────────────────────────────

detect_os() {
  if [[ -f /etc/os-release ]]; then
    . /etc/os-release
  else
    error "Не удалось определить ОС. Поддерживается Ubuntu 22.04+"
  fi
  if [[ "${ID:-}" != "ubuntu" ]] && [[ "${ID:-}" != "debian" ]]; then
    warn "Протестировано на Ubuntu 22.04+. Текущая ОС: ${ID:-unknown} ${VERSION_ID:-}"
  fi
}

# ─── Node.js ─────────────────────────────────────────────────────────────────

install_nodejs() {
  if command -v node &>/dev/null; then
    local ver
    ver=$(node --version | sed 's/v//' | cut -d. -f1)
    if (( ver >= 20 )); then
      log "Node.js $(node --version) уже установлен"
      return
    fi
    warn "Node.js $(node --version) устарел, обновляю..."
  fi
  step "Установка Node.js 20 LTS"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  log "Node.js $(node --version) установлен"
}

# ─── xray-core ───────────────────────────────────────────────────────────────

install_xray() {
  step "Установка xray-core"
  bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
  log "xray установлен"
}

# ─── Генерация конфига xray с нуля ───────────────────────────────────────────

generate_xray_config() {
  local server_ip="$1" port="${2:-443}" sni="${3:-www.microsoft.com}"

  step "Генерация xray конфига (VLESS+REALITY+TCP+gRPC Stats)"

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
  log "Конфиг сгенерирован (public key: ${public_key})"
}

# ─── Патч существующего конфига для Stats API ────────────────────────────────

patch_xray_config_for_stats() {
  local config="/usr/local/etc/xray/config.json"
  [[ -f "$config" ]] || error "Конфиг xray не найден: $config"

  step "Добавление Stats API в конфиг xray"

  if jq -e '.stats' "$config" &>/dev/null; then
    log "Stats API уже настроен"
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
  log "Stats API добавлен в конфиг"
}

# ─── xray-mgr ────────────────────────────────────────────────────────────────

install_xray_mgr() {
  step "Установка xray-mgr"
  apt-get install -y jq qrencode bc curl

  # Если запущено из клонированного репо — берём локальный файл,
  # иначе (curl pipe) — скачиваем с GitHub напрямую
  local src=""
  local script_src="${BASH_SOURCE[0]:-}"
  if [[ -n "$script_src" && "$script_src" != /dev/fd/* && "$script_src" != /proc/* ]]; then
    local script_dir
    script_dir="$(cd "$(dirname "$script_src")" && pwd)"
    [[ -f "${script_dir}/xray-mgr.sh" ]] && src="${script_dir}/xray-mgr.sh"
  fi
  # Также проверяем, не клонировали ли репо уже в INSTALL_DIR
  [[ -z "$src" && -f "${INSTALL_DIR}/scripts/xray-mgr.sh" ]] && src="${INSTALL_DIR}/scripts/xray-mgr.sh"

  if [[ -n "$src" ]]; then
    cp "$src" /usr/local/bin/xray-mgr
  else
    curl -fsSL "$XRAY_MGR_URL" -o /usr/local/bin/xray-mgr
  fi

  chmod +x /usr/local/bin/xray-mgr
  log "xray-mgr установлен → /usr/local/bin/xray-mgr"
}

# ─── Бот ─────────────────────────────────────────────────────────────────────

install_bot() {
  step "Установка tg-xray-manager из GitHub"
  command -v git &>/dev/null || apt-get install -y git

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    warn "$INSTALL_DIR уже существует — обновляю"
    git -C "$INSTALL_DIR" pull origin main
  else
    git clone "$REPO_URL" "$INSTALL_DIR"
  fi

  cd "$INSTALL_DIR"
  rm -rf node_modules
  NODE_ENV=development npm ci
  npm run build
  npm prune --omit=dev
  npm link
  log "tg-xray-manager установлен в $INSTALL_DIR"
}

# ─── PM2 ─────────────────────────────────────────────────────────────────────

setup_pm2() {
  step "Настройка PM2"
  command -v pm2 &>/dev/null || npm install -g pm2
  log "PM2 $(pm2 --version) готов"
}

# ─── Главное меню ────────────────────────────────────────────────────────────

main() {
  require_root
  detect_os
  ensure_whiptail

  # Выбор режима
  local mode
  mode=$(menu \
    "Выберите режим установки:" \
    "A" "Только бот + xray-mgr  (xray уже установлен)" \
    "B" "Полная установка с нуля (xray + конфиг + бот)")

  case "$mode" in
    A)
      install_nodejs
      install_xray_mgr
      patch_xray_config_for_stats
      systemctl restart xray
      setup_pm2
      install_bot
      ;;
    B)
      local auto_ip
      auto_ip=$(curl -s --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')

      local server_ip xray_port sni
      server_ip=$(inputbox "Внешний IP сервера" "$auto_ip")
      xray_port=$(inputbox "Порт xray" "443")
      sni=$(inputbox "SNI (домен для маскировки)" "www.microsoft.com")

      install_nodejs
      install_xray
      generate_xray_config "$server_ip" "$xray_port" "$sni"
      systemctl enable --now xray
      install_xray_mgr
      setup_pm2
      install_bot
      ;;
  esac

  clear
  echo ""
  log "Установка завершена!"
  echo ""
  echo "  Первый запуск:  tg-xray-bot"
  echo "  Обновление:     bash ${INSTALL_DIR}/scripts/update.sh"
  echo "  Удаление:       bash ${INSTALL_DIR}/scripts/uninstall.sh"
  echo ""
}

main "$@"
