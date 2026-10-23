# tg-xray-manager

Telegram bot for managing a VPN server powered by [Xray](https://github.com/XTLS/Xray-core) (VLESS + REALITY).

## Features

**For users:**
- Register with a one-time promo code
- View your traffic stats (`/me`)
- Get a connection link (`/link`)
- QR code for connecting (`/qr`)

**For admins (Reply Keyboard panel via `/admin`):**
- **Users** — list all users with traffic, add / delete users
- **Promo** — create, list, delete promo codes
- **Server** — xray status, restart, reboot / shutdown
- **Terminal** — run shell commands directly from Telegram

## Installation

Requirements: Ubuntu 22.04+ (or Debian), root access.

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/RazZrus/tg-xray-manager/main/scripts/install.sh)
```

The installer uses an interactive arrow-key menu:

```
  tg-xray-manager installer

  Installation mode:

  ❯ Bot + xray-mgr only  (xray already installed)
    Full install from scratch  (xray + config + bot)
```

- **Option 1** — xray is already running, install only the bot and xray-mgr
- **Option 2** — full setup from scratch (xray + VLESS/REALITY config + bot)

After installation the wizard will prompt for the bot token and your Telegram ID.

## Configuration

Bot config is stored at `~/.tg-xray-bot/config.json`:

```json
{
  "botToken": "123456:ABC-DEF...",
  "adminIds": [483443210],
  "serverIp": "1.2.3.4",
  "xrayPort": 443,
  "sni": "www.microsoft.com",
  "statsPort": 10085
}
```

| Field | Description |
|-------|-------------|
| `botToken` | Telegram bot token from [@BotFather](https://t.me/BotFather) |
| `adminIds` | Array of Telegram user IDs with admin access |
| `serverIp` | Server public IP (auto-detected during install) |
| `xrayPort` | xray VLESS listening port |
| `sni` | SNI domain for REALITY masquerade |
| `statsPort` | xray gRPC Stats API port |

## User registration

1. Admin creates a promo code: `/admin` → **Promo** → **Create**
2. Send the code to the user
3. User sends `/register` to the bot, enters the code and picks a username
4. Bot creates a VPN account and returns a connection link

## Client apps

| Platform | App |
|----------|-----|
| Android | v2rayNG, Nekobox |
| iOS | Streisand, Shadowrocket, V2Box |
| Windows | Nekoray, v2rayN |
| macOS | Nekoray, V2Box |

## Management scripts

All scripts are located in `/opt/tg-xray-manager/scripts/`.

| Command | Description |
|---------|-------------|
| `bash scripts/update.sh` | Pull latest code, rebuild, restart bot |
| `bash scripts/uninstall.sh` | Remove bot and xray-mgr (xray untouched) |
| `bash scripts/status.sh` | Show bot & xray status, config, DB info |
| `bash scripts/logs.sh [lines] [bot\|xray\|all]` | View service logs |

### systemd

```bash
systemctl start tg-xray-bot      # start
systemctl stop tg-xray-bot       # stop
systemctl restart tg-xray-bot    # restart
systemctl status tg-xray-bot     # status
journalctl -u tg-xray-bot -f     # follow logs
```

### xray-mgr CLI

Installed globally as `/usr/local/bin/xray-mgr`:

```bash
xray-mgr list                    # list users with traffic
xray-mgr add <name>              # add user
xray-mgr del <name>              # delete user
xray-mgr link <name>             # get vless:// link
xray-mgr qr <name>               # show QR code
xray-mgr stats <name>            # user traffic details
xray-mgr status                  # xray service status
xray-mgr restart                 # restart xray
```

## Tech stack

- [grammY](https://grammy.dev/) — Telegram Bot Framework
- TypeScript + Node.js 20
- SQLite (better-sqlite3)
- xray gRPC Stats API — traffic monitoring
- systemd — process management

## License

MIT
