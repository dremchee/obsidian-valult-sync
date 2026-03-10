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

Если на сервере включён `AUTH_TOKEN`, в plugin должен быть указан такой же `Auth token`.

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
- polling sync
- conflict copy

Текущие ограничения:

- нет E2EE
- нет selective sync
- нет merge содержимого
- нет realtime push
- нет полноценного auth flow

---

## Ручная проверка MVP

Финальный e2e-чеклист для закрытия MVP находится в `docs/MVP_CHECKLIST.md`.

---

## Запуск сервера

```bash
cd server
cargo run
```

После этого plugin может подключаться к `http://127.0.0.1:3000`.
