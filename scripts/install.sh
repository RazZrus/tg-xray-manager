#!/usr/bin/env bash
# tg-xray-bot installer
# Режим A: xray уже установлен — ставим только бот + xray-mgr
# Режим B: полная установка с нуля (xray + конфиги + бот + xray-mgr)
#
# Установка одной командой:
#   bash <(curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/tg-xray-vpn-bot/main/scripts/install.sh)
set -euo pipefail

# При запуске через curl | bash stdin занят пайпом — читаем с терминала напрямую
TTY=/dev/tty
ask() {
  local prompt="$1" var="$2" default="${3:-}"
  if [[ -n "$default" ]]; then
    read -rp "$prompt [$default]: " "$var" <"$TTY"
    [[ -z "${!var}" ]] && printf -v "$var" '%s' "$default"
  else
    read -rp "$prompt: " "$var" <"$TTY"
  fi
}

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log()     { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
error()   { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${BLUE}━━━${NC} $*"; }

require_root() {
  [[ $EUID -eq 0 ]] || error "Запустите от root: sudo bash install.sh"
}

# ─── Определение ОС ──────────────────────────────────────────────────────────

detect_os() {
  if [[ -f /etc/os-release ]]; then
    . /etc/os-release
    OS=$ID
    OS_VERSION=$VERSION_ID
  else
    error "Не удалось определить ОС. Поддерживается Ubuntu 22.04+"
  fi

  if [[ "$OS" != "ubuntu" ]] && [[ "$OS" != "debian" ]]; then
    warn "Протестировано на Ubuntu 22.04+. Текущая ОС: $OS $OS_VERSION"
  fi
}

# ─── Node.js ─────────────────────────────────────────────────────────────────

install_nodejs() {
  if command -v node &>/dev/null; then
    local version
    version=$(node --version | sed 's/v//' | cut -d. -f1)
    if (( version >= 20 )); then
      log "Node.js $(node --version) уже установлен"
      return
    fi
    warn "Node.js $(node --version) слишком старый. Обновляю..."
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
  log "xray установлен: $(xray version | head -1)"
}

# ─── Генерация конфига xray с нуля ───────────────────────────────────────────

generate_xray_config() {
  local server_ip="$1"
  local port="${2:-443}"
  local sni="${3:-www.microsoft.com}"

  step "Генерация xray конфига (VLESS+REALITY+TCP+gRPC Stats)"

  # Генерируем keypair
  local keypair
  keypair=$(xray x25519)
  local private_key
  private_key=$(echo "$keypair" | grep 'Private key' | awk '{print $NF}')
  local public_key
  public_key=$(echo "$keypair" | grep 'Public key' | awk '{print $NF}')

  local short_id
  short_id=$(openssl rand -hex 8)

  mkdir -p /usr/local/etc/xray

  cat > /usr/local/etc/xray/config.json <<EOF
{
  "log": {
    "loglevel": "warning",
    "access": "/var/log/xray/access.log",
    "error": "/var/log/xray/error.log"
  },
  "stats": {},
  "api": {
    "tag": "api",
    "services": ["StatsService"]
  },
  "policy": {
    "levels": {
      "0": {
        "statsUserUplink": true,
        "statsUserDownlink": true
      }
    },
    "system": {
      "statsInboundUplink": true,
      "statsInboundDownlink": true,
      "statsOutboundUplink": true,
      "statsOutboundDownlink": true
    }
  },
  "inbounds": [
    {
      "tag": "vless-in",
      "listen": "0.0.0.0",
      "port": ${port},
      "protocol": "vless",
      "settings": {
        "clients": [],
        "decryption": "none"
      },
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
      "sniffing": {
        "enabled": true,
        "destOverride": ["http", "tls"]
      }
    },
    {
      "tag": "api-in",
      "listen": "127.0.0.1",
      "port": 10085,
      "protocol": "dokodemo-door",
      "settings": {
        "address": "127.0.0.1"
      }
    }
  ],
  "outbounds": [
    {
      "tag": "direct",
      "protocol": "freedom",
      "settings": {}
    },
    {
      "tag": "blocked",
      "protocol": "blackhole",
      "settings": {}
    }
  ],
  "routing": {
    "domainStrategy": "IPIfNonMatch",
    "rules": [
      {
        "type": "field",
        "inboundTag": ["api-in"],
        "outboundTag": "api"
      },
      {
        "type": "field",
        "ip": ["geoip:ru", "geoip:cn", "geoip:by"],
        "outboundTag": "blocked"
      },
      {
        "type": "field",
        "domain": ["geosite:category-ads-all"],
        "outboundTag": "blocked"
      },
      {
        "type": "field",
        "protocol": ["bittorrent"],
        "outboundTag": "blocked"
      }
    ]
  }
}
EOF

  mkdir -p /var/log/xray
  log "Конфиг сгенерирован"
  echo "Public key: ${public_key}"
  echo "Short ID:   ${short_id}"
}

# ─── Патч существующего конфига для Stats API ─────────────────────────────────

patch_xray_config_for_stats() {
  local config="/usr/local/etc/xray/config.json"
  [[ -f "$config" ]] || error "Конфиг xray не найден: $config"

  step "Добавление Stats API в конфиг xray"

  # Проверяем, не добавлен ли уже stats
  if jq -e '.stats' "$config" &>/dev/null; then
    log "Stats API уже настроен"
    return
  fi

  local tmp
  tmp=$(mktemp)

  jq '
    . +
    {
      "stats": {},
      "api": { "tag": "api", "services": ["StatsService"] },
      "policy": {
        "levels": { "0": { "statsUserUplink": true, "statsUserDownlink": true } },
        "system": {
          "statsInboundUplink": true,
          "statsInboundDownlink": true,
          "statsOutboundUplink": true,
          "statsOutboundDownlink": true
        }
      }
    }
    | .inbounds += [{
        "tag": "api-in",
        "listen": "127.0.0.1",
        "port": 10085,
        "protocol": "dokodemo-door",
        "settings": { "address": "127.0.0.1" }
      }]
    | .routing.rules = ([{
        "type": "field",
        "inboundTag": ["api-in"],
        "outboundTag": "api"
      }] + (.routing.rules // []))
  ' "$config" > "$tmp"

  cp "$tmp" "$config"
  rm "$tmp"
  log "Stats API добавлен в конфиг"
}

# ─── Установка xray-mgr ───────────────────────────────────────────────────────

XRAY_MGR_URL="https://raw.githubusercontent.com/RazZrus/tg-xray-manager/main/scripts/xray-mgr.sh"

install_xray_mgr() {
  step "Установка xray-mgr"

  apt-get install -y jq qrencode bc curl

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  if [[ -f "${script_dir}/xray-mgr.sh" ]]; then
    # Запуск из клонированного репо — берём локальный файл
    cp "${script_dir}/xray-mgr.sh" /usr/local/bin/xray-mgr
  else
    # Запуск через curl — скачиваем напрямую с GitHub
    curl -fsSL "$XRAY_MGR_URL" -o /usr/local/bin/xray-mgr
  fi

  chmod +x /usr/local/bin/xray-mgr
  log "xray-mgr установлен в /usr/local/bin/xray-mgr"
}

# ─── Установка бота ───────────────────────────────────────────────────────────

REPO_URL="https://github.com/RazZrus/tg-xray-manager.git"
INSTALL_DIR="/opt/tg-xray-bot"

install_bot() {
  step "Установка tg-xray-bot из GitHub"

  if command -v git &>/dev/null; then
    : # ok
  else
    apt-get install -y git
  fi

  if [[ -d "$INSTALL_DIR/.git" ]]; then
    warn "Директория $INSTALL_DIR уже существует — обновляю"
    cd "$INSTALL_DIR"
    git pull origin main
  else
    git clone "$REPO_URL" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi

  npm install --omit=dev
  npm run build
  npm link

  log "tg-xray-bot установлен в $INSTALL_DIR"
}

# ─── PM2 ─────────────────────────────────────────────────────────────────────

setup_pm2() {
  step "Настройка PM2"

  if ! command -v pm2 &>/dev/null; then
    npm install -g pm2
  fi

  log "PM2 $(pm2 --version) готов"
}

# ─── Меню выбора режима ───────────────────────────────────────────────────────

main() {
  require_root
  detect_os

  echo ""
  echo "╔══════════════════════════════════════╗"
  echo "║        tg-xray-bot installer         ║"
  echo "╚══════════════════════════════════════╝"
  echo ""
  echo "Выберите режим установки:"
  echo ""
  echo "  [A] Только бот + xray-mgr (xray уже установлен)"
  echo "  [B] Полная установка с нуля (xray + бот + xray-mgr)"
  echo ""
  ask "Режим [A/B]" mode
  mode=$(echo "$mode" | tr '[:lower:]' '[:upper:]')

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
      ask "Внешний IP сервера" server_ip "$auto_ip"
      ask "Порт xray" xray_port "443"
      ask "SNI (домен для маскировки)" sni "www.microsoft.com"

      install_nodejs
      install_xray
      generate_xray_config "$server_ip" "$xray_port" "$sni"
      systemctl enable --now xray
      install_xray_mgr
      setup_pm2
      install_bot
      ;;
    *)
      error "Неверный выбор. Введите A или B."
      ;;
  esac

  echo ""
  log "Установка завершена!"
  echo ""
  echo "Следующие шаги:"
  echo ""
  echo "  Первый запуск:   tg-xray-bot"
  echo "  (бот запросит токен и настройки, после чего стартует через PM2)"
  echo ""
  echo "Обновление:   bash ${INSTALL_DIR}/scripts/update.sh"
  echo "Удаление:     bash ${INSTALL_DIR}/scripts/uninstall.sh"
  echo ""
}

main "$@"
