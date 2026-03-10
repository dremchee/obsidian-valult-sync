# API

## Назначение

Этот документ фиксирует контракт MVP sync-сервера. Он должен быть единственным источником истины для клиента и сервера, пока протокол не изменён отдельным решением.

Все примеры ниже относятся к первой версии API.

---

## Общие правила

### Transport

- протокол: `HTTP/JSON`
- кодировка содержимого файла: `base64`
- сервер отвечает `application/json`
- при включённом `AUTH_TOKEN` или `AUTH_TOKENS` сервер ожидает `Authorization: Bearer <token>`
- `AUTH_TOKENS` может содержать несколько токенов через запятую

### Идентификация файла

- каждый файл принадлежит логическому `vault_id`
- файл идентифицируется по `path`
- `path` это относительный путь внутри vault
- путь должен использовать `/`
- путь не должен позволять выход за пределы storage root

Пример корректного пути:

```text
notes/daily/2026-03-10.md
```

Пример некорректного пути:

```text
../../etc/passwd
```

### Versioning

- сервер хранит монотонно растущую `version` для каждого файла
- версии изолированы внутри одного `vault_id`
- клиент отправляет `base_version`
- если `base_version` не совпадает с текущей серверной версией, запись отклоняется как conflict

### Deletions

- удаление считается отдельным событием
- удаление повышает `version`
- удаление отражается в `changes`

---

## Error model

### Общие HTTP коды

- `200 OK` для успешных `GET`
- `201 Created` не используем, достаточно `200 OK`
- `400 Bad Request` для невалидного payload или path
- `404 Not Found` если файла не существует
- `409 Conflict` не используем как основной transport для stale write

Для конфликтов в MVP сервер возвращает `200 OK` и JSON с `conflict: true`, чтобы упростить клиентскую обработку.

### Общий формат ошибки

```json
{
  "error": "invalid_path",
  "message": "path is invalid"
}
```

Рекомендуемые значения `error`:

- `invalid_path`
- `invalid_base64`
- `hash_mismatch`
- `not_found`
- `unauthorized`
- `internal_error`

---

## GET /health

### Назначение

Проверка, что сервер запущен.

### Response

```json
{
  "ok": true
}
```

---

## POST /upload

### Назначение

Создать новую версию файла или загрузить новый файл.

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

### Поля

- `path: string`
- `vault_id: string`
- `device_id: string`
- `content_b64: string`
- `hash: string`
- `payload_hash: string`
- `content_format: "plain" | "e2ee-envelope-v1"`
- `base_version: integer`

Для E2EE upload:

- `hash` это hash plaintext содержимого
- `payload_hash` это hash фактически загружаемого payload
- `content_format` должен быть `e2ee-envelope-v1`

Для plaintext upload:

- `hash == payload_hash`
- `content_format` должен быть `plain`

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

### Ошибки

`400 Bad Request`

```json
{
  "error": "hash_mismatch",
  "message": "provided hash does not match content"
}
```

---

## GET /file

### Назначение

Вернуть актуальную серверную версию файла.

### Query parameters

```text
vault_id=default&path=notes/test.md
```

### Успешный response

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

### Ошибки

`404 Not Found`

```json
{
  "error": "not_found",
  "message": "file not found"
}
```

---

## GET /changes

### Назначение

Вернуть список изменений, произошедших после указанного `seq`.

### Query parameters

```text
vault_id=default&since=42
```

### Успешный response

```json
{
  "changes": [
    {
      "seq": 43,
      "device_id": "device_local_desktop",
      "path": "notes/test.md",
      "version": 5,
      "deleted": false
    },
    {
      "seq": 44,
      "path": "notes/old.md",
      "version": 3,
      "deleted": true
    }
  ],
  "latest_seq": 44
}
```

### Поля `changes[]`

- `seq: integer`
- `device_id: string`
- `path: string`
- `version: integer`
- `deleted: boolean`

### Поведение

- сервер возвращает события в порядке возрастания `seq`
- если новых изменений нет, `changes` возвращается пустым массивом
- `latest_seq` должен возвращаться всегда

Пример без новых изменений:

```json
{
  "changes": [],
  "latest_seq": 44
}
```

---

## GET /devices

### Назначение

Вернуть список устройств, которые уже отправляли изменения в указанный `vault_id`.

Это минимальная device model для последующего UI и управления устройствами.

### Query parameters

```text
vault_id=default
```

### Успешный response

```json
{
  "devices": [
    {
      "device_id": "device_local_desktop",
      "first_seen_at": "2026-03-10T12:00:00+00:00",
      "last_seen_at": "2026-03-10T12:05:00+00:00"
    }
  ]
}
```

### Поля `devices[]`

- `device_id: string`
- `first_seen_at: string`
- `last_seen_at: string`

---

## POST /delete

### Назначение

Удалить файл через tombstone и повысить его версию.

### Request

```json
{
  "vault_id": "default",
  "device_id": "device_local_desktop",
  "path": "notes/test.md",
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

### Ошибки

`404 Not Found`

```json
{
  "error": "not_found",
  "message": "file not found"
}
```

---

## Ожидаемое поведение клиента

### Upload flow

1. клиент считает `hash`
2. клиент берёт локальный `version`
3. клиент отправляет `POST /upload`
4. при `ok: true` сохраняет новую версию
5. при `conflict: true` запускает conflict handling

### Download flow

1. клиент читает `last_seq`
2. делает `GET /changes`
3. по каждому изменению сравнивает локальную и удалённую версию
4. если `deleted = true`, применяет удаление
5. иначе скачивает `/file`
6. после успешного применения обновляет `last_seq`

### Conflict flow

1. клиент получает `conflict: true`
2. запрашивает актуальную серверную версию через `GET /file`
3. сохраняет локальную копию как conflict file
4. серверную версию записывает как основную

---

## Версионирование API

В MVP отдельный version prefix не вводим.

Если протокол начнёт ломать обратную совместимость, следующий шаг:

- либо `/v1/...`
- либо явная миграция клиента и сервера в одном релизном цикле
