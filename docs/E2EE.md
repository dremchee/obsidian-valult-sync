# E2EE

## Статус

Content-only E2EE уже реализован в текущем plugin и серверном API.

Это означает:

- сервер остаётся blob-store и change-feed
- ключевой материал не уходит на сервер
- конфликтная модель `base_version` не меняется
- шифруется только содержимое файла

Сервер по-прежнему видит:

- `vault_id`
- `device_id`
- `path`
- версии
- частоту изменений
- факт удаления файла

---

## Формат payload

Зашифрованное содержимое передаётся как JSON envelope, сериализованный в UTF-8 и затем
закодированный в `content_b64`.

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

`content_format` для такого payload всегда равен `e2ee-envelope-v1`.

---

## Криптография v1

- шифрование: `AES-GCM-256`
- KDF: `PBKDF2-HMAC-SHA-256`
- итерации: `600000`
- соль: `16` байт
- IV: `12` байт

Passphrase задаётся пользователем на клиенте. Из неё локально выводится content key.

---

## Hash-модель

Текущий протокол различает два хэша:

- `hash` это hash plaintext содержимого
- `payload_hash` это hash фактически отправляемого encrypted envelope

Это позволяет:

- не раскрывать plaintext серверу
- сохранить устойчивую клиентскую логику по содержимому
- отдельно валидировать, что ciphertext доехал без искажений

Для plaintext-файлов `hash == payload_hash`.

---

## Fingerprint passphrase

Plugin не сохраняет саму passphrase в persisted plugin data.

Вместо этого используется fingerprint:

- fingerprint вычисляется как `SHA-256("obsidian-sync:e2ee-fingerprint:v1:{vaultId}\n{passphrase}")`
- fingerprint сохраняется локально
- сама passphrase живёт только в памяти текущей Obsidian session

Это даёт три полезных свойства:

- секрет не пишется на диск в plugin data
- можно отличить `passphrase не введена` от `введена неверная passphrase`
- можно валидировать, что устройство использует тот же ключ для конкретного `vault_id`

---

## Серверная сторона

Сервер не расшифровывает payload и не знает passphrase.

Сервер:

- принимает encrypted payload как blob
- валидирует только `payload_hash`
- хранит `content_format`
- сохраняет историю версий и умеет restore без расшифровки

Restore работает и для encrypted-файлов, потому что сервер оперирует сохранёнными байтами
версии, не трогая их содержимое.

---

## UX-сценарии

### Создание vault

В текущем UI создание vault требует E2EE passphrase.
Plugin:

- вычисляет fingerprint
- отправляет его в `POST /vaults`
- сохраняет passphrase в памяти текущей сессии

### Join существующего vault

Plugin просит E2EE passphrase при присоединении.

Если в vault уже есть encrypted content, plugin:

- скачивает один из зашифрованных файлов
- пытается локально его расшифровать
- в случае ошибки не завершает join

Если encrypted content ещё нет, join возможен без такой проверки.

### Первый encrypted sync

Если fingerprint ещё не сохранён, plugin запоминает его после первой успешной валидации
или первой успешной encrypted sync-операции.

---

## Ограничения текущей версии

- сервер видит структуру vault и пути файлов
- tombstone не шифруются
- для всех устройств одного vault нужна одна и та же passphrase
- автоматическая ротация ключа не реализована
- отдельного server-side режима со скрытием `path` пока нет

---

## Что важно для совместимости

Клиент и сервер должны согласованно использовать:

- `content_format = e2ee-envelope-v1`
- `hash = plaintext hash`
- `payload_hash = ciphertext hash`

Если один клиент будет слать encrypted payload, а другой ожидать plaintext, sync корректно
не сойдётся.
