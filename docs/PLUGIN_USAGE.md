# Plugin Usage

## Что это

`plugin/` это актуальный Obsidian plugin для синхронизации локальной папки с Rust-сервером
из `server/`.

На текущем этапе plugin умеет не только базовый sync, но и:

- реестр vault на сервере
- регистрацию устройств
- include/ignore scope
- E2EE контента
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

## Включение plugin

1. Открыть `Settings`
2. Перейти в `Community plugins`
3. Включить `Obsidian Sync Plugin`

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

Пока `Auth token` не введён или отвергнут сервером, остальные секции настроек остаются
логически заблокированными.

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

### 4. E2EE

Plugin поддерживает content-only E2EE:

- шифруется содержимое файла
- `path`, `vault_id`, `device_id`, версии и tombstone-метаданные остаются видимыми серверу

Текущая модель хранения секрета:

- passphrase живёт только в памяти текущей сессии Obsidian
- в persisted plugin data сохраняется только fingerprint
- fingerprint используется для проверки, что пользователь ввёл тот же ключ

Создание vault в текущем UI требует ввода E2EE passphrase.
При присоединении к существующему vault plugin попросит passphrase и, если на сервере уже есть
encrypted content, попробует её проверить.

---

## Как работает sync

Plugin:

- сканирует локальный vault
- применяет include/ignore scope
- загружает новые и изменённые файлы
- отправляет удаления как tombstone
- читает `GET /changes`
- держит SSE-подписку на `GET /events`
- после SSE-сигнала дочитывает `GET /changes`
- пропускает свои собственные change events по `device_id`
- скачивает удалённые изменения
- создаёт conflict copy, если локальное содержимое уже разошлось с сервером

Rename не моделируется отдельно и фактически трактуется как `delete + create`.

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
- выполнить обычный sync, где возможны conflict copies

---

## Запуск сервера

Есть два типовых варианта.

Через `.env`:

```bash
cp server/.env.example server/.env
./run-server.sh
```

Минимальное содержимое `server/.env`:

```bash
AUTH_TOKEN=secret-token
```

Или напрямую через env:

```bash
cd server
AUTH_TOKEN=secret-token cargo run
```

По умолчанию сервер слушает `http://127.0.0.1:3000`.

---

## Ограничения текущей реализации

- E2EE скрывает только содержимое файла, но не структуру vault
- merge содержимого отсутствует, вместо него используются conflict copies
- отдельной модели rename нет
- selective sync работает только через include/ignore patterns на клиенте
- device revoke / approval ещё не реализованы

---

## Связанные документы

- API: [API.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/API.md)
- E2EE: [E2EE.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/E2EE.md)
- UX flow: [PLUGIN_UX_FLOW.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/PLUGIN_UX_FLOW.md)
- Регрессионная проверка: [MVP_CHECKLIST.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/MVP_CHECKLIST.md)
