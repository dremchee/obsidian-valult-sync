# E2EE

## Цель

Добавить end-to-end encryption без изменения базовой sync-модели:

- сервер остаётся blob-store и change-feed
- ключевой материал не уходит на сервер
- конфликтная модель `base_version` сохраняется

На первом этапе E2EE шифруется только содержимое файла. `path`, `vault_id`, `device_id`,
`version` и tombstone-метаданные остаются видимыми серверу.

Это осознанный компромисс:

- внедрение не ломает текущие индексы и `GET /file?path=...`
- selective sync и conflict handling продолжают работать почти без изменений
- сервер всё ещё видит структуру vault, но не видит содержимое заметок

---

## Формат encrypted payload

Содержимое файла перед upload сериализуется как JSON envelope:

```json
{
  "v": 1,
  "alg": "AES-GCM-256",
  "kdf": "PBKDF2-SHA-256",
  "iterations": 600000,
  "salt_b64": "...",
  "iv_b64": "...",
  "ciphertext_b64": "..."
}
```

Затем весь envelope кодируется как UTF-8 и уже в таком виде идёт в существующее поле
`content_b64`.

### Поля

- `v`: версия envelope
- `alg`: алгоритм симметричного шифрования
- `kdf`: derivation для ключа из passphrase
- `iterations`: параметр PBKDF2
- `salt_b64`: случайная соль
- `iv_b64`: nonce для AES-GCM
- `ciphertext_b64`: шифротекст вместе с GCM tag

---

## Криптография v1

- шифрование: `AES-GCM-256`
- derivation: `PBKDF2-HMAC-SHA-256`
- соль: `16` байт
- nonce/IV: `12` байт
- итерации PBKDF2: `600000`

Passphrase вводится пользователем на клиенте. Из неё локально выводится content key.
В текущей реализации passphrase хранится только в памяти текущей Obsidian session и не
пишется в persisted plugin data.

---

## Интеграция по шагам

### Шаг 1

- зафиксировать envelope format
- добавить plugin-side encrypt/decrypt helpers
- покрыть round-trip тестами

### Шаг 2

- добавить plugin setting для E2EE passphrase
- при upload шифровать содержимое перед `content_b64`
- при download распознавать envelope и расшифровывать локально
- расширить API полями `content_format` и `payload_hash`, чтобы сервер мог
  валидировать ciphertext, а клиент продолжал жить на plaintext hash

### Шаг 3

- добавить UI для wrong passphrase / missing passphrase
- сохранить fingerprint derived key локально для более явной валидации

### Шаг 4

- решить, нужен ли второй режим со скрытием `path`
- если нужен, это уже отдельная server-side protocol change

---

## Ограничения v1

- сервер видит `path` и частоту изменений
- hash в текущем протоколе должен стать hash от plaintext, если хотим локально
  сохранять стабильную идентичность содержимого для conflict logic
- разные устройства должны использовать одну и ту же passphrase

---

## Решение для текущего репозитория

В этом репозитории E2EE начинается с content-only модели. Это самый дешёвый путь к
практической защите данных без переписывания storage и change feed.
