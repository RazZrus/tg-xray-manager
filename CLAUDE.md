# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build     # tsc — compile TypeScript to dist/
npm run lint      # eslint src --ext .ts
npm run dev       # ts-node src/index.ts (requires config)
npm run start     # node dist/index.js
bash -n scripts/*.sh  # syntax-check all shell scripts
```

No test suite exists.

## Architecture

Three-layer dependency chain — each layer only imports from layers below it:

```
handlers/          — bot commands & callbacks (grammY)
    ↓
store/index.ts     — BotStore singleton, exposes services as properties
    ↓
services/          — business logic classes
    ↓
api/               — raw I/O (no business logic)
  db/              — better-sqlite3 (lazy prepared statements)
  grpc/            — xray Stats API client (cached, reconnects on host change)
  xray/            — xray-mgr CLI wrapper (spawnSync)
  system/          — systemd / shell commands
```

**Handlers** never import from `api/` directly — they go through `store.*`:
```ts
import { store } from '../store/index.js'
store.users.xrayAdd(name)       // UserService
store.traffic.queryUser(...)    // TrafficService
store.promo.find(code)          // PromoService
store.version.checkAndNotify()  // VersionService
store.system.restartXray()      // api/system passthrough
```

**TrafficService** polls xray gRPC Stats API every 60 s, writes deltas to `traffic_hourly` (SQLite). "Last hour" uses a 2-bucket window (`Date.now() - 2h`) to guarantee full coverage. `SIGUSR1` to the bot process flushes traffic before an external xray restart.

**xray-mgr** (`scripts/xray-mgr.sh`) is installed at `/usr/local/bin/xray-mgr`. The bot calls it via `spawnSync`. Override path with `XRAY_MGR_PATH` env var.

**report.ts** is a standalone entry point (invoked by a systemd timer, not the bot process). It imports from `api/` directly — do not add `store` dependency there.

## Key files

| Path | Role |
|------|------|
| `src/index.ts` | Entry point — wires startup, signals, version check |
| `src/bot.ts` | Creates grammY bot, sets commands, registers handlers |
| `src/store/index.ts` | BotStore singleton |
| `src/api/db/connection.ts` | DB init, WAL mode, schema migration |
| `src/api/grpc/client.ts` | Cached gRPC client for xray Stats API (`proto/stats.proto`) |
| `src/api/xray/runner.ts` | `run(args)` — base xray-mgr wrapper |
| `scripts/xray-mgr.sh` | Shell script managing xray config and user VLESS links |

## Data storage

All runtime data lives in `~/.tg-xray-bot/`:
- `config.json` — bot token, admin IDs, server IP, ports, SNI
- `db.sqlite` — users, promo codes, `traffic_hourly`

## Style rules (enforced by ESLint)

- No semicolons (`semi: never`)
- Blank line before every `return` (`newline-before-return`)
- Trailing commas in multiline arrays/objects
- `curly` required for all `if/else/for`

## Legacy files

`src/db/index.ts` and `src/services/xray.ts` are legacy modules predating the `api/` layer. They are still compiled but should not be imported in new code — use `api/db/*` and `api/xray/*` instead. `src/services/version.ts` (standalone function) is superseded by `src/services/VersionService.ts` (class used by the store).
