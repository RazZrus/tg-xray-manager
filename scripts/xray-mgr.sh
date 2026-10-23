#!/usr/bin/env bash
# xray-mgr — управление пользователями xray VLESS+REALITY
set -euo pipefail

XRAY_CONFIG="/usr/local/etc/xray/config.json"
XRAY_BIN="/usr/local/bin/xray"
STATS_PORT="${XRAY_STATS_PORT:-10085}"

# ─── Утилиты ─────────────────────────────────────────────────────────────────

die() { echo "ERROR: $*" >&2; exit 1; }

require_root() {
  [[ $EUID -eq 0 ]] || die "Эта команда требует прав root (sudo xray-mgr ...)"
}

require_jq() {
  command -v jq &>/dev/null || die "Установите jq: apt-get install -y jq"
}

require_qrencode() {
  command -v qrencode &>/dev/null || die "Установите qrencode: apt-get install -y qrencode"
}

require_grpcurl() {
  command -v grpcurl &>/dev/null || {
    echo "grpcurl не найден, устанавливаю..." >&2
    local ARCH
    ARCH=$(uname -m)
    local TAG
    TAG=$(curl -s https://api.github.com/repos/fullstorydev/grpcurl/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
    local FILE="grpcurl_${TAG#v}_linux_${ARCH}.tar.gz"
    curl -fsSL "https://github.com/fullstorydev/grpcurl/releases/download/${TAG}/${FILE}" | tar -xz -C /usr/local/bin grpcurl
  }
}

# Получить значение из xray config по jq-пути
cfg() { jq -r "$1" "$XRAY_CONFIG"; }

# Получить IP/port для vless ссылки
get_server_ip() {
  # Сначала пробуем внешний IP
  curl -s --max-time 3 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}'
}

get_xray_port() { cfg '.inbounds[0].port // 443'; }
get_public_key() { cfg '.inbounds[0].streamSettings.realitySettings.privateKey' | $XRAY_BIN x25519 -i /dev/stdin 2>/dev/null | grep 'Public key' | awk '{print $NF}' || cfg '.inbounds[0].streamSettings.realitySettings.publicKey // empty'; }
get_sni() { cfg '.inbounds[0].streamSettings.realitySettings.serverNames[0] // "www.microsoft.com"'; }
get_short_id() { cfg '.inbounds[0].streamSettings.realitySettings.shortIds[0] // ""'; }

# Найти пользователя по имени, вернуть его UUID
get_uuid() {
  local name="$1"
  jq -r --arg n "$name" '.inbounds[0].settings.clients[] | select(.email == $n) | .id' "$XRAY_CONFIG"
}

# Сформировать vless:// ссылку
make_link() {
  local name="$1"
  local uuid
  uuid=$(get_uuid "$name")
  [[ -n "$uuid" ]] || die "Пользователь '$name' не найден"

  local ip port sni short_id public_key
  ip=$(get_server_ip)
  port=$(get_xray_port)
  sni=$(get_sni)
  short_id=$(get_short_id)
  # public key берём из конфига напрямую
  public_key=$(cfg '.inbounds[0].streamSettings.realitySettings.publicKey // empty')

  echo "vless://${uuid}@${ip}:${port}?encryption=none&flow=xtls-rprx-vision&security=reality&sni=${sni}&fp=chrome&pbk=${public_key}&sid=${short_id}&type=tcp&headerType=none#${name}"
}

# ─── Stats API (gRPC) ─────────────────────────────────────────────────────────

# Запрос к Stats API через grpcurl
stats_query() {
  local pattern="$1"
  grpcurl -plaintext \
    -d "{\"pattern\": \"${pattern}\", \"reset\": false}" \
    "127.0.0.1:${STATS_PORT}" \
    xray.app.stats.command.StatsService/QueryStats 2>/dev/null || echo '{}'
}

# Получить трафик пользователя (upload + download в байтах)
get_user_traffic() {
  local name="$1"
  local result
  result=$(stats_query "user>>>$name>>>traffic")
  local up down
  up=$(echo "$result" | jq -r '[.stat[]? | select(.name | contains("uplink")) | .value // "0"] | first // "0"')
  down=$(echo "$result" | jq -r '[.stat[]? | select(.name | contains("downlink")) | .value // "0"] | first // "0"')
  echo "$up $down"
}

# Форматировать байты в человекочитаемый вид
format_bytes() {
  local bytes="${1:-0}"
  # убираем всё нечисловое (grpcurl может вернуть строку)
  bytes=$(echo "$bytes" | tr -dc '0-9' || echo 0)
  bytes=${bytes:-0}
  if   (( bytes >= 1073741824 )); then printf "%.1f GB" "$(echo "scale=1; $bytes/1073741824" | bc)"
  elif (( bytes >= 1048576 ));    then printf "%.1f MB" "$(echo "scale=1; $bytes/1048576" | bc)"
  elif (( bytes >= 1024 ));       then printf "%.1f KB" "$(echo "scale=1; $bytes/1024" | bc)"
  else echo "${bytes} B"
  fi
}

# ─── Команды ─────────────────────────────────────────────────────────────────

cmd_list() {
  require_jq
  require_grpcurl

  local names
  names=$(jq -r '.inbounds[0].settings.clients[].email' "$XRAY_CONFIG")

  printf "%-20s %12s %12s\n" "USER" "UPLOAD" "DOWNLOAD"
  printf "%-20s %12s %12s\n" "----" "------" "--------"

  while IFS= read -r name; do
    read -r up down <<< "$(get_user_traffic "$name")"
    printf "%-20s %12s %12s\n" "$name" "$(format_bytes "$up")" "$(format_bytes "$down")"
  done <<< "$names"
}

cmd_add() {
  require_root
  require_jq

  local name="$1"
  [[ -n "$name" ]] || die "Использование: xray-mgr add <name>"
  [[ "$name" =~ ^[a-zA-Z0-9_-]+$ ]] || die "Имя должно содержать только латинские буквы, цифры, _ и -"

  # Проверить что не существует
  local existing
  existing=$(jq -r --arg n "$name" '.inbounds[0].settings.clients[] | select(.email == $n) | .email' "$XRAY_CONFIG")
  [[ -z "$existing" ]] || die "Пользователь '$name' уже существует"

  # Генерировать UUID
  local uuid
  uuid=$($XRAY_BIN uuid)

  # Добавить в конфиг
  local tmp
  tmp=$(mktemp)
  jq --arg n "$name" --arg u "$uuid" \
    '.inbounds[0].settings.clients += [{"id": $u, "email": $n, "flow": "xtls-rprx-vision"}]' \
    "$XRAY_CONFIG" > "$tmp"
  cp "$tmp" "$XRAY_CONFIG"
  rm "$tmp"

  # Перезапустить xray
  systemctl restart xray

  echo "Пользователь '$name' создан (UUID: $uuid)"
  make_link "$name"
}

cmd_del() {
  require_root
  require_jq

  local name="$1"
  [[ -n "$name" ]] || die "Использование: xray-mgr del <name>"

  local existing
  existing=$(get_uuid "$name")
  [[ -n "$existing" ]] || die "Пользователь '$name' не найден"

  local tmp
  tmp=$(mktemp)
  jq --arg n "$name" \
    '.inbounds[0].settings.clients = [.inbounds[0].settings.clients[] | select(.email != $n)]' \
    "$XRAY_CONFIG" > "$tmp"
  cp "$tmp" "$XRAY_CONFIG"
  rm "$tmp"

  systemctl restart xray
  echo "Пользователь '$name' удалён"
}

cmd_link() {
  require_jq
  local name="$1"
  [[ -n "$name" ]] || die "Использование: xray-mgr link <name>"
  make_link "$name"
}

cmd_qr() {
  require_jq
  require_qrencode
  local name="$1"
  [[ -n "$name" ]] || die "Использование: xray-mgr qr <name>"
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
  [[ -n "$name" ]] || die "Использование: xray-mgr stats <name>"

  local existing
  existing=$(get_uuid "$name")
  [[ -n "$existing" ]] || die "Пользователь '$name' не найден"

  read -r up down <<< "$(get_user_traffic "$name")"
  echo "Пользователь: $name"
  echo "  Исходящий:  $(format_bytes "$up")"
  echo "  Входящий:   $(format_bytes "$down")"
  echo "  Итого:      $(format_bytes "$(( ${up:-0} + ${down:-0} ))")"
}

cmd_blocked() {
  require_jq

  local user="${1:-}"
  local period="${2:-day}"

  # Считаем из логов xray
  local log_file
  log_file=$(cfg '.log.access // "/var/log/xray/access.log"')
  [[ -f "$log_file" ]] || {
    # Попробуем journalctl
    local since
    case "$period" in
      hour)  since="1 hour ago" ;;
      day)   since="1 day ago" ;;
      week)  since="1 week ago" ;;
      month) since="1 month ago" ;;
      year)  since="1 year ago" ;;
      *)     since="1 day ago" ;;
    esac

    echo "Заблокированные запросы ($period):"
    if [[ -n "$user" ]]; then
      journalctl -u xray --since="$since" 2>/dev/null | grep -i "blocked\|reject" | grep "$user" | wc -l | xargs echo "  Количество:"
    else
      journalctl -u xray --since="$since" 2>/dev/null | grep -i "blocked\|reject" | wc -l | xargs echo "  Всего заблокировано:"
    fi
    return
  }

  echo "Заблокированные запросы ($period) из $log_file:"
  if [[ -n "$user" ]]; then
    grep "rejected\|blocked" "$log_file" | grep "$user" | wc -l | xargs echo "  Пользователь $user:"
  else
    grep "rejected\|blocked" "$log_file" | wc -l | xargs echo "  Всего:"
  fi
}

cmd_status() {
  systemctl status xray
}

cmd_restart() {
  require_root
  systemctl restart xray
  echo "xray перезапущен"
}

# ─── Точка входа ─────────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Использование: xray-mgr <команда> [аргументы]

Команды:
  list                        Список пользователей с трафиком
  add <name>                  Добавить пользователя (требует root)
  del <name>                  Удалить пользователя (требует root)
  link <name>                 Получить vless:// ссылку
  qr <name>                   QR-код для подключения
  stats <name>                Трафик конкретного пользователя
  blocked [user] [period]     Статистика блокировок (period: hour/day/week/month/year)
  status                      Статус xray сервиса
  restart                     Перезапустить xray (требует root)
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
