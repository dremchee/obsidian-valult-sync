# DEPRECATED: INSPIRATION

## Статус документа

Deprecated.

Этот файл содержит архитектурные идеи и product/design-размышления.
Он не является актуальной спецификацией текущего репозитория.

Использовать его как источник истины для реализации не нужно.
Для актуального состояния проекта см.:

- [API.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/API.md)
- [PLUGIN_USAGE.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/PLUGIN_USAGE.md)
- [MVP.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/MVP.md)

---

Я подготовлю **более подробную архитектурную версию** — почти как **дизайн-документ системы синхронизации** (как это пишут в Dropbox / Google). Разберём:

1. Полный pipeline синхронизации
2. Формат метаданных
3. Алгоритм sync loop
4. Алгоритм конфликтов
5. Версионирование
6. Сетевой протокол
7. Offline режим
8. Масштабирование сервера

---

# 1. Полный pipeline синхронизации

Полный цикл выглядит так:

```
filesystem change
      ↓
file watcher event
      ↓
metadata update
      ↓
sync queue
      ↓
delta creation
      ↓
encryption
      ↓
upload to server
      ↓
server version update
      ↓
change feed update
      ↓
other devices download
```

Это называется **event-driven file synchronization**.

---

# 2. Архитектура клиента

Клиент обычно состоит из нескольких сервисов.

```
┌──────────────────────────────┐
│          Obsidian            │
├──────────────────────────────┤
│ File Watcher                 │
│ Local Metadata DB            │
│ Sync Engine                  │
│ Encryption Module            │
│ Network Client               │
└───────────────┬──────────────┘
                │
            HTTPS API
                │
┌───────────────▼──────────────┐
│        Sync Server           │
├──────────────────────────────┤
│ Auth Service                 │
│ Sync API                     │
│ Version Manager              │
│ Object Storage               │
│ Change Feed                  │
└──────────────────────────────┘
```

---

# 3. Local metadata database

Каждый клиент хранит **локальную базу синка**.

Обычно SQLite.

```
sync_state.db
```

### таблица файлов

```
files
```

| поле        | описание         |
| ----------- | ---------------- |
| path        | путь             |
| hash        | hash содержимого |
| version     | версия           |
| modified_at | timestamp        |
| sync_status | synced/pending   |

пример:

```
notes/ai.md
hash=3c8fa...
version=21
status=synced
```

---

# 4. File hashing

Когда файл изменяется:

```
new_hash = SHA256(file)
```

если

```
new_hash != stored_hash
```

файл ставится в очередь синка.

Hash нужен для:

- deduplication
- conflict detection
- integrity check

---

# 5. Sync queue

Sync engine использует **очередь задач**.

```
sync_queue = [
  upload(notes/ai.md),
  upload(todo.md)
]
```

Работает background worker.

```
while true:
    task = queue.pop()
    process(task)
```

---

# 6. Delta алгоритм

Есть два варианта.

### вариант A — простой

отправлять весь файл.

```
upload(file)
```

Для markdown это нормально:

```
1–10 KB
```

---

### вариант B — chunked sync

Файл делится на блоки.

```
file
├ chunk1
├ chunk2
└ chunk3
```

hash каждого блока:

```
hash(chunk)
```

сервер проверяет какие блоки уже есть.

Это используется в:

- Dropbox
- Google Drive

---

# 7. Encryption pipeline

Если включён E2EE.

```
plaintext file
      ↓
compression
      ↓
encryption
      ↓
upload
```

пример:

```
ciphertext = AES_GCM(file, key)
```

ключ:

```
vault_key = derive(password)
```

обычно через:

```
PBKDF2 / Argon2
```

---

# 8. Upload protocol

Клиент делает запрос:

```
POST /sync/upload
```

payload:

```
{
 vault_id
 device_id
 path
 version
 hash
 encrypted_blob
}
```

сервер:

```
verify
store
update version
```

---

# 9. Server storage architecture

Файлы обычно лежат в **object storage**.

например:

```
S3 / GCS
```

структура:

```
vault_id
   ├ file_id
   │    ├ v1
   │    ├ v2
   │    └ v3
```

---

# 10. Version manager

Каждый файл имеет **monotonic version**.

```
version++
```

пример:

```
ai.md v10
ai.md v11
ai.md v12
```

сервер хранит mapping:

```
file_path -> latest_version
```

---

# 11. Change feed

Чтобы клиент не скачивал всё.

есть endpoint:

```
GET /changes
```

пример ответа:

```
[
 {path:"ai.md", version:21},
 {path:"todo.md", version:4}
]
```

Клиент сравнивает:

```
local_version
remote_version
```

---

# 12. Download pipeline

Если версия новее:

```
GET /download
```

pipeline:

```
download
 ↓
decrypt
 ↓
write file
 ↓
update metadata
```

---

# 13. Conflict detection

Конфликт возникает если:

```
local_version != server_version
```

и файл изменён.

пример:

```
server: v10
device A upload -> v11
device B upload -> conflict
```

алгоритм:

```
create conflict copy
```

```
note.md
note (conflict deviceB).md
```

---

# 14. Offline sync

Если нет сети.

изменения записываются:

```
sync_queue
```

при восстановлении сети:

```
retry uploads
```

---

# 15. Ordering problem

Если 3 устройства.

```
A
B
C
```

каждое может изменить файл.

поэтому сервер — **source of truth**.

Он назначает версии.

---

# 16. Partial sync

Пользователь может отключить:

```
videos
attachments
plugins
```

поэтому сервер поддерживает:

```
file filters
```

---

# 17. Polling vs realtime

Есть два варианта.

### polling

```
GET /changes every 30s
```

---

### websocket

```
push update
```

Dropbox использует push.

---

# 18. Сложные части системы

Самые сложные задачи:

### 1️⃣ race conditions

```
two devices modify simultaneously
```

---

### 2️⃣ network failures

```
upload interrupted
```

---

### 3️⃣ file rename

```
rename vs delete
```

---

### 4️⃣ atomic writes

```
write temp file
rename
```

---

# 19. Минимальный sync алгоритм

Псевдокод:

```
loop:

 detect_local_changes()

 upload_changes()

 remote_changes = get_changes()

 download_changes(remote_changes)

 sleep(5)
```

---

# 20. Почему Obsidian Sync проще Notion

Notion:

```
CRDT
realtime editing
document model
```

Obsidian:

```
file sync
event driven
```

Поэтому система намного проще.

---

✅ **Итог**

Архитектура Obsidian Sync — это классическая **file synchronization system**:

- local-first
- event driven
- metadata database
- versioned object storage
- optional end-to-end encryption

По сути это **Dropbox-like sync engine для Markdown файлов**.

---

Если хочешь, могу ещё разобрать очень интересные вещи:

1️⃣ **как Dropbox уменьшил sync с 60 секунд до 300 ms**
2️⃣ **как устроен SyncThing (самый крутой open-source sync)**
3️⃣ **как написать свой sync-движок за ~300 строк кода** (это реально очень крутая инженерная задача).
