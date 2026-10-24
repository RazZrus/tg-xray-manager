#!/usr/bin/env bash
# xray-mgr — manage xray VLESS+REALITY users
set -euo pipefail

# When run as a systemd service HOME may not be set
HOME="${HOME:-/root}"

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

# jq paths by tag
VLESS='([.inbounds[] | select(.tag == "vless-reality")] | first)'
VLESS_GRPC='([.inbounds[] | select(.tag == "vless-grpc")] | first)'

BOT_CONFIG="$HOME/.tg-xray-bot/config.json"

# Read all values from xray config and write them to bot config.json.
# Called once at every xray-mgr invocation (skipped if config or jq is missing).
sync_bot_config() {
  [[ -f "$BOT_CONFIG" ]] || return
  command -v jq &>/dev/null || return
  [[ -f "$XRAY_CONFIG" ]] || return

  local port sni short_id priv pub stats_port
  port=$(cfg "${VLESS}.port // 443")
  sni=$(cfg "${VLESS}.streamSettings.realitySettings.serverNames[0] // empty")
  short_id=$(cfg "${VLESS}.streamSettings.realitySettings.shortIds[0] // empty")
  priv=$(cfg "${VLESS}.streamSettings.realitySettings.privateKey // empty")
  stats_port=$(jq -r '([.inbounds[] | select(.tag == "api")] | first).port // 10085' "$XRAY_CONFIG")

  if [[ -n "$priv" ]]; then
    pub=$("$XRAY_BIN" x25519 -i "$priv" 2>/dev/null | grep -i 'public key' | awk '{print $NF}')
  fi

  local tmp
  tmp=$(mktemp)
  jq \
    --argjson xrayPort  "${port:-443}" \
    --arg     sni       "${sni:-}" \
    --arg     shortId   "${short_id:-}" \
    --arg     publicKey "${pub:-}" \
    --argjson statsPort "${stats_port:-10085}" \
    '. + {xrayPort: $xrayPort, sni: $sni, shortId: $shortId, publicKey: $publicKey, statsPort: $statsPort}' \
    "$BOT_CONFIG" > "$tmp" && mv "$tmp" "$BOT_CONFIG" || rm -f "$tmp"
}

# All helpers read from config.json (kept current by sync_bot_config above)
get_server_ip()   { curl -s --max-time 3 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}'; }
get_server_name() { jq -r '.serverName // empty' "$BOT_CONFIG" 2>/dev/null || hostname; }
get_xray_port()   { jq -r '.xrayPort   // 443'   "$BOT_CONFIG" 2>/dev/null; }
get_grpc_port()   { cfg "${VLESS_GRPC}.port // 8443"; }
get_sni()         { jq -r '.sni        // empty' "$BOT_CONFIG" 2>/dev/null; }
get_short_id()    { jq -r '.shortId    // empty' "$BOT_CONFIG" 2>/dev/null; }
get_public_key()  { jq -r '.publicKey  // empty' "$BOT_CONFIG" 2>/dev/null; }

# Find user by name in TCP inbound, return UUID
get_uuid() {
  local name="$1"
  jq -r --arg n "$name" "${VLESS}.settings.clients[] | select(.email == \$n) | .id" "$XRAY_CONFIG"
}

# Build TCP vless:// link
make_link() {
  local name="$1"
  local uuid
  uuid=$(get_uuid "$name")
  [[ -n "$uuid" ]] || die "User '$name' not found"

  local ip port sni short_id public_key display_name
  ip=$(get_server_ip)
  port=$(get_xray_port)
  sni=$(get_sni)
  short_id=$(get_short_id)
  public_key=$(get_public_key)
  display_name=$(get_server_name)

  [[ -n "$ip" ]]         || die "Could not determine server IP"
  [[ -n "$port" ]]       || die "Could not determine xray port"
  [[ -n "$sni" ]]        || die "Could not determine SNI"
  [[ -n "$public_key" ]] || die "Public key not found. Check ~/.tg-xray-bot/config.json or xray config privateKey"

  echo "vless://${uuid}@${ip}:${port}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${sni}&fp=chrome&pbk=${public_key}&sid=${short_id}&type=tcp&headerType=none#${display_name}"
}

# Build gRPC vless:// link
make_grpc_link() {
  local name="$1"
  local uuid
  uuid=$(get_uuid "$name")
  [[ -n "$uuid" ]] || die "User '$name' not found"

  local ip port sni short_id public_key display_name
  ip=$(get_server_ip)
  port=$(get_grpc_port)
  sni=$(get_sni)
  short_id=$(get_short_id)
  public_key=$(get_public_key)
  display_name=$(get_server_name)

  [[ -n "$ip" ]]         || die "Could not determine server IP"
  [[ -n "$port" ]]       || die "Could not determine gRPC port"
  [[ -n "$sni" ]]        || die "Could not determine SNI"
  [[ -n "$public_key" ]] || die "Public key not found. Check ~/.tg-xray-bot/config.json or xray config privateKey"

  echo "vless://${uuid}@${ip}:${port}?encryption=none&security=reality&sni=${sni}&fp=chrome&pbk=${public_key}&sid=${short_id}&type=grpc&serviceName=vless-grpc#${display_name} (gRPC)"
}

# ─── Stats API (gRPC) ───────────────────────────────────────────────────────

PROTO_DIR="/opt/tg-xray-manager/proto"

stats_query() {
  local pattern="$1"
  grpcurl -plaintext \
    -import-path "$PROTO_DIR" -proto stats.proto \
    -d "{\"pattern\": \"${pattern}\", \"reset\": false}" \
    "127.0.0.1:${STATS_PORT}" \
    xray.app.stats.command.StatsService/QueryStats 2>/dev/null || echo '{}'
}

get_user_traffic() {
  local name="$1"
  local result
  result=$(stats_query "user>>>$name>>>traffic")
  local up down
  up=$(echo "$result" | jq -r '[.stat[]? | select(.name | contains("uplink")) | .value // "0"] | first // "0"')
  down=$(echo "$result" | jq -r '[.stat[]? | select(.name | contains("downlink")) | .value // "0"] | first // "0"')
  echo "$up $down"
}

format_bytes() {
  local bytes="${1:-0}"
  bytes=$(echo "$bytes" | tr -dc '0-9' || echo 0)
  bytes=${bytes:-0}
  if   (( bytes >= 1073741824 )); then printf "%.1f GB" "$(echo "scale=1; $bytes/1073741824" | bc)"
  elif (( bytes >= 1048576 ));    then printf "%.1f MB" "$(echo "scale=1; $bytes/1048576" | bc)"
  elif (( bytes >= 1024 ));       then printf "%.1f KB" "$(echo "scale=1; $bytes/1024" | bc)"
  else echo "${bytes} B"
  fi
}

# ─── Handler API (hot add/remove without restart) ───────────────────────────

# api_add_user <tag> <email> <uuid> [flow]
api_add_user() {
  local tag="$1" email="$2" uuid="$3" flow="${4:-}"
  local account
  if [[ -n "$flow" ]]; then
    account=$(printf '{"@type":"type.googleapis.com/xray.proxy.vless.Account","id":"%s","flow":"%s"}' "$uuid" "$flow")
  else
    account=$(printf '{"@type":"type.googleapis.com/xray.proxy.vless.Account","id":"%s"}' "$uuid")
  fi
  $XRAY_BIN api adu --server="127.0.0.1:${STATS_PORT}" <<EOF
{
  "inboundTag": "${tag}",
  "user": {
    "email": "${email}",
    "level": 0,
    "account": ${account}
  }
}
EOF
}

api_remove_user() {
  local tag="$1" email="$2"
  $XRAY_BIN api rmu --server="127.0.0.1:${STATS_PORT}" <<EOF
{
  "inboundTag": "${tag}",
  "email": "${email}"
}
EOF
}

# ─── Commands ───────────────────────────────────────────────────────────────

cmd_list() {
  require_jq
  require_grpcurl

  local names
  names=$(jq -r "${VLESS}.settings.clients[]?.email // empty" "$XRAY_CONFIG")

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

  # Save to config (persistence) — add to both TCP and gRPC inbounds
  local tmp
  tmp=$(mktemp)
  jq --arg n "$name" --arg u "$uuid" '
    (.inbounds[] | select(.tag == "vless-reality") | .settings.clients) += [{"id": $u, "email": $n, "flow": "xtls-rprx-vision"}]
    | (.inbounds[] | select(.tag == "vless-grpc")  | .settings.clients) += [{"id": $u, "email": $n}]
  ' "$XRAY_CONFIG" > "$tmp"
  cp "$tmp" "$XRAY_CONFIG"
  rm "$tmp"

  # Add at runtime via API (no restart)
  api_add_user "vless-reality" "$name" "$uuid" "xtls-rprx-vision" 2>/dev/null || true
  api_add_user "vless-grpc"    "$name" "$uuid" ""                 2>/dev/null || true

  echo "User '$name' created (UUID: $uuid)"
  make_link "$name"
  make_grpc_link "$name"
}

cmd_del() {
  require_root
  require_jq

  local name="$1"
  [[ -n "$name" ]] || die "Usage: xray-mgr del <name>"

  local existing
  existing=$(get_uuid "$name")
  [[ -n "$existing" ]] || die "User '$name' not found"

  # Remove from both inbounds in config
  local tmp
  tmp=$(mktemp)
  jq --arg n "$name" '
    del(.inbounds[] | select(.tag == "vless-reality") | .settings.clients[] | select(.email == $n))
    | del(.inbounds[] | select(.tag == "vless-grpc")  | .settings.clients[] | select(.email == $n))
  ' "$XRAY_CONFIG" > "$tmp"
  cp "$tmp" "$XRAY_CONFIG"
  rm "$tmp"

  # Remove at runtime via API (no restart)
  api_remove_user "vless-reality" "$name" 2>/dev/null || true
  api_remove_user "vless-grpc"    "$name" 2>/dev/null || true

  echo "User '$name' deleted"
}

cmd_link() {
  require_jq
  local name="$1"
  [[ -n "$name" ]] || die "Usage: xray-mgr link <name>"
  make_link "$name"
}

cmd_link_grpc() {
  require_jq
  local name="$1"
  [[ -n "$name" ]] || die "Usage: xray-mgr link_grpc <name>"
  make_grpc_link "$name"
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

cmd_qr_grpc() {
  require_jq
  require_qrencode
  local name="$1"
  [[ -n "$name" ]] || die "Usage: xray-mgr qr_grpc <name>"
  local link
  link=$(make_grpc_link "$name")
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

cmd_find_uuid() {
  require_jq
  local uuid="$1"
  [[ -n "$uuid" ]] || die "Usage: xray-mgr find-uuid <uuid>"
  local name
  name=$(jq -r --arg u "$uuid" "${VLESS}.settings.clients[] | select(.id == \$u) | .email" "$XRAY_CONFIG")
  [[ -n "$name" ]] || die "UUID not found"
  echo "$name"
}

cmd_status() {
  systemctl status xray
}

cmd_restart() {
  require_root
  # Signal the bot to flush traffic before xray resets counters
  systemctl kill --signal=USR1 tg-xray-bot 2>/dev/null || true
  sleep 2
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
  link <name>                 Get TCP vless:// link
  link_grpc <name>            Get gRPC vless:// link
  qr <name>                   QR code for TCP connection
  qr_grpc <name>              QR code for gRPC connection
  stats <name>                Traffic for a specific user
  blocked [user] [period]     Block stats (period: hour/day/week/month/year)
  find-uuid <uuid>            Find xray username by UUID
  status                      xray service status
  restart                     Restart xray (requires root)
EOF
}

sync_bot_config

COMMAND="${1:-}"
shift || true

case "$COMMAND" in
  list)      cmd_list ;;
  add)       cmd_add "${1:-}" ;;
  del)       cmd_del "${1:-}" ;;
  link)      cmd_link "${1:-}" ;;
  link_grpc) cmd_link_grpc "${1:-}" ;;
  qr)        cmd_qr "${1:-}" ;;
  qr_grpc)   cmd_qr_grpc "${1:-}" ;;
  stats)     cmd_stats "${1:-}" ;;
  blocked)   cmd_blocked "${1:-}" "${2:-}" ;;
  find-uuid) cmd_find_uuid "${1:-}" ;;
  status)    cmd_status ;;
  restart)   cmd_restart ;;
  *)         usage; exit 1 ;;
esac
