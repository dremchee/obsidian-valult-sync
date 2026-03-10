# Implementation Plan

## Цель

Собрать рабочий аналог Obsidian Sync с `local-first` моделью, где:

- данные редактируются локально в vault
- сервер синхронизирует изменения между устройствами
- конфликты не теряются, а сохраняются явно
- архитектура остаётся достаточно простой для MVP, но не тупиковой для дальнейшего роста

---

## Product Scope

### Что делаем в первой версии

- синхронизация одного vault между несколькими устройствами
- whole-file sync
- polling вместо realtime push
- версионирование файлов на сервере
- conflict detection через `base_version`
- conflict copies вместо авто-merge
- локальная SQLite БД состояния на клиенте
- удаление через tombstones
- Rust-сервер

### Что сознательно не делаем в MVP

- E2EE
- merge содержимого файла
- rename detection как отдельную сущность
- chunked sync
- selective sync
- realtime push через WebSocket/SSE
- полноценную историю версий и restore UI

### Как трактуем спорные кейсы

- `rename` считается как `delete + create`
- сервер является `source of truth` для версий
- при конфликте серверная версия применяется как основная, локальная сохраняется как conflict copy

---

## Целевая архитектура

### Общая схема

Система состоит из двух частей:

1. клиент
2. сервер

Клиент:

- сканирует локальный vault
- хранит локальное sync state в SQLite
- определяет новые, изменённые и удалённые файлы
- загружает локальные изменения на сервер
- получает change feed с сервера
- применяет удалённые изменения локально

Сервер:

- принимает upload и delete операции
- хранит текущую версию каждого файла
- ведёт глобальный change feed
- отдаёт содержимое актуального файла
- назначает новые версии

---

## Технологические решения

### Сервер

- язык: `Rust`
- HTTP: `axum`
- runtime: `tokio`
- база: `SQLite` через `sqlx`
- сериализация: `serde`
- логирование: `tracing`
- хэширование: `sha2`

### Клиент

Клиентом является Obsidian plugin на `TypeScript`.

Минимальные требования к plugin-клиенту:

- доступ к vault через Obsidian API
- локальное хранение sync state в plugin data
- HTTP client
- фоновой sync loop

---

## Структура проекта

На текущем этапе стоит ориентироваться на такую раскладку:

```text
docs/
  INSPIRATION.md
  EXAMPLE_SYNC.md
  IMPLEMENTATION_PLAN.md
  MVP.md
  API.md

server/
  Cargo.toml
  migrations/
    0001_init.sql
  src/
    main.rs
    app.rs
    config.rs
    state.rs
    error.rs
    dto.rs
    models.rs
    db.rs
    storage.rs
    services/
      sync.rs
    routes/
      health.rs
      upload.rs
      file.rs
      changes.rs
      delete.rs

plugin/
  manifest.json
  package.json
  src/
    main.ts
    api.ts
    settings.ts
    sync-engine.ts
```

---

## Контракты MVP

### Серверные endpoints

- `GET /health`
- `POST /upload`
- `GET /file?path=...`
- `GET /changes?since=...`
- `POST /delete`

### `POST /upload`

Запрос:

```json
{
  "path": "notes/test.md",
  "content_b64": "base64...",
  "hash": "sha256...",
  "base_version": 3
}
```

Успех:

```json
{
  "ok": true,
  "version": 4
}
```

Конфликт:

```json
{
  "ok": false,
  "conflict": true,
  "server_version": 5
}
```

### `GET /changes`

Запрос:

```http
GET /changes?since=42
```

Ответ:

```json
{
  "changes": [
    {
      "seq": 43,
      "path": "notes/test.md",
      "version": 5,
      "deleted": false
    }
  ],
  "latest_seq": 43
}
```

### `POST /delete`

Запрос:

```json
{
  "path": "notes/test.md",
  "base_version": 5
}
```

Ответ:

```json
{
  "ok": true,
  "version": 6
}
```

---

## Модель данных

### Серверная SQLite схема

Таблица `files`:

- `path TEXT PRIMARY KEY`
- `hash TEXT NOT NULL`
- `version INTEGER NOT NULL`
- `deleted INTEGER NOT NULL DEFAULT 0`
- `updated_at TEXT NOT NULL`

Таблица `changes`:

- `seq INTEGER PRIMARY KEY AUTOINCREMENT`
- `path TEXT NOT NULL`
- `version INTEGER NOT NULL`
- `deleted INTEGER NOT NULL`
- `updated_at TEXT NOT NULL`

### Клиентская модель состояния

Plugin хранит локальное состояние в persisted data:

- `files[path].hash`
- `files[path].version`
- `files[path].mtime`
- `files[path].deleted`
- `last_seq`

---

## Ключевые алгоритмы

### 1. Detect local changes

Клиент периодически обходит vault и сравнивает текущее состояние с локальной БД:

- новый файл -> enqueue upload
- изменённый hash -> enqueue upload
- отсутствующий файл, который был в БД -> enqueue delete

### 2. Upload

Клиент отправляет файл с `base_version`.

Сервер:

1. валидирует путь
2. проверяет hash
3. читает текущую версию файла
4. сравнивает `base_version` и текущую версию
5. при совпадении пишет файл и повышает версию
6. создаёт запись в `changes`

### 3. Download

Клиент делает `GET /changes?since=last_seq`, затем:

- если изменение новее локальной версии -> скачивает `/file`
- если пришёл tombstone -> удаляет локальный файл
- после применения обновляет локальную БД и `last_seq`

### 4. Conflict handling

Если сервер возвращает conflict:

1. клиент получает серверную версию файла
2. локальную версию сохраняет как `filename (conflict).md`
3. серверную записывает как основную
4. локальную БД обновляет до серверной версии

### 5. Delete handling

Удаление реализуется через tombstone:

1. клиент замечает, что файл исчез локально
2. отправляет `POST /delete` с `base_version`
3. сервер повышает версию и помечает файл как `deleted = 1`
4. добавляет событие в `changes`
5. другие клиенты получают удаление через feed

---

## Нефункциональные требования

### Обязательно для MVP

- безопасная нормализация путей
- защита от path traversal
- atomic write на сервере и клиенте
- устойчивость к перезапуску клиента
- повторный polling без потери состояния
- внятные логи на сервере

### Необходимые ограничения

- большие бинарные файлы не оптимизируем отдельно
- throughput и горизонтальное масштабирование пока не являются целью
- single-node сервер допустим

---

## Этапы реализации

### Этап 0. Документация и фиксация контрактов

Сделать:

- `docs/MVP.md`
- `docs/API.md`
- утвердить payloads, ошибки и модель конфликтов

Результат:

- команда работает по одному набору правил
- код клиента и сервера не расходится по смыслу

### Этап 1. Каркас Rust-сервера

Сделать:

- создать `server/`
- инициализировать `Cargo.toml`
- поднять `axum`
- добавить `GET /health`
- подключить `tracing`

Результат:

- сервер запускается
- есть базовый каркас приложения

### Этап 2. SQLite и миграции

Сделать:

- добавить `sqlx`
- создать `migrations/0001_init.sql`
- реализовать `db.rs`
- поднимать соединение и применять миграции при старте

Результат:

- сервер хранит метаданные в SQLite

### Этап 3. File storage layer

Сделать:

- реализовать `storage.rs`
- безопасное разрешение пути
- запись файла через temp file + rename
- чтение и удаление файлов

Результат:

- сервер умеет надёжно работать с blob storage

### Этап 4. Upload endpoint

Сделать:

- DTO для upload
- `POST /upload`
- проверку hash
- optimistic concurrency через `base_version`
- version bump
- запись в `changes`

Результат:

- локальные изменения можно загружать на сервер

### Этап 5. File and change feed endpoints

Сделать:

- `GET /file`
- `GET /changes`
- корректную выдачу tombstones

Результат:

- клиент может догонять удалённые изменения

### Этап 6. Delete endpoint

Сделать:

- `POST /delete`
- пометку tombstone
- удаление blob
- запись события в `changes`

Результат:

- удаление синхронизируется между устройствами

### Этап 7. Plugin-клиент MVP

Сделать:

- каркас Obsidian plugin
- settings UI
- scanner vault через Obsidian API
- HTTP client
- sync loop
- upload/download/delete flows

Результат:

- появляется первый рабочий end-to-end sync

### Этап 8. Конфликты и устойчивость

Сделать:

- conflict copies
- retry/backoff
- устойчивость к сетевым ошибкам
- защита от частичной записи

Результат:

- поведение становится пригодным для реального использования

### Этап 9. Тестирование

Сделать:

- интеграционные тесты сервера
- сценарии с двумя клиентами
- тесты конфликтов
- тесты удаления
- тесты восстановления после рестарта

Результат:

- MVP можно считать технически состоятельным

---

## Definition of Done для MVP

MVP считается завершённым, когда выполняются все условия:

- два клиента синхронизируют изменения через один сервер
- новый файл доезжает на второе устройство
- изменение существующего файла доезжает на второе устройство
- удаление файла доезжает на второе устройство
- конфликт не приводит к потере локальной версии
- после рестарта клиента sync state не теряется
- после временного отсутствия сети синхронизация догоняет сервер

---

## Следующий этап после MVP

После завершения MVP двигаться в таком порядке:

1. auth и multi-vault модель
2. device model
3. ignore rules и selective sync
4. E2EE
5. realtime push
6. история версий и restore

---

## Текущий рабочий фокус

Начинаем с серверной части на Rust.

Первый практический спринт:

1. создать `server/`
2. поднять `axum` сервер
3. завести SQLite и миграции
4. реализовать `POST /upload`
5. реализовать `GET /file`
6. реализовать `GET /changes`
7. реализовать `POST /delete`

Этот документ является основным планом, по которому дальше двигаемся.
