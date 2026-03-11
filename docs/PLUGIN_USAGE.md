# Plugin Usage

## Что это

`plugin/` это MVP Obsidian plugin, который синхронизирует текущий vault с нашим Rust-сервером через HTTP API.

---

## Что нужно перед запуском

- запущенный sync-сервер из `server/`
- собранный plugin из `plugin/`
- локальный Obsidian vault

---

## Сборка plugin

```bash
cd plugin
npm install
npm run build
```

После сборки в папке `plugin/` должны быть:

- `main.js`
- `manifest.json`

---

## Установка в Obsidian

Скопировать файлы plugin в папку plugins внутри vault:

```text
<vault>/.obsidian/plugins/obsidian-sync-plugin/
```

Нужны файлы:

- `plugin/main.js`
- `plugin/manifest.json`

Опционально можно положить туда и весь каталог `plugin/`, но для Obsidian критичны именно собранные артефакты.

---

## Включение plugin

1. Открыть `Settings`
2. Перейти в `Community plugins`
3. Включить `Obsidian Sync Plugin`

---

## Настройки plugin

Основной пользовательский сценарий от установки plugin до подключения vault описан в `docs/PLUGIN_UX_FLOW.md`.

В настройках plugin доступны:

- `Server URL`
- `Vault ID`
- `Device ID`
- `Auth token`
- `Poll interval`
- `Auto sync`

Минимальная настройка:

- `Server URL = http://127.0.0.1:3000`
- `Vault ID = общий идентификатор логического vault`
- `Auth token = bearer token, заданный на сервере через AUTH_TOKEN или AUTH_TOKENS`

`Auth token` обязателен. Если сервер использует `AUTH_TOKEN`, в plugin должен быть указан такой же токен.

Если сервер использует `AUTH_TOKENS`, в plugin должен быть указан один из разрешённых bearer tokens.

`Device ID` должен быть уникален для каждой установки Obsidian, но оставаться стабильным между перезапусками.

Для двух локальных Obsidian vault, которые должны синхронизироваться между собой, `Vault ID` должен быть одинаковым.

Для двух независимых sync-пространств `Vault ID` должен отличаться.

---

## Как работает sync

Plugin:

- сканирует vault
- загружает локальные изменения
- отправляет удаления
- держит realtime SSE-подписку на сервер
- читает change feed сервера
- пропускает change events, которые сам же и создал через тот же `Device ID`
- скачивает удалённые изменения
- создаёт conflict copies при расхождении локального и удалённого состояния

Команда `Sync now` доступна из command palette.

---

## Текущее состояние MVP

Уже работает:

- upload новых файлов
- upload изменений
- delete через tombstones
- download удалённых изменений
- realtime push с polling fallback
- conflict copy
- restore активного файла на предыдущую серверную версию через command palette

Текущие ограничения:

- нет merge содержимого
- metadata vault/file не скрывается E2EE
- нет полноценного history UI

---

## Ручная проверка MVP

Финальный e2e-чеклист для закрытия MVP находится в `docs/MVP_CHECKLIST.md`.

---

## Запуск сервера

```bash
cd server
AUTH_TOKEN=secret-token cargo run
```

После этого plugin может подключаться к `http://127.0.0.1:3000`.
