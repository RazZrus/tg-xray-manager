#!/usr/bin/env bash
# uninstall-xray.sh — remove xray-core and Hysteria2
#
# Optionally saves a backup so users can be restored on reinstall.
set -euo pipefail

# ─── Colors / helpers ─────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

log()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
error() { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }
step()  { echo -e "\n${BLUE}━━━${NC} $*"; }

confirm() {
  local msg="$1" reply
  printf '  %s %b[y/N]%b: ' "$msg" "$DIM" "$NC" >/dev/tty
  IFS= read -rn1 reply </dev/tty
  echo "" >/dev/tty
  [[ "${reply,,}" == "y" ]]
}

require_root() {
  [[ $EUID -eq 0 ]] || error "Run as root: sudo bash ..."
}

# ─── Backup ───────────────────────────────────────────────────────────────────

BACKUP_FILE="/etc/xray-backup.json"
XRAY_CONFIG="/usr/local/etc/xray/config.json"

backup_xray_config() {
  [[ -f "$XRAY_CONFIG" ]] || { warn "No xray config found, skipping backup"; return 0; }

  local private_key
  private_key=$(jq -r '
    [.inbounds[] | select(.protocol == "vless" and .tag != "api")][0]
    .streamSettings.realitySettings.privateKey // ""
  ' "$XRAY_CONFIG")

  [[ -z "$private_key" ]] && { warn "No REALITY config found, skipping backup"; return 0; }

  local public_key
  public_key=$(jq -r '
    [.inbounds[] | select(.protocol == "vless" and .tag != "api")][0]
    .streamSettings.realitySettings.publicKey // ""
  ' "$XRAY_CONFIG")

  # Derive public key if not stored in config
  if [[ -z "$public_key" ]] && command -v xray &>/dev/null; then
    public_key=$(xray x25519 -i "$private_key" 2>/dev/null \
      | grep 'Public key' | awk '{print $NF}' || echo "")
  fi

  local short_id
  short_id=$(jq -r '
    [.inbounds[] | select(.protocol == "vless" and .tag != "api")][0]
    .streamSettings.realitySettings.shortIds[0] // ""
  ' "$XRAY_CONFIG")

  local users_json
  users_json=$(jq '[
    .inbounds[] |
    select(.protocol == "vless" and .tag != "api") |
    .settings.clients[]? |
    { name: .email, uuid: .id }
  ] | unique_by(.uuid)' "$XRAY_CONFIG")

  local server_ip port sni stats_port
  server_ip=$(curl -fsSL --max-time 3 https://api.ipify.org 2>/dev/null \
    || hostname -I | awk '{print $1}')
  port=$(jq -r '([.inbounds[] | select(.tag == "vless-tcp")][0].port // 443)' "$XRAY_CONFIG")
  sni=$(jq -r '
    [.inbounds[] | select(.protocol == "vless" and .tag != "api")][0]
    .streamSettings.realitySettings.serverNames[0] // "www.microsoft.com"
  ' "$XRAY_CONFIG")
  stats_port=$(jq -r '([.inbounds[] | select(.tag == "api")][0].port // 10085)' "$XRAY_CONFIG")

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

# ─── main ─────────────────────────────────────────────────────────────────────

main() {
  require_root

  local has_xray=false has_hysteria=false
  [[ -f /usr/local/bin/xray ]]     && has_xray=true
  [[ -f /usr/local/bin/hysteria2 ]] && has_hysteria=true

  if ! $has_xray && ! $has_hysteria; then
    warn "Neither xray nor Hysteria2 found — nothing to remove"
    exit 0
  fi

  echo ""
  echo -e "${BOLD}  xray uninstaller${NC}"
  echo ""
  echo "  Will be removed:"
  $has_xray     && echo "    • xray-core binary, config, logs, systemd service"
  $has_hysteria && echo "    • Hysteria2 binary, config (/etc/hysteria/), systemd service"
  echo ""

  # ── Offer backup ────────────────────────────────────────────────────────────
  if $has_xray && [[ -f "$XRAY_CONFIG" ]]; then
    local user_count
    user_count=$(jq '[
      .inbounds[] |
      select(.protocol == "vless" and .tag != "api") |
      .settings.clients[]?
    ] | unique_by(.id) | length' "$XRAY_CONFIG" 2>/dev/null || echo "0")

    echo -e "  ${DIM}Current users: ${user_count}${NC}"
    echo ""

    if confirm "Save keys and users to backup before removing?"; then
      step "Saving backup"
      backup_xray_config
    fi
  fi

  echo ""
  confirm "Continue with removal?" || { echo "Cancelled."; exit 0; }

  # ── Remove xray ─────────────────────────────────────────────────────────────
  if $has_xray; then
    step "Removing xray"
    systemctl stop xray 2>/dev/null || true
    systemctl disable xray 2>/dev/null || true
    bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" \
      @ remove --purge
    log "xray removed"
  fi

  # ── Remove Hysteria2 ────────────────────────────────────────────────────────
  if $has_hysteria; then
    step "Removing Hysteria2"
    systemctl stop    hysteria 2>/dev/null || true
    systemctl disable hysteria 2>/dev/null || true
    rm -f /etc/systemd/system/hysteria.service
    rm -f /usr/local/bin/hysteria2
    rm -rf /etc/hysteria
    systemctl daemon-reload
    log "Hysteria2 removed"
  fi

  # ── Summary ─────────────────────────────────────────────────────────────────
  echo ""
  log "Removal complete"

  if [[ -f "$BACKUP_FILE" ]]; then
    echo ""
    echo -e "  ${DIM}Backup saved at:${NC} ${BACKUP_FILE}"
    echo -e "  ${DIM}To reinstall and restore users:${NC}"
    echo -e "  ${DIM}  bash <(curl -fsSL .../scripts/install-xray.sh)${NC}"
  fi

  echo ""
}

main "$@"
