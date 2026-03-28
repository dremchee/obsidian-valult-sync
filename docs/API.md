# API

## Назначение

Этот документ описывает текущий HTTP-контракт sync-сервера после перехода на document-first
модель.

Источником истины считаются маршруты и DTO в `server/src/`.

---

## Общие правила

### Transport

- протокол: `HTTP/JSON`
- все защищённые маршруты требуют `Authorization: Bearer <token>`
- `GET /health` не требует авторизации
- `GET /events` использует `text/event-stream`

### Идентификаторы

- `vault_id` и `device_id` принимают только `a-z`, `A-Z`, `0-9`, `_`, `-`
- `path` это относительный путь внутри vault
- `path` не может быть абсолютным и не может содержать `..`

### Document model

- один документ идентифицируется парой `vault_id + path`
- содержимое передаётся как `content_b64`
- `content_b64` содержит base64 сериализованного Loro snapshot/update payload
- `hash` это `sha256` по декодированным байтам payload
- `deleted: true` означает tombstone
- сервер хранит текущую версию документа, историю версий и change feed

### Realtime model

- `GET /events` сообщает только новый `latest_seq`
- после realtime-сигнала клиент сам дочитывает `GET /documents/changes`

---

## Error model

### HTTP коды

- `200 OK` для успешных `GET` и `POST`
- `400 Bad Request` для невалидных идентификаторов, путей и payload
- `401 Unauthorized` для отсутствующего или неверного bearer token
- `404 Not Found` если документ или версия отсутствуют
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

Вернуть реестр vault на сервере.

### Response

```json
{
  "vaults": [
    {
      "vault_id": "product_docs",
      "created_at": "2026-03-26T12:00:00Z",
      "updated_at": "2026-03-26T12:05:00Z",
      "device_count": 2
    }
  ]
}
```

### Примечания

- `device_count` считается по таблице устройств
- vault обновляет `updated_at`, когда приходит новый document push или restore

---

## POST /vaults

Создать vault в серверном реестре.

### Request

```json
{
  "vault_id": "product_docs"
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
    "device_count": 0
  }
}
```

### Примечания

- при повторном вызове сервер не создаёт дубль и вернёт `created: false`

---

## GET /devices

Вернуть список устройств, которые уже синхронизировали указанный vault.

### Query params

- `vault_id`

### Response

```json
{
  "devices": [
    {
      "device_id": "desktop_main",
      "first_seen_at": "2026-03-26T12:00:00Z",
      "last_seen_at": "2026-03-26T12:05:00Z"
    }
  ]
}
```

---

## POST /documents/push

Записать новую версию документа.

### Request

```json
{
  "vault_id": "product_docs",
  "device_id": "desktop_main",
  "path": "notes/test.md",
  "content_b64": "AAECAwQ=",
  "hash": "f2d2b0e86e5c...",
  "deleted": false
}
```

### Response

```json
{
  "ok": true,
  "version": 4
}
```

### Примечания

- сервер валидирует `hash` по декодированным байтам `content_b64`
- при `deleted: false` сервер импортирует входящий Loro payload в текущий документ и сохраняет
  новый snapshot
- при `deleted: true` сервер сохраняет tombstone
- `conflict` и `server_version` в ответе сейчас не используются как основной runtime-путь

---

## GET /documents/snapshot

Вернуть актуальное состояние одного документа.

### Query params

- `vault_id`
- `path`

### Response

```json
{
  "path": "notes/test.md",
  "version": 4,
  "deleted": false,
  "content_b64": "AAECAwQ=",
  "hash": "f2d2b0e86e5c..."
}
```

---

## GET /documents/changes

Вернуть change feed документации vault после заданного `seq`.

### Query params

- `vault_id`
- `since` опционален, по умолчанию `0`

### Response

```json
{
  "changes": [
    {
      "seq": 12,
      "device_id": "desktop_main",
      "path": "notes/test.md",
      "version": 4,
      "deleted": false
    }
  ],
  "latest_seq": 12
}
```

### Примечания

- change feed сообщает только факт изменения документа
- сам payload документа читается отдельно через `GET /documents/snapshot`

---

## GET /documents/history

Вернуть сохранённую историю версий одного документа.

### Query params

- `vault_id`
- `path`

### Response

```json
{
  "path": "notes/test.md",
  "versions": [
    {
      "version": 4,
      "hash": "f2d2b0e86e5c...",
      "snapshot_b64": "AAECAwQ=",
      "deleted": false,
      "created_at": "2026-03-26T12:05:00Z"
    }
  ]
}
```

### Примечания

- `snapshot_b64` хранит snapshot версии документа в том виде, как он был записан сервером

---

## POST /documents/restore

Создать новую актуальную версию документа на основе сохранённой исторической версии.

### Request

```json
{
  "vault_id": "product_docs",
  "device_id": "desktop_main",
  "path": "notes/test.md",
  "target_version": 2
}
```

### Response

```json
{
  "ok": true,
  "version": 5
}
```

### Примечания

- restore не переписывает старую запись, а создаёт новую head-версию
- restored version также попадает в `document_changes` и историю версий

---

## GET /events

Realtime SSE-канал для уведомления о новых изменениях по vault.

### Query params

- `vault_id`
- `since` опционален, по умолчанию `0`

### Event payload

```json
{
  "latest_seq": 12
}
```

### Примечания

- событие приходит с типом `change`
- если `latest_seq > since`, сервер может отправить первое событие сразу после подписки
- клиент должен после сигнала вызвать `GET /documents/changes`
