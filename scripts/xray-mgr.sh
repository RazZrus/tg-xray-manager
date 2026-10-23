#!/usr/bin/env bash
# xray-mgr — manage xray VLESS+REALITY users
set -euo pipefail

XRAY_CONFIG="/usr/local/etc/xray/config.json"
XRAY_BIN="/usr/local/bin/xray"
STATS_PORT="${XRAY_STATS_PORT:-10085}"

# ─── Utilities ──────────────────────────────────────────────────────────────

die() { echo "ERROR: $*" >&2; exit 1; }

require_root() {
  [[ $EUID -eq 0 ]] || die "This command requires root (sudo xray-mgr ...)"
}

require_jq() {
  command -v jq &>/dev/null || die "Install jq: apt-get install -y jq"
}

require_qrencode() {
  command -v qrencode &>/dev/null || die "Install qrencode: apt-get install -y qrencode"
}

require_grpcurl() {
  command -v grpcurl &>/dev/null || {
    echo "grpcurl not found, installing..." >&2
    local ARCH
    ARCH=$(uname -m)
    local TAG
    TAG=$(curl -s https://api.github.com/repos/fullstorydev/grpcurl/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
    local FILE="grpcurl_${TAG#v}_linux_${ARCH}.tar.gz"
    curl -fsSL "https://github.com/fullstorydev/grpcurl/releases/download/${TAG}/${FILE}" | tar -xz -C /usr/local/bin grpcurl
  }
}

# Get value from xray config by jq path
cfg() { jq -r "$1" "$XRAY_CONFIG"; }

# jq path to vless inbound (not api-in)
VLESS='([.inbounds[] | select(.protocol == "vless")] | first)'

# Get IP/port for vless link
get_server_ip() {
  curl -s --max-time 3 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}'
}

get_xray_port() { cfg "${VLESS}.port // 443"; }
get_sni() { cfg "${VLESS}.streamSettings.realitySettings.serverNames[0] // \"www.microsoft.com\""; }
get_short_id() { cfg "${VLESS}.streamSettings.realitySettings.shortIds[0] // \"\""; }

# Find user by name, return UUID
get_uuid() {
  local name="$1"
  jq -r --arg n "$name" "${VLESS}.settings.clients[] | select(.email == \$n) | .id" "$XRAY_CONFIG"
}

# Build vless:// link
make_link() {
  local name="$1"
  local uuid
  uuid=$(get_uuid "$name")
  [[ -n "$uuid" ]] || die "User '$name' not found"

  local ip port sni short_id public_key
  ip=$(get_server_ip)
  port=$(get_xray_port)
  sni=$(get_sni)
  short_id=$(get_short_id)
  public_key=$(cfg "${VLESS}.streamSettings.realitySettings.publicKey // empty")

  echo "vless://${uuid}@${ip}:${port}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${sni}&fp=chrome&pbk=${public_key}&sid=${short_id}&type=tcp&headerType=none#${name}"
}

# ─── Stats API (gRPC) ───────────────────────────────────────────────────────

# Query Stats API via grpcurl
PROTO_DIR="/opt/tg-xray-manager/proto"

stats_query() {
  local pattern="$1"
  grpcurl -plaintext \
    -import-path "$PROTO_DIR" -proto stats.proto \
    -d "{\"pattern\": \"${pattern}\", \"reset\": false}" \
    "127.0.0.1:${STATS_PORT}" \
    xray.app.stats.command.StatsService/QueryStats 2>/dev/null || echo '{}'
}

# Get user traffic (upload + download in bytes)
get_user_traffic() {
  local name="$1"
  local result
  result=$(stats_query "user>>>$name>>>traffic")
  local up down
  up=$(echo "$result" | jq -r '[.stat[]? | select(.name | contains("uplink")) | .value // "0"] | first // "0"')
  down=$(echo "$result" | jq -r '[.stat[]? | select(.name | contains("downlink")) | .value // "0"] | first // "0"')
  echo "$up $down"
}

# Format bytes to human-readable
format_bytes() {
  local bytes="${1:-0}"
  # strip non-numeric chars (grpcurl may return a string)
  bytes=$(echo "$bytes" | tr -dc '0-9' || echo 0)
  bytes=${bytes:-0}
  if   (( bytes >= 1073741824 )); then printf "%.1f GB" "$(echo "scale=1; $bytes/1073741824" | bc)"
  elif (( bytes >= 1048576 ));    then printf "%.1f MB" "$(echo "scale=1; $bytes/1048576" | bc)"
  elif (( bytes >= 1024 ));       then printf "%.1f KB" "$(echo "scale=1; $bytes/1024" | bc)"
  else echo "${bytes} B"
  fi
}

# ─── Commands ───────────────────────────────────────────────────────────────

cmd_list() {
  require_jq
  require_grpcurl

  local names
  names=$(jq -r '[.inbounds[] | select(.protocol == "vless")] | first | .settings.clients[]?.email // empty' "$XRAY_CONFIG")

  if [[ -z "$names" ]]; then
    echo "No users found."
    return
  fi

  printf "%-20s %12s %12s\n" "USER" "UPLOAD" "DOWNLOAD"
  printf "%-20s %12s %12s\n" "----" "------" "--------"

  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    read -r up down <<< "$(get_user_traffic "$name")"
    printf "%-20s %12s %12s\n" "$name" "$(format_bytes "$up")" "$(format_bytes "$down")"
  done <<< "$names"
}

cmd_add() {
  require_root
  require_jq

  local name="$1"
  [[ -n "$name" ]] || die "Usage: xray-mgr add <name>"
  [[ "$name" =~ ^[a-zA-Z0-9_-]+$ ]] || die "Name must contain only letters, digits, _ and -"

  local existing
  existing=$(get_uuid "$name")
  [[ -z "$existing" ]] || die "User '$name' already exists"

  local uuid
  uuid=$($XRAY_BIN uuid)

  local tmp
  tmp=$(mktemp)
  jq --arg n "$name" --arg u "$uuid" \
    '(.inbounds[] | select(.protocol == "vless") | .settings.clients) += [{"id": $u, "email": $n, "flow": "xtls-rprx-vision"}]' \
    "$XRAY_CONFIG" > "$tmp"
  cp "$tmp" "$XRAY_CONFIG"
  rm "$tmp"

  systemctl restart xray

  echo "User '$name' created (UUID: $uuid)"
  make_link "$name"
}

cmd_del() {
  require_root
  require_jq

  local name="$1"
  [[ -n "$name" ]] || die "Usage: xray-mgr del <name>"

  local existing
  existing=$(get_uuid "$name")
  [[ -n "$existing" ]] || die "User '$name' not found"

  local tmp
  tmp=$(mktemp)
  jq --arg n "$name" \
    'del(.inbounds[] | select(.protocol == "vless") | .settings.clients[] | select(.email == $n))' \
    "$XRAY_CONFIG" > "$tmp"
  cp "$tmp" "$XRAY_CONFIG"
  rm "$tmp"

  systemctl restart xray
  echo "User '$name' deleted"
}

cmd_link() {
  require_jq
  local name="$1"
  [[ -n "$name" ]] || die "Usage: xray-mgr link <name>"
  make_link "$name"
}

cmd_qr() {
  require_jq
  require_qrencode
  local name="$1"
  [[ -n "$name" ]] || die "Usage: xray-mgr qr <name>"
  local link
  link=$(make_link "$name")
  echo "$link" | qrencode -t ANSIUTF8
  echo ""
  echo "$link"
}

cmd_stats() {
  require_jq
  require_grpcurl

  local name="$1"
  [[ -n "$name" ]] || die "Usage: xray-mgr stats <name>"

  local existing
  existing=$(get_uuid "$name")
  [[ -n "$existing" ]] || die "User '$name' not found"

  read -r up down <<< "$(get_user_traffic "$name")"
  echo "User: $name"
  echo "  Upload:    $(format_bytes "$up")"
  echo "  Download:  $(format_bytes "$down")"
  echo "  Total:     $(format_bytes "$(( ${up:-0} + ${down:-0} ))")"
}

cmd_blocked() {
  require_jq

  local user="${1:-}"
  local period="${2:-day}"

  local log_file
  log_file=$(cfg '.log.access // "/var/log/xray/access.log"')
  [[ -f "$log_file" ]] || {
    local since
    case "$period" in
      hour)  since="1 hour ago" ;;
      day)   since="1 day ago" ;;
      week)  since="1 week ago" ;;
      month) since="1 month ago" ;;
      year)  since="1 year ago" ;;
      *)     since="1 day ago" ;;
    esac

    echo "Blocked requests ($period):"
    if [[ -n "$user" ]]; then
      journalctl -u xray --since="$since" 2>/dev/null | grep -i "blocked\|reject" | grep "$user" | wc -l | xargs echo "  Count:"
    else
      journalctl -u xray --since="$since" 2>/dev/null | grep -i "blocked\|reject" | wc -l | xargs echo "  Total blocked:"
    fi
    return
  }

  echo "Blocked requests ($period) from $log_file:"
  if [[ -n "$user" ]]; then
    grep "rejected\|blocked" "$log_file" | grep "$user" | wc -l | xargs echo "  User $user:"
  else
    grep "rejected\|blocked" "$log_file" | wc -l | xargs echo "  Total:"
  fi
}

cmd_status() {
  systemctl status xray
}

cmd_restart() {
  require_root
  systemctl restart xray
  echo "xray restarted"
}

# ─── Entry point ────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: xray-mgr <command> [args]

Commands:
  list                        List users with traffic stats
  add <name>                  Add user (requires root)
  del <name>                  Delete user (requires root)
  link <name>                 Get vless:// link
  qr <name>                   QR code for connection
  stats <name>                Traffic for a specific user
  blocked [user] [period]     Block stats (period: hour/day/week/month/year)
  status                      xray service status
  restart                     Restart xray (requires root)
EOF
}

COMMAND="${1:-}"
shift || true

case "$COMMAND" in
  list)     cmd_list ;;
  add)      cmd_add "${1:-}" ;;
  del)      cmd_del "${1:-}" ;;
  link)     cmd_link "${1:-}" ;;
  qr)       cmd_qr "${1:-}" ;;
  stats)    cmd_stats "${1:-}" ;;
  blocked)  cmd_blocked "${1:-}" "${2:-}" ;;
  status)   cmd_status ;;
  restart)  cmd_restart ;;
  *)        usage; exit 1 ;;
esac
