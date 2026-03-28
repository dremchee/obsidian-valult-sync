# Architecture

## Назначение

Этот документ описывает текущую архитектуру проекта после hard cutover на document-first sync.

Система больше не использует legacy whole-file sync как основную модель. Источником истины
для синхронизации является document state, а не версия markdown-файла целиком.

---

## Верхнеуровневая схема

Система состоит из двух активных частей:

- Obsidian plugin в `plugin/`
- Rust server в `server/`

Между ними остаются только инфраструктурные и document-sync контракты:

- auth через bearer token
- vault registry
- device registry
- document push/snapshot/history/restore
- realtime wake-up через SSE

---

## Core Model

### Vault

- одна локальная папка Obsidian подключается к одному `vault_id`
- сервер хранит изолированные пространства по `vault_id`
- один и тот же `path` может существовать независимо в разных vault

### Document

- один документ идентифицируется парой `vault_id + path`
- контент документа хранится как Loro payload
- сервер хранит:
  - текущий head в `documents`
  - историю в `document_versions`
  - change feed в `document_changes`

### Edge representation

- на диске у пользователя по-прежнему лежит обычный markdown
- внутри sync pipeline используется serialized Loro state
- plugin отвечает за преобразование:
  - `markdown -> LoroDoc`
  - `LoroDoc -> markdown`

---

## Plugin Architecture

Основной runtime находится в [engine.ts](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/plugin/src/sync/engine.ts).

### Основной цикл

`SyncEngine.syncOnce()` делает:

1. валидирует настройки
2. сканирует локальные файлы через `ObsidianVaultIO`
3. преобразует markdown в локальные Loro snapshots
4. пушит локальные изменения через `POST /documents/push`
5. читает remote change feed через `GET /documents/changes`
6. для каждого чужого изменения скачивает `GET /documents/snapshot`
7. импортирует snapshot, сериализует markdown и записывает файл обратно в vault
8. обновляет локальный `SyncState`

### Локальное состояние

Plugin хранит:

- `settings`
- `scope`
- `state`

В `state` живут:

- `vaultId`
- `documents[path]`
- `lastSeq`
- `lastSyncAt`
- `lastSyncError`

Для каждого документа plugin помнит:

- `snapshotB64`
- `contentHash`
- `version`
- `mtime`
- `deleted`

### Что plugin больше не делает

- не использует `base_version`
- не создаёт conflict copy как базовый механизм
- не выполняет upload/delete/rename через отдельные file endpoints
- не хранит E2EE metadata

---

## Server Architecture

Актуальные маршруты экспортируются из [mod.rs](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/server/src/routes/mod.rs).

### Active routes

- `/health`
- `/vaults`
- `/devices`
- `/documents/push`
- `/documents/snapshot`
- `/documents/changes`
- `/documents/history`
- `/documents/restore`
- `/events`

### Active services

- [doc_sync.rs](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/server/src/services/doc_sync.rs)
- `registry.rs`

### Server responsibilities

Сервер:

- валидирует `vault_id`, `device_id`, `path`
- валидирует `hash` по incoming payload
- хранит текущую версию документа
- пишет immutable version history
- пишет change feed для polling/realtime
- рассылает `latest_seq` через SSE
- ведёт реестр vault и устройств

### Merge model

При `push` сервер:

- получает serialized payload
- если это не tombstone, импортирует payload в текущий server-side document
- экспортирует новый snapshot
- сохраняет его как новую head-версию

Это позволяет держать сервер как authoritative store для document history, но уже без old
file-version conflict API.

---

## Data Flow

### Local edit

1. Пользователь меняет markdown-файл в Obsidian.
2. Plugin на следующем sync scan читает файл.
3. Plugin строит новый Loro document относительно сохранённого snapshot.
4. Plugin экспортирует snapshot и отправляет его на сервер.
5. Сервер сохраняет новую document version и change record.
6. Сервер публикует новый `latest_seq` в SSE.

### Remote update

1. Другой клиент публикует document change.
2. Сервер создаёт запись в `document_changes`.
3. Клиент получает SSE wake-up или догоняет изменение polling-ом.
4. Клиент читает `/documents/changes`.
5. Для каждого чужого change клиент читает `/documents/snapshot`.
6. Клиент импортирует snapshot и записывает итоговый markdown в локальный vault.

### Restore

1. Пользователь открывает document history.
2. Plugin получает список `document_versions`.
3. Пользователь выбирает `target_version`.
4. Plugin вызывает `/documents/restore`.
5. Сервер создаёт новую head-версию из исторического snapshot.
6. Остальные клиенты получают это как обычное document change.

---

## Realtime Strategy

Realtime не заменяет polling полностью.

Текущая модель:

- SSE нужен как быстрый wake-up signal
- `latest_seq` нужен как watermark
- фактическое чтение изменений всё равно идёт через `/documents/changes`
- polling остаётся fallback при разрыве realtime

Такой split упрощает клиент и не заставляет переносить полный payload в SSE stream.

---

## Scope And File Semantics

Sync scope живёт только на клиенте.

Plugin применяет:

- `includePatterns`
- `ignorePatterns`

Сервер не знает о client-side scope и принимает только уже отфильтрованные пути.

Rename по-прежнему не выделен как отдельная доменная операция. Для runtime это выглядит как:

- удаление старого `path`
- создание нового `path`

---

## Removed Layers

Из архитектуры удалены:

- `base_version`-based conflict detection
- conflict-copy workflow как основной path
- whole-file upload/download API
- file version tables старой модели
- E2EE layer и связанные metadata

Это намеренное упрощение. Текущий проект теперь сфокусирован на plain document sync, а не на
слоистой file-sync архитектуре с дополнительными режимами.

---

## Source Files

Ключевые точки входа:

- [engine.ts](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/plugin/src/sync/engine.ts)
- [loro-markdown.ts](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/plugin/src/sync/loro-markdown.ts)
- [api.ts](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/plugin/src/api.ts)
- [documents.rs](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/server/src/routes/documents.rs)
- [doc_sync.rs](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/server/src/services/doc_sync.rs)
- [registry.rs](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/server/src/services/registry.rs)
- [0009_crdt_documents.sql](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/server/migrations/0009_crdt_documents.sql)
