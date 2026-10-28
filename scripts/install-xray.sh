#!/usr/bin/env bash
# install-xray.sh — standalone xray-core installer
#
# One-line install:
#   bash <(curl -fsSL https://raw.githubusercontent.com/RazZrus/tg-xray-manager/main/scripts/install-xray.sh)
set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ─── UI helpers ───────────────────────────────────────────────────────────────
log()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }
step()  { echo -e "\n${BLUE}━━━${NC} $*"; }

# prompt_input <var> <label> <default>  — Enter accepts default
prompt_input() {
  local _var="$1" label="$2" default="${3:-}"
  local value
  if [[ -n "$default" ]]; then
    printf '  %b%s%b %b[%s]%b: ' "$BOLD" "$label" "$NC" "$DIM" "$default" "$NC" >/dev/tty
  else
    printf '  %b%s%b: ' "$BOLD" "$label" "$NC" >/dev/tty
  fi
  IFS= read -r value </dev/tty
  value="${value:-$default}"
  eval "$_var=\$value"
}

# confirm <msg> → 0=yes / 1=no
confirm() {
  local msg="$1" reply
  printf '  %s %b[y/N]%b: ' "$msg" "$DIM" "$NC" >/dev/tty
  IFS= read -rn1 reply </dev/tty
  echo "" >/dev/tty
  [[ "${reply,,}" == "y" ]]
}

# select_multi <var> <defaults> <title> <item1> <item2> ...
# defaults: space-separated 0-based indices to pre-select, e.g. "0 1"
# On return, var contains space-separated selected indices, e.g. "0 1 3"
select_multi() {
  local _var="$1" defaults="$2" title="$3"; shift 3
  local options=("$@")
  local count=${#options[@]}
  local current=0
  local -a sel=()

  for i in "${!options[@]}"; do sel[$i]=0; done
  for d in $defaults; do
    [[ -n "$d" ]] && sel[$d]=1
  done

  printf '\e[?25l' >/dev/tty
  trap 'printf "\e[?25h" >/dev/tty' RETURN

  _multi_render() {
    for i in "${!options[@]}"; do
      local box=" "
      if (( sel[i] )); then box="x"; fi
      if (( i == current )); then
        printf '  %b❯ [%s] %s%b\n' "$CYAN" "$box" "${options[$i]}" "$NC" >/dev/tty
      else
        printf '    [%s] %b%s%b\n' "$box" "$DIM" "${options[$i]}" "$NC" >/dev/tty
      fi
    done
  }

  printf '\n  %b%s%b  %b(↑↓ navigate  Space toggle  Enter confirm)%b\n\n' \
    "$BOLD" "$title" "$NC" "$DIM" "$NC" >/dev/tty
  _multi_render

  while true; do
    local key rest
    IFS= read -rsn1 key </dev/tty || true
    if [[ "$key" == $'\x1b' ]]; then
      IFS= read -rsn2 -t 0.1 rest </dev/tty || true
      key+="${rest:-}"
    fi

    case "$key" in
      $'\x1b[A'|k)
        if (( current > 0 )); then current=$(( current - 1 )); fi
        ;;
      $'\x1b[B'|j)
        if (( current < count - 1 )); then current=$(( current + 1 )); fi
        ;;
      ' ')
        if (( sel[current] )); then sel[$current]=0; else sel[$current]=1; fi
        ;;
      '') break ;;
      *) continue ;;
    esac

    printf '\e[%dA' "$count" >/dev/tty
    for i in "${!options[@]}"; do
      printf '\r\e[2K' >/dev/tty
      local box=" "
      if (( sel[i] )); then box="x"; fi
      if (( i == current )); then
        printf '  %b❯ [%s] %s%b\n' "$CYAN" "$box" "${options[$i]}" "$NC" >/dev/tty
      else
        printf '    [%s] %b%s%b\n' "$box" "$DIM" "${options[$i]}" "$NC" >/dev/tty
      fi
    done
  done

  echo "" >/dev/tty
  local result=""
  for i in "${!sel[@]}"; do
    if (( sel[i] )); then result+="$i "; fi
  done
  eval "$_var='${result% }'"
}

# has <haystack> <needle> — check if space-separated list contains value
# Usage: has "$selected" 2
has() { [[ " $1 " == *" $2 "* ]]; }

# ─── System ───────────────────────────────────────────────────────────────────

require_root() {
  [[ $EUID -eq 0 ]] || error "Run as root: sudo bash ..."
}

detect_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck source=/dev/null
    . /etc/os-release
  else
    error "Cannot detect OS"
  fi
  if [[ "${ID:-}" != "ubuntu" && "${ID:-}" != "debian" ]]; then
    warn "Tested on Ubuntu 22.04+. Current: ${ID:-unknown} ${VERSION_ID:-}"
  fi
}

install_deps() {
  step "Installing dependencies"
  apt-get update -qq
  apt-get install -y -qq jq curl openssl unzip qrencode bc
  log "Dependencies ready"
}

# ─── xray-core ────────────────────────────────────────────────────────────────

install_xray_core() {
  step "Installing xray-core"
  if command -v xray &>/dev/null && xray version &>/dev/null; then
    local ver
    ver=$(xray version | head -1)
    if confirm "xray is already installed (${ver}). Reinstall?"; then
      bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
    else
      log "Keeping existing xray — ${ver}"
      return
    fi
  else
    bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
  fi
  log "xray-core ready: $(xray version | head -1)"
}

# ─── Config builder ───────────────────────────────────────────────────────────

_build_reality_settings() {
  local private_key="$1" public_key="$2" short_id="$3" sni="$4"
  cat <<JSON
{
  "show": false,
  "dest": "${sni}:443",
  "xver": 0,
  "serverNames": ["${sni}"],
  "privateKey": "${private_key}",
  "publicKey": "${public_key}",
  "shortIds": ["${short_id}"]
}
JSON
}

build_inbound_tcp() {
  local private_key="$1" public_key="$2" short_id="$3" port="$4" sni="$5"
  local reality
  reality=$(_build_reality_settings "$private_key" "$public_key" "$short_id" "$sni")
  cat <<JSON
{
  "tag": "vless-reality",
  "listen": "0.0.0.0",
  "port": ${port},
  "protocol": "vless",
  "settings": { "clients": [], "decryption": "none" },
  "streamSettings": {
    "network": "tcp",
    "security": "reality",
    "realitySettings": ${reality}
  },
  "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
}
JSON
}

build_inbound_xhttp() {
  local private_key="$1" public_key="$2" short_id="$3" port="$4" sni="$5" path="$6"
  local reality
  reality=$(_build_reality_settings "$private_key" "$public_key" "$short_id" "$sni")
  cat <<JSON
{
  "tag": "vless-xhttp",
  "listen": "0.0.0.0",
  "port": ${port},
  "protocol": "vless",
  "settings": { "clients": [], "decryption": "none" },
  "streamSettings": {
    "network": "xhttp",
    "security": "reality",
    "realitySettings": ${reality},
    "xhttpSettings": { "path": "${path}", "mode": "auto" }
  },
  "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
}
JSON
}

build_inbound_grpc() {
  local private_key="$1" public_key="$2" short_id="$3" port="$4" sni="$5" svc_name="$6"
  local reality
  reality=$(_build_reality_settings "$private_key" "$public_key" "$short_id" "$sni")
  cat <<JSON
{
  "tag": "vless-grpc",
  "listen": "0.0.0.0",
  "port": ${port},
  "protocol": "vless",
  "settings": { "clients": [], "decryption": "none" },
  "streamSettings": {
    "network": "grpc",
    "security": "reality",
    "realitySettings": ${reality},
    "grpcSettings": { "serviceName": "${svc_name}" }
  },
  "sniffing": { "enabled": true, "destOverride": ["http", "tls", "quic"] }
}
JSON
}

generate_xray_config() {
  local inbounds_json="$1" stats_port="$2"
  mkdir -p /usr/local/etc/xray /var/log/xray

  jq -n \
    --argjson inbounds "$inbounds_json" \
    --argjson stats_port "$stats_port" \
    '{
      "log": {
        "loglevel": "warning",
        "access": "/var/log/xray/access.log",
        "error":  "/var/log/xray/error.log"
      },
      "stats": {},
      "api": {
        "tag": "api",
        "services": ["StatsService", "HandlerService"]
      },
      "policy": {
        "levels": {
          "0": { "statsUserUplink": true, "statsUserDownlink": true }
        },
        "system": {
          "statsInboundUplink":   true,
          "statsInboundDownlink": true
        }
      },
      "inbounds": ([{
        "tag":      "api",
        "listen":   "127.0.0.1",
        "port":     $stats_port,
        "protocol": "dokodemo-door",
        "settings": { "address": "127.0.0.1" }
      }] + $inbounds),
      "outbounds": [
        { "tag": "direct", "protocol": "freedom",   "settings": {} },
        { "tag": "block",  "protocol": "blackhole",  "settings": {} }
      ],
      "routing": {
        "domainStrategy": "IPIfNonMatch",
        "rules": [
          {
            "type": "field",
            "inboundTag": ["api"],
            "outboundTag": "api"
          },
          {
            "type": "field",
            "domain": [
              "geosite:tld-ru",
              "geosite:tld-cn",
              "geosite:geolocation-cn"
            ],
            "outboundTag": "block"
          },
          {
            "type": "field",
            "ip": ["geoip:ru", "geoip:cn", "geoip:by"],
            "outboundTag": "block"
          },
          {
            "type": "field",
            "domain": ["geosite:category-ads-all"],
            "outboundTag": "block"
          },
          {
            "type": "field",
            "protocol": ["bittorrent"],
            "outboundTag": "block"
          }
        ]
      }
    }' > /usr/local/etc/xray/config.json

  log "Config written → /usr/local/etc/xray/config.json"
}

# ─── Hysteria2 ────────────────────────────────────────────────────────────────

HYSTERIA_BIN="/usr/local/bin/hysteria2"
BACKUP_FILE="/etc/xray-backup.json"

install_hysteria() {
  step "Installing Hysteria2"
  local arch
  arch=$(uname -m)
  case "$arch" in
    x86_64)  arch="amd64" ;;
    aarch64) arch="arm64" ;;
    armv7l)  arch="arm"   ;;
    *)       error "Unsupported architecture: $arch" ;;
  esac

  local tag
  tag=$(curl -fsSL https://api.github.com/repos/apernet/hysteria/releases/latest \
    | grep '"tag_name"' | head -1 | cut -d'"' -f4)
  [[ -z "$tag" ]] && error "Could not fetch Hysteria2 release tag"

  local url="https://github.com/apernet/hysteria/releases/download/${tag}/hysteria-linux-${arch}"
  curl -fsSL "$url" -o "$HYSTERIA_BIN"
  chmod +x "$HYSTERIA_BIN"
  log "Hysteria2 ${tag} installed → ${HYSTERIA_BIN}"
}

generate_hysteria_config() {
  local port="$1" password="$2" sni="$3"
  mkdir -p /etc/hysteria

  openssl req -x509 \
    -newkey ec -pkeyopt ec_paramgen_curve:P-256 \
    -keyout /etc/hysteria/server.key \
    -out    /etc/hysteria/server.crt \
    -days   3650 \
    -nodes \
    -subj   "/CN=${sni}" 2>/dev/null
  chmod 600 /etc/hysteria/server.key

  cat > /etc/hysteria/config.yaml <<YAML
listen: ":${port}"

tls:
  cert: /etc/hysteria/server.crt
  key:  /etc/hysteria/server.key

auth:
  type: password
  password: "${password}"

masquerade:
  type: proxy
  proxy:
    url: "https://${sni}"
    rewriteHost: true
YAML

  log "Hysteria2 config written → /etc/hysteria/config.yaml"
}

setup_hysteria_systemd() {
  cat > /etc/systemd/system/hysteria.service <<UNIT
[Unit]
Description=Hysteria2 VPN Server
After=network.target

[Service]
Type=simple
ExecStart=${HYSTERIA_BIN} server --config /etc/hysteria/config.yaml
Restart=on-failure
RestartSec=5
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable --now hysteria
  log "Hysteria2 service enabled and started"
}

# ─── Backup / Restore ─────────────────────────────────────────────────────────

# backup_xray_config — saves keys + users from current config to BACKUP_FILE
backup_xray_config() {
  local config="/usr/local/etc/xray/config.json"
  [[ -f "$config" ]] || return 0

  local private_key
  private_key=$(jq -r '
    [.inbounds[] | select(.protocol == "vless" and .tag != "api")][0]
    .streamSettings.realitySettings.privateKey // ""
  ' "$config")

  [[ -z "$private_key" ]] && { warn "No REALITY config found, skipping backup"; return 0; }

  # Read publicKey from config (set by this installer); fall back to derivation
  local public_key
  public_key=$(jq -r '
    [.inbounds[] | select(.protocol == "vless" and .tag != "api")][0]
    .streamSettings.realitySettings.publicKey // ""
  ' "$config")

  if [[ -z "$public_key" ]]; then
    public_key=$(xray x25519 -i "$private_key" 2>/dev/null \
      | grep 'Public key' | awk '{print $NF}' || echo "")
  fi

  local short_id
  short_id=$(jq -r '
    [.inbounds[] | select(.protocol == "vless" and .tag != "api")][0]
    .streamSettings.realitySettings.shortIds[0] // ""
  ' "$config")

  # Collect all users across all VLESS inbounds, deduplicated by UUID
  local users_json
  users_json=$(jq '[
    .inbounds[] |
    select(.protocol == "vless" and .tag != "api") |
    .settings.clients[]? |
    { name: .email, uuid: .id }
  ] | unique_by(.uuid)' "$config")

  local server_ip port sni stats_port
  server_ip=$(curl -fsSL --max-time 3 https://api.ipify.org 2>/dev/null \
    || hostname -I | awk '{print $1}')
  port=$(jq -r '([.inbounds[] | select(.tag == "vless-tcp")][0].port // 443)' "$config")
  sni=$(jq -r '
    [.inbounds[] | select(.protocol == "vless" and .tag != "api")][0]
    .streamSettings.realitySettings.serverNames[0] // "www.microsoft.com"
  ' "$config")
  stats_port=$(jq -r '([.inbounds[] | select(.tag == "api")][0].port // 10085)' "$config")

  jq -n \
    --arg  created_at   "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg  private_key  "$private_key" \
    --arg  public_key   "$public_key" \
    --arg  short_id     "$short_id" \
    --argjson users     "$users_json" \
    --arg  server_ip    "$server_ip" \
    --argjson port      "$port" \
    --arg  sni          "$sni" \
    --argjson stats_port "$stats_port" \
    '{
      created_at: $created_at,
      reality: {
        private_key: $private_key,
        public_key:  $public_key,
        short_ids:   [$short_id]
      },
      users:  $users,
      server: {
        ip:         $server_ip,
        port:       $port,
        sni:        $sni,
        stats_port: $stats_port
      }
    }' > "$BACKUP_FILE"

  chmod 600 "$BACKUP_FILE"
  local user_count
  user_count=$(echo "$users_json" | jq 'length')
  log "Backup saved → ${BACKUP_FILE} (${user_count} users)"
}

# restore_users <users_json>
# Adds users to every VLESS inbound in the current config.
# TCP inbound: flow=xtls-rprx-vision; xHTTP/gRPC: no flow.
restore_users() {
  local users_json="$1"
  local config="/usr/local/etc/xray/config.json"

  local user_count
  user_count=$(echo "$users_json" | jq 'length')
  if (( user_count == 0 )); then
    warn "Backup has no users — nothing to restore"
    return
  fi

  local tmp
  tmp=$(mktemp)

  jq --argjson users "$users_json" '
    .inbounds |= map(
      if .protocol == "vless" and .tag != "api" then
        . as $inbound |
        .settings.clients = (
          $users | map(
            if $inbound.tag == "vless-tcp" then
              { id: .uuid, email: .name, flow: "xtls-rprx-vision" }
            else
              { id: .uuid, email: .name }
            end
          )
        )
      else .
      end
    )
  ' "$config" > "$tmp"

  mv "$tmp" "$config"
  log "Restored ${user_count} users from backup"
}

# ─── Summary ──────────────────────────────────────────────────────────────────

print_summary() {
  local server_ip="$1"  public_key="$2"   short_id="$3"   sni="$4"
  local selected="$5"   tcp_port="$6"     xhttp_port="$7" xhttp_path="$8"
  local grpc_port="$9"  grpc_svc="${10}"  h2_port="${11}" h2_pass="${12}"

  echo ""
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BOLD}  xray installed successfully${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""
  echo -e "  ${DIM}Public key${NC}  ${BOLD}${public_key}${NC}"
  echo -e "  ${DIM}Short ID  ${NC}  ${BOLD}${short_id}${NC}"
  echo -e "  ${DIM}SNI       ${NC}  ${sni}"
  echo ""
  echo -e "  ${BOLD}Inbounds:${NC}"
  if has "$selected" 0; then
    echo -e "    ${CYAN}TCP${NC}    → ${server_ip}:${tcp_port}"
  fi
  if has "$selected" 1; then
    echo -e "    ${CYAN}xHTTP${NC}  → ${server_ip}:${xhttp_port}${xhttp_path}"
  fi
  if has "$selected" 2; then
    echo -e "    ${CYAN}gRPC${NC}   → ${server_ip}:${grpc_port}  (service: ${grpc_svc})"
  fi
  if has "$selected" 3; then
    echo -e "    ${CYAN}H2${NC}     → ${server_ip}:${h2_port} UDP  (password: ${h2_pass})"
  fi
  echo ""
  echo -e "  ${DIM}Stats API${NC}  127.0.0.1:10085"
  echo -e "  ${DIM}Logs${NC}       /var/log/xray/access.log"
  echo ""
  echo -e "  ${DIM}Next: install xray-mgr to manage users${NC}"
  echo -e "  ${DIM}  bash <(curl -fsSL .../scripts/install-xray-mgr.sh)${NC}"
  echo ""
}

# ─── main ─────────────────────────────────────────────────────────────────────

main() {
  require_root
  detect_os

  echo ""
  echo -e "${BOLD}  xray-core installer${NC}"
  echo -e "${DIM}  VLESS+REALITY · Hysteria2${NC}"
  echo ""

  # ── Auto-backup before overwriting existing installation ───────────────────
  if [[ -f /usr/local/etc/xray/config.json ]]; then
    step "Existing installation detected — backing up"
    backup_xray_config
  fi

  # ── Server params ──────────────────────────────────────────────────────────
  step "Server"
  local auto_ip
  auto_ip=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null \
    || hostname -I | awk '{print $1}')

  # Use backup values as defaults when available
  local default_port="443" default_sni="www.microsoft.com" default_stats_port="10085"
  if [[ -f "$BACKUP_FILE" ]]; then
    default_port=$(jq -r '.server.port // 443' "$BACKUP_FILE")
    default_sni=$(jq -r '.server.sni // "www.microsoft.com"' "$BACKUP_FILE")
    default_stats_port=$(jq -r '.server.stats_port // 10085' "$BACKUP_FILE")
  fi

  local server_ip main_port sni stats_port
  prompt_input server_ip  "Public IP"      "$auto_ip"
  prompt_input main_port  "Main port"      "$default_port"
  prompt_input sni        "SNI domain"     "$default_sni"
  prompt_input stats_port "Stats API port" "$default_stats_port"

  # ── Protocol selection ─────────────────────────────────────────────────────
  local selected
  select_multi selected "0 1" "Protocols" \
    "VLESS+REALITY TCP   (port ${main_port}, recommended)" \
    "VLESS+REALITY xHTTP (default port 8443)" \
    "VLESS+REALITY gRPC  (default port 8444)" \
    "Hysteria2           (UDP, default port 443)"

  [[ -z "${selected:-}" ]] && error "No protocols selected"

  # ── Per-protocol params ────────────────────────────────────────────────────
  local xhttp_port="" xhttp_path="" grpc_port="" grpc_svc="" h2_port="" h2_pass=""

  if has "$selected" 1; then
    step "xHTTP"
    prompt_input xhttp_port "Port" "8443"
    prompt_input xhttp_path "Path" "/xhttp"
  fi

  if has "$selected" 2; then
    step "gRPC"
    prompt_input grpc_port "Port"         "8444"
    prompt_input grpc_svc  "Service name" "grpc"
  fi

  if has "$selected" 3; then
    step "Hysteria2"
    prompt_input h2_port "UDP port" "443"
    local auto_pass
    auto_pass=$(openssl rand -hex 16)
    prompt_input h2_pass "Password (Enter = auto-generate)" "$auto_pass"
  fi

  # ── Install deps + xray ────────────────────────────────────────────────────
  install_deps
  install_xray_core

  # ── Keys: restore from backup or generate fresh ────────────────────────────
  local use_backup=false
  local private_key="" public_key="" short_id=""

  if [[ -f "$BACKUP_FILE" ]]; then
    local _bdate _bcount
    _bdate=$(jq -r '.created_at // "unknown date"' "$BACKUP_FILE")
    _bcount=$(jq '.users | length' "$BACKUP_FILE")
    step "Backup found"
    echo -e "  ${DIM}Date   :${NC} ${_bdate}"
    echo -e "  ${DIM}Users  :${NC} ${_bcount}"
    echo ""
    if confirm "Restore existing keys and users from backup?"; then
      use_backup=true
      private_key=$(jq -r '.reality.private_key' "$BACKUP_FILE")
      public_key=$(jq -r  '.reality.public_key'  "$BACKUP_FILE")
      short_id=$(jq -r    '.reality.short_ids[0]' "$BACKUP_FILE")
      log "Using keys from backup — user links will remain valid"
    fi
  fi

  if ! $use_backup; then
    step "Generating REALITY keys"
    local keypair
    keypair=$(xray x25519)
    private_key=$(echo "$keypair" | grep 'Private key' | awk '{print $NF}')
    public_key=$(echo "$keypair"  | grep 'Public key'  | awk '{print $NF}')
    short_id=$(openssl rand -hex 8)
    log "Keys generated"
  fi

  # ── Build inbounds ─────────────────────────────────────────────────────────
  step "Building config"
  local inbounds="[]"

  if has "$selected" 0; then
    local tcp_ib
    tcp_ib=$(build_inbound_tcp "$private_key" "$public_key" "$short_id" "$main_port" "$sni")
    inbounds=$(echo "$inbounds" | jq --argjson ib "$tcp_ib" '. + [$ib]')
  fi

  if has "$selected" 1; then
    local xhttp_ib
    xhttp_ib=$(build_inbound_xhttp "$private_key" "$public_key" "$short_id" "$xhttp_port" "$sni" "$xhttp_path")
    inbounds=$(echo "$inbounds" | jq --argjson ib "$xhttp_ib" '. + [$ib]')
  fi

  if has "$selected" 2; then
    local grpc_ib
    grpc_ib=$(build_inbound_grpc "$private_key" "$public_key" "$short_id" "$grpc_port" "$sni" "$grpc_svc")
    inbounds=$(echo "$inbounds" | jq --argjson ib "$grpc_ib" '. + [$ib]')
  fi

  generate_xray_config "$inbounds" "$stats_port"

  # ── Restore users from backup (after config is written) ────────────────────
  if $use_backup; then
    step "Restoring users"
    restore_users "$(jq '.users' "$BACKUP_FILE")"
  fi

  # ── Hysteria2 ──────────────────────────────────────────────────────────────
  if has "$selected" 3; then
    install_hysteria
    generate_hysteria_config "$h2_port" "$h2_pass" "$sni"
    setup_hysteria_systemd
  fi

  # ── Start xray ─────────────────────────────────────────────────────────────
  step "Starting xray"
  systemctl enable xray
  if xray -test -c /usr/local/etc/xray/config.json 2>/dev/null; then
    log "Config OK"
  else
    warn "Config test failed — check /usr/local/etc/xray/config.json"
  fi
  systemctl restart xray
  log "xray running"

  # ── Summary ────────────────────────────────────────────────────────────────
  print_summary \
    "$server_ip" "$public_key" "$short_id" "$sni" "$selected" \
    "$main_port" "$xhttp_port" "$xhttp_path" \
    "$grpc_port" "$grpc_svc" "$h2_port" "$h2_pass"
}

main "$@"
