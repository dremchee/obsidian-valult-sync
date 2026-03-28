# Plugin Usage

## Что это

`plugin/` это актуальный Obsidian plugin для синхронизации локальной папки с Rust-сервером
из `server/`.

Текущая версия работает в document-first модели:

- один sync document на `vault_id + path`
- контент хранится как Loro snapshot payload
- сервер ведёт document history и change feed
- plugin пишет обычные `.md` файлы на диск только на границе с Obsidian

Архитектурная схема отдельно описана в [ARCHITECTURE.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/ARCHITECTURE.md).

Дополнительно plugin поддерживает:

- реестр vault на сервере
- регистрацию устройств
- include/ignore scope
- realtime SSE с polling fallback
- просмотр server history для активного файла
- restore активного файла на выбранную серверную версию

---

## Предварительные требования

- запущенный сервер из `server/`
- собранный plugin из `plugin/`
- локальный Obsidian vault
- одинаковый `Auth token` на сервере и в plugin

---

## Сборка plugin

```bash
cd plugin
npm install
npm run build
```

Полезные команды:

```bash
npm run typecheck
npm test
npm run dev
```

Для локальной dev-сборки под Obsidian:

```bash
./dev-plugin.sh
```

---

## Установка в Obsidian

Собранные артефакты нужно положить в:

```text
<vault>/.obsidian/plugins/obsidian-sync-plugin/
```

Минимально нужны:

- `plugin/main.js`
- `plugin/manifest.json`

Если используется UI со стилями, имеет смысл положить и:

- `plugin/styles.css`

---

## Базовая настройка

### 1. Connection

В секции `Connection` задаются:

- `Server URL`
- `Auth token`
- `Device ID`
- `Poll interval`
- `Auto sync`

Минимальная конфигурация:

- `Server URL = http://127.0.0.1:3000`
- `Auth token = secret-token`
- `Device ID = уникальный и стабильный идентификатор этой установки`

`Device ID` генерируется автоматически, если его ещё нет в plugin data.

### 2. Vault

После успешной авторизации plugin умеет:

- загрузить реестр vault с сервера
- создать новый vault
- присоединить текущую папку к существующему vault
- отключить текущую папку от vault
- забыть локальный sync state для текущего vault

Одна локальная папка должна быть привязана только к одному `vaultId` одновременно.

### 3. Sync Scope

Можно ограничить набор синхронизируемых файлов:

- `Include patterns` это allow-list
- `Ignore patterns` это исключения после include

Поддерживаются:

- `*`
- `?`
- префиксы каталогов, оканчивающиеся на `/`

Примеры:

```text
Include:
Notes/
*.md

Ignore:
.obsidian/
Templates/
*.canvas
```

---

## Как работает sync

Plugin:

- сканирует локальный vault
- применяет include/ignore scope
- строит локальный Loro document для каждого syncable path
- отправляет новые snapshots через `POST /documents/push`
- отправляет удаления как tombstone
- держит watermark `last_seq`
- читает `GET /documents/changes`
- держит SSE-подписку на `GET /events`
- после SSE-сигнала дочитывает `GET /documents/changes`
- пропускает собственные change events по `device_id`
- для удалённых изменений читает `GET /documents/snapshot`
- импортирует удалённый snapshot и заново сериализует markdown в локальный файл

Rename сейчас не моделируется как отдельная операция и по-прежнему выглядит как
`delete + create`.

---

## Команды plugin

В command palette доступны:

- `Sync now`
- `Show active file server history`
- `Restore active file to previous server version`

Команда истории открывает модальное окно с версиями файла на сервере и позволяет сделать restore
на конкретную версию.

---

## Что показывает UI

### Status bar

Status bar показывает:

- текущее состояние sync
- активный vault
- время последнего успешного sync
- последнюю ошибку, если она есть

Возможные состояния:

- `Up to date`
- `Pending changes`
- `Syncing`
- `Needs attention`
- `Auto sync off`
- `No vault connected`

### Overview

В overview можно быстро:

- запустить `Sync now`
- проверить соединение с сервером
- обновить список устройств

---

## Первый запуск и привязка папки

Рекомендуемый flow описан в [PLUGIN_UX_FLOW.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/PLUGIN_UX_FLOW.md).

Коротко:

1. Ввести `Server URL` и `Auth token`
2. Нажать `Check`
3. Либо создать новый vault, либо присоединиться к существующему
4. При необходимости настроить scope
5. Запустить `Sync now`

Если локальная папка уже содержит syncable-файлы и серверный vault тоже не пустой, plugin
попросит выбрать стратегию первого sync:

- скачать vault с сервера и перезаписать локальные syncable-файлы
- выполнить обычный sync и дать document merge/history догнать состояние естественным путём

---

## Запуск сервера

Через `.env`:

```bash
cp server/.env.example server/.env
./run-server.sh
```

Минимальное содержимое `server/.env`:

```bash
AUTH_TOKEN=secret-token
```
