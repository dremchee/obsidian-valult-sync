# API

## Назначение

Этот документ описывает актуальный HTTP-контракт sync-сервера в текущем репозитории.
Если поведение в коде и в этом файле расходится, источником истины считаются маршруты и DTO
в `server/src/`.

---

## Общие правила

### Transport

- протокол: `HTTP/JSON`
- сервер отвечает `application/json`, кроме `GET /events`, который использует `text/event-stream`
- все защищённые маршруты требуют `Authorization: Bearer <token>`
- токены берутся из `AUTH_TOKEN` или `AUTH_TOKENS`
- `GET /health` не требует авторизации

### Идентификаторы

- `vault_id` и `device_id` должны содержать только `a-z`, `A-Z`, `0-9`, `_`, `-`
- `path` это относительный путь внутри vault
- `path` не может быть абсолютным, не может содержать `..` и нормализуется к `/`

Корректный пример:

```text
notes/daily/2026-03-10.md
```

Некорректный пример:

```text
../../etc/passwd
```

### Версионирование и конфликты

- каждая запись файла версионируется внутри одного `vault_id`
- клиент отправляет `base_version`
- если `base_version` устарел, сервер не пишет данные и отвечает:

```json
{
  "ok": false,
  "conflict": true,
  "server_version": 5
}
```

Для конфликтов сервер использует `200 OK`, а не `409 Conflict`.

### Формат содержимого

- `content_b64` всегда содержит base64-строку
- `content_format`:
  - `plain`
  - `e2ee-envelope-v1`
- `hash` это hash логического содержимого файла
- `payload_hash` это hash фактического загружаемого payload

Для plaintext:

- `hash == payload_hash`
- `content_format = plain`

Для E2EE:

- `hash` относится к plaintext
- `payload_hash` относится к сериализованному зашифрованному envelope
- `content_format = e2ee-envelope-v1`

---

## Error model

### HTTP коды

- `200 OK` для успешных `GET` и `POST`
- `400 Bad Request` для невалидных идентификаторов, путей и payload
- `401 Unauthorized` для отсутствующего или неверного bearer token
- `404 Not Found` если файл или версия отсутствуют
- `500 Internal Server Error` для внутренних ошибок

### Формат ошибки

```json
{
  "error": "invalid_path",
  "message": "path is invalid"
}
```

Типовые `error`:

- `unauthorized`
- `invalid_path`
- `invalid_vault_id`
- `invalid_device_id`
- `invalid_payload`
- `invalid_base64`
- `hash_mismatch`
- `not_found`
- `internal_error`

---

## GET /health

Публичная проверка доступности сервера.

### Response

```json
{
  "ok": true
}
```

---

## GET /vaults

Вернуть серверный реестр vault.

### Response

```json
{
  "vaults": [
    {
      "vault_id": "product_docs",
      "created_at": "2026-03-26T12:00:00Z",
      "updated_at": "2026-03-26T12:05:00Z",
      "device_count": 2,
      "e2ee_fingerprint": "ab12cd34..."
    }
  ]
}
```

### Примечания

- `device_count` считается по таблице устройств
- `e2ee_fingerprint` может быть `null`
- upload/delete автоматически создают vault в реестре, даже если он не был создан через `POST /vaults`

---

## POST /vaults

Создать vault или зарегистрировать его в серверном реестре.

### Request

```json
{
  "vault_id": "product_docs",
  "e2ee_fingerprint": "ab12cd34..."
}
```

### Response

```json
{
  "ok": true,
  "created": true,
  "vault": {
    "vault_id": "product_docs",
    "created_at": "2026-03-26T12:00:00Z",
    "updated_at": "2026-03-26T12:00:00Z",
    "device_count": 0,
    "e2ee_fingerprint": "ab12cd34..."
  }
}
```

### Примечания

- при повторном вызове сервер не создаёт дубль и вернёт `created: false`
- если vault уже существует без fingerprint, сервер может сохранить переданный fingerprint
- если fingerprint уже есть, существующее значение не затирается

---

## POST /upload

Создать новую версию файла.

### Request

```json
{
  "vault_id": "default",
  "device_id": "device_local_desktop",
  "path": "notes/test.md",
  "content_b64": "IyBIZWxsbyB3b3JsZAo=",
  "hash": "f2d2b0e86e...",
  "payload_hash": "f2d2b0e86e...",
  "content_format": "plain",
  "base_version": 3
}
```

### Успешный response

```json
{
  "ok": true,
  "version": 4
}
```

### Conflict response

```json
{
  "ok": false,
  "conflict": true,
  "server_version": 5
}
```

### Примечания

- сервер валидирует `payload_hash` по фактически декодированному `content_b64`
- после upload сервер:
  - обновляет актуальную запись в `files`
  - сохраняет слепок в `file_versions`
  - пишет событие в `changes`
  - обновляет `devices` и `vaults`

---

## POST /delete

Создать tombstone для файла.

### Request

```json
{
  "vault_id": "default",
  "device_id": "device_local_desktop",
  "path": "notes/test.md",
  "base_version": 4
}
```

### Успешный response

```json
{
  "ok": true,
  "version": 5
}
```

### Conflict response

```json
{
  "ok": false,
  "conflict": true,
  "server_version": 6
}
```

### Примечания

- удаление требует, чтобы файл уже существовал
- tombstone попадает в `changes` и `file_versions`
- для tombstone сервер хранит пустые `hash` и `payload_hash`

---

## GET /file

Вернуть актуальное состояние файла.

### Query

```text
vault_id=default&path=notes/test.md
```

### Response для живого файла

```json
{
  "path": "notes/test.md",
  "hash": "f2d2b0e86e...",
  "version": 5,
  "deleted": false,
  "content_b64": "IyBIZWxsbyB3b3JsZAo=",
  "content_format": "plain"
}
```

### Response для tombstone

```json
{
  "path": "notes/test.md",
  "hash": "",
  "version": 6,
  "deleted": true,
  "content_b64": null,
  "content_format": "plain"
}
```

---

## GET /changes

Вернуть change feed по vault.

### Query

```text
vault_id=default&since=42
```

`since` опционален. Если он не передан, сервер использует `0`.

### Response

```json
{
  "changes": [
    {
      "seq": 43,
      "device_id": "device_a",
      "path": "notes/test.md",
      "version": 5,
      "deleted": false
    }
  ],
  "latest_seq": 43
}
```

### Примечания

- feed изолирован внутри одного `vault_id`
- `latest_seq` возвращается всегда, даже если `changes` пустой
- клиент может пропускать события от собственного `device_id`

---

## GET /events

SSE-поток для realtime-уведомлений по vault.

### Query

```text
vault_id=default&since=42
```

### Поведение

- сервер подписывает клиента на изменения одного `vault_id`
- если на момент подключения `latest_seq > since`, сервер сразу отправляет событие
- keepalive отправляется каждые `15` секунд
- payload содержит только новый `latest_seq`, а не полный список изменений

### SSE event

```text
event: change
data: {"latest_seq":43}
```

### Примечания

- после получения события клиент должен вызвать `GET /changes`
- при лагах broadcast-канала сервер восстанавливает поток по текущему `latest_seq`

---

## GET /devices

Вернуть список устройств, замеченных в указанном vault.

### Query

```text
vault_id=default
```

### Response

```json
{
  "devices": [
    {
      "device_id": "device_a",
      "first_seen_at": "2026-03-26T12:00:00Z",
      "last_seen_at": "2026-03-26T12:05:00Z"
    }
  ]
}
```

### Примечания

- устройства регистрируются автоматически во время upload/delete/restore
- список сортируется по `last_seen_at DESC`, затем по `device_id ASC`

---

## GET /history

Вернуть историю версий конкретного файла.

### Query

```text
vault_id=default&path=notes/test.md
```

### Response

```json
{
  "path": "notes/test.md",
  "versions": [
    {
      "version": 3,
      "hash": "480c2336...",
      "payload_hash": "480c2336...",
      "content_format": "plain",
      "deleted": false,
      "created_at": "2026-03-26T12:05:00Z"
    },
    {
      "version": 2,
      "hash": "",
      "payload_hash": "",
      "content_format": "plain",
      "deleted": true,
      "created_at": "2026-03-26T12:04:00Z"
    }
  ]
}
```

### Примечания

- история сортируется по `version DESC`
- для tombstone-версий `deleted = true`
- если история отсутствует, сервер вернёт `404`

---

## POST /restore

Создать новую текущую версию на основе выбранной исторической версии.

### Request

```json
{
  "vault_id": "default",
  "device_id": "device_local_desktop",
  "path": "notes/test.md",
  "target_version": 2,
  "base_version": 5
}
```

### Успешный response

```json
{
  "ok": true,
  "version": 6
}
```

### Conflict response

```json
{
  "ok": false,
  "conflict": true,
  "server_version": 7
}
```

### Поведение

- restore тоже требует актуальный `base_version`
- если `target_version` указывает на живую версию, сервер поднимает её как новую текущую
- если `target_version` указывает на tombstone, текущая версия после restore тоже становится tombstone
- restore пишет запись в `changes`, обновляет `files`, `file_versions`, `devices` и `vaults`

---

## Совместимость клиента

Текущий Obsidian plugin использует весь набор маршрутов:

- `GET /health`
- `GET /vaults`
- `POST /vaults`
- `POST /upload`
- `POST /delete`
- `GET /file`
- `GET /changes`
- `GET /events`
- `GET /devices`
- `GET /history`
- `POST /restore`
