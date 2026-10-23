# tg-xray-manager

Telegram-бот для управления VPN-сервером на базе [Xray](https://github.com/XTLS/Xray-core) (VLESS + REALITY).

## Возможности

**Для пользователей:**
- Регистрация по одноразовому промокоду
- Просмотр своего трафика (`/me`)
- Получение ссылки для подключения (`/link`)
- QR-код для подключения (`/qr`)

**Для администраторов:**
- Список всех пользователей с трафиком
- Добавление / удаление пользователей
- Генерация промокодов
- Статус и перезапуск xray
- Shell-команды прямо из Telegram (`/shell`)
- Перезагрузка и выключение сервера

## Установка

Требования: Ubuntu 22.04+, root-доступ.

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/RazZrus/tg-xray-manager/main/scripts/install.sh)
```

Скрипт предложит два режима:

- **A** — xray уже установлен, ставим только бота и xray-mgr
- **B** — полная установка с нуля (xray + VLESS/REALITY конфиг + бот)

После установки запустится интерактивный wizard — введи токен бота и свой Telegram ID.

## Регистрация пользователей

1. Админ генерирует промокод: `/admin` → **Создать промокод**
2. Отправляет код пользователю
3. Пользователь пишет боту `/register`, вводит код и выбирает имя
4. Бот создаёт VPN-аккаунт и присылает ссылку для подключения

## Клиентские приложения

| Платформа | Приложение |
|-----------|-----------|
| Android | v2rayNG, Nekobox |
| iOS | Streisand, Shadowrocket, V2Box |
| Windows | Nekoray, v2rayN |
| macOS | Nekoray, V2Box |

## Обновление

```bash
bash /opt/tg-xray-manager/scripts/update.sh
```

## Удаление

```bash
bash /opt/tg-xray-manager/scripts/uninstall.sh
```

Xray и его конфиг не затрагиваются — удаляется только бот.

## Стек

- [Grammy](https://grammy.dev/) — Telegram Bot Framework
- TypeScript + Node.js 20
- SQLite (better-sqlite3)
- xray Stats gRPC API — статистика трафика
- PM2 — управление процессом
