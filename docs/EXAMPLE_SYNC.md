Да. Ниже — **минимальный sync-движок** в стиле “Dropbox для папки с Markdown-файлами”, который реально можно собрать примерно за **250–350 строк Python**.

Это не production-ready система, а **учебный local-first file sync prototype** с такими свойствами:

- следит за папкой
- вычисляет хэши файлов
- хранит локальное состояние
- загружает изменения на сервер
- скачивает изменения с сервера
- решает конфликты через conflict copy

Не будет:

- realtime push
- бинарных дельт
- E2EE
- rename detection
- блокировок
- идеальной обработки гонок

Но как архитектурный каркас — очень хороший.

---

# Идея архитектуры

Есть 2 части:

1. **клиент**
   - сканирует локальную папку
   - сравнивает файлы с локальной SQLite БД
   - отправляет изменения на сервер
   - периодически спрашивает сервер про новые версии

2. **сервер**
   - хранит файлы и метаданные
   - отдаёт список изменений
   - принимает upload

---

# Минимальный протокол

## upload

Клиент шлёт:

```json
{
  "path": "notes/test.md",
  "content": "base64...",
  "hash": "sha256...",
  "base_version": 3
}
```

## server response

```json
{
  "ok": true,
  "version": 4
}
```

или конфликт:

```json
{
  "ok": false,
  "conflict": true,
  "server_version": 5
}
```

## changes

Клиент спрашивает:

```http
GET /changes?since=42
```

Сервер отвечает:

```json
{
  "changes": [{ "path": "notes/test.md", "version": 5 }],
  "latest_seq": 43
}
```

---

# Что хранить локально

SQLite таблица:

```sql
CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    hash TEXT NOT NULL,
    version INTEGER NOT NULL,
    mtime REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

`files` — состояние файлов.
`meta.last_seq` — последний обработанный change feed.

---

# Минимальный сервер на FastAPI

## `server.py`

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from pathlib import Path
import sqlite3
import hashlib
import base64
import os

ROOT = Path("server_storage")
ROOT.mkdir(exist_ok=True)
DB_PATH = ROOT / "sync.db"

app = FastAPI()


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = db()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        version INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS changes (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        version INTEGER NOT NULL
    );
    """)
    conn.commit()
    conn.close()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_path(rel_path: str) -> Path:
    p = (ROOT / "files" / rel_path).resolve()
    base = (ROOT / "files").resolve()
    if not str(p).startswith(str(base)):
        raise HTTPException(status_code=400, detail="invalid path")
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


class UploadReq(BaseModel):
    path: str
    content_b64: str
    hash: str
    base_version: int


@app.get("/changes")
def get_changes(since: int = 0):
    conn = db()
    rows = conn.execute(
        "SELECT seq, path, version FROM changes WHERE seq > ? ORDER BY seq",
        (since,)
    ).fetchall()
    latest = conn.execute("SELECT COALESCE(MAX(seq), 0) AS x FROM changes").fetchone()["x"]
    conn.close()
    return {
        "changes": [dict(r) for r in rows],
        "latest_seq": latest,
    }


@app.get("/file")
def get_file(path: str):
    conn = db()
    row = conn.execute(
        "SELECT path, hash, version FROM files WHERE path = ?",
        (path,)
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="not found")

    file_path = safe_path(path)
    data = file_path.read_bytes()
    return {
        "path": path,
        "hash": row["hash"],
        "version": row["version"],
        "content_b64": base64.b64encode(data).decode(),
    }


@app.post("/upload")
def upload_file(req: UploadReq):
    data = base64.b64decode(req.content_b64)
    actual_hash = sha256_bytes(data)
    if actual_hash != req.hash:
        raise HTTPException(status_code=400, detail="hash mismatch")

    conn = db()
    row = conn.execute(
        "SELECT version, hash FROM files WHERE path = ?",
        (req.path,)
    ).fetchone()

    current_version = row["version"] if row else 0

    if req.base_version != current_version:
        conn.close()
        return {
            "ok": False,
            "conflict": True,
            "server_version": current_version,
        }

    new_version = current_version + 1
    file_path = safe_path(req.path)
    file_path.write_bytes(data)

    conn.execute("""
        INSERT INTO files(path, hash, version)
        VALUES (?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
            hash = excluded.hash,
            version = excluded.version
    """, (req.path, req.hash, new_version))
    conn.execute(
        "INSERT INTO changes(path, version) VALUES (?, ?)",
        (req.path, new_version)
    )
    conn.commit()
    conn.close()

    return {"ok": True, "version": new_version}


init_db()
```

Запуск:

```bash
pip install fastapi uvicorn pydantic
uvicorn server:app --reload --port 8000
```

---

# Клиент примерно на 200 строк

## `client.py`

```python
import os
import time
import json
import base64
import sqlite3
import hashlib
from pathlib import Path

import requests

VAULT = Path("vault")
DB_PATH = Path("client_state.db")
SERVER = "http://127.0.0.1:8000"

VAULT.mkdir(exist_ok=True)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = db()
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        version INTEGER NOT NULL,
        mtime REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """)
    conn.execute("""
        INSERT OR IGNORE INTO meta(key, value) VALUES ('last_seq', '0')
    """)
    conn.commit()
    conn.close()


def get_meta(key: str, default: str = "") -> str:
    conn = db()
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else default


def set_meta(key: str, value: str):
    conn = db()
    conn.execute("""
        INSERT INTO meta(key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    """, (key, value))
    conn.commit()
    conn.close()


def list_local_files():
    result = []
    for p in VAULT.rglob("*"):
        if p.is_file():
            rel = p.relative_to(VAULT).as_posix()
            result.append((rel, p))
    return result


def read_file_info(p: Path):
    data = p.read_bytes()
    return {
        "hash": sha256_bytes(data),
        "mtime": p.stat().st_mtime,
        "data": data,
    }


def load_local_record(path: str):
    conn = db()
    row = conn.execute(
        "SELECT path, hash, version, mtime FROM files WHERE path = ?",
        (path,)
    ).fetchone()
    conn.close()
    return row


def save_local_record(path: str, file_hash: str, version: int, mtime: float):
    conn = db()
    conn.execute("""
        INSERT INTO files(path, hash, version, mtime)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
            hash = excluded.hash,
            version = excluded.version,
            mtime = excluded.mtime
    """, (path, file_hash, version, mtime))
    conn.commit()
    conn.close()


def upload_local_changes():
    for rel_path, full_path in list_local_files():
        info = read_file_info(full_path)
        row = load_local_record(rel_path)

        if row and row["hash"] == info["hash"]:
            continue

        base_version = row["version"] if row else 0

        payload = {
            "path": rel_path,
            "content_b64": base64.b64encode(info["data"]).decode(),
            "hash": info["hash"],
            "base_version": base_version,
        }

        r = requests.post(f"{SERVER}/upload", json=payload, timeout=10)
        r.raise_for_status()
        res = r.json()

        if res.get("ok"):
            save_local_record(
                rel_path,
                info["hash"],
                res["version"],
                info["mtime"]
            )
            print(f"[upload] {rel_path} -> v{res['version']}")
        elif res.get("conflict"):
            resolve_conflict(rel_path, full_path)
        else:
            print(f"[upload] unknown response for {rel_path}: {res}")


def resolve_conflict(rel_path: str, full_path: Path):
    r = requests.get(f"{SERVER}/file", params={"path": rel_path}, timeout=10)
    r.raise_for_status()
    remote = r.json()
    remote_data = base64.b64decode(remote["content_b64"])

    local_data = full_path.read_bytes()

    conflict_name = full_path.with_name(full_path.stem + " (conflict)" + full_path.suffix)
    conflict_name.write_bytes(local_data)

    full_path.write_bytes(remote_data)

    remote_hash = sha256_bytes(remote_data)
    mtime = full_path.stat().st_mtime
    save_local_record(rel_path, remote_hash, remote["version"], mtime)

    print(f"[conflict] {rel_path} -> remote applied, local saved as {conflict_name.name}")


def download_remote_changes():
    last_seq = int(get_meta("last_seq", "0"))
    r = requests.get(f"{SERVER}/changes", params={"since": last_seq}, timeout=10)
    r.raise_for_status()
    res = r.json()

    changes = res["changes"]
    if not changes:
        set_meta("last_seq", str(res["latest_seq"]))
        return

    for change in changes:
        rel_path = change["path"]
        remote_version = change["version"]

        row = load_local_record(rel_path)
        local_version = row["version"] if row else 0

        if local_version >= remote_version:
            continue

        rr = requests.get(f"{SERVER}/file", params={"path": rel_path}, timeout=10)
        rr.raise_for_status()
        remote = rr.json()

        target = VAULT / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)

        if target.exists():
            local_info = read_file_info(target)
            if row and local_info["hash"] != row["hash"]:
                conflict_name = target.with_name(target.stem + " (local-conflict)" + target.suffix)
                conflict_name.write_bytes(local_info["data"])
                print(f"[download-conflict] saved local copy: {conflict_name}")

        remote_data = base64.b64decode(remote["content_b64"])
        target.write_bytes(remote_data)
        mtime = target.stat().st_mtime
        save_local_record(rel_path, remote["hash"], remote["version"], mtime)
        print(f"[download] {rel_path} -> v{remote['version']}")

    set_meta("last_seq", str(res["latest_seq"]))


def initial_index():
    for rel_path, full_path in list_local_files():
        info = read_file_info(full_path)
        row = load_local_record(rel_path)
        if not row:
            save_local_record(rel_path, info["hash"], 0, info["mtime"])


def loop():
    init_db()
    initial_index()
    while True:
        try:
            upload_local_changes()
            download_remote_changes()
        except Exception as e:
            print("[error]", e)
        time.sleep(2)


if __name__ == "__main__":
    loop()
```

---

# Как это работает

## 1. Индексация

Клиент обходит `vault/` и пишет состояние файлов в SQLite.

## 2. Upload

Если локальный хэш отличается от сохранённого, клиент отправляет файл на сервер.

## 3. Серверная версия

Сервер принимает файл только если `base_version == current_version`.

Это очень важная идея:
**optimistic concurrency control**.

## 4. Conflict

Если кто-то уже успел обновить файл на сервере, сервер возвращает конфликт.

Клиент:

- скачивает серверную версию
- сохраняет свою локальную как `(... conflict).md`
- применяет серверную как основную

## 5. Download

Клиент периодически читает `/changes` и подтягивает новые версии.

---

# Почему это уже похоже на настоящий sync engine

Потому что в нём уже есть базовые кирпичики реальной системы:

- local-first storage
- content hashing
- versioning
- optimistic concurrency
- conflict copies
- change feed
- polling loop
- persistent client state

---

# Что в этом примере упрощено

## Удаления

Пока не реализованы. Нужен tombstone:

```sql
deleted INTEGER NOT NULL DEFAULT 0
```

и отдельное событие удаления.

## Rename detection

Сейчас rename будет выглядеть как:

- новый файл
- старый файл удалён

Для учебного движка это нормально.

## Дельты

Пока гоняем целый файл. Для Markdown обычно ок.

## Шифрование

Можно добавить перед `base64`:

```python
ciphertext = encrypt(data, key)
```

## Push вместо polling

Сейчас клиент делает poll раз в 2 секунды. В проде можно перейти на WebSocket/SSE.

---

# Как уложиться в ~300 строк и не утонуть

Нужно специально **не делать слишком много**. Оставь только:

- один vault
- один пользователь
- polling
- целиковые файлы
- SQLite
- conflict copy
- без удаления на первом этапе

Тогда система получается маленькой и понятной.

---

# Пошаговый план разработки

## Этап 1

Сервер:

- `POST /upload`
- `GET /file`

Клиент:

- сканирование папки
- upload изменённых файлов

## Этап 2

Сервер:

- `GET /changes`

Клиент:

- download remote changes

## Этап 3

Добавить:

- `base_version`
- conflict handling

## Этап 4

Добавить:

- delete tombstones
- encryption
- backoff/retry

---

# Какие инженерные идеи тут самые важные

Самое главное здесь не код, а 4 концепции:

## 1. Хэш — это идентичность содержимого

Не доверяй только `mtime`.

## 2. Версия — это защита от перезаписи

Нельзя просто “последний upload победил” без проверки.

## 3. Локальное состояние должно быть устойчивым

Иначе после перезапуска клиент забудет, что уже синкнул.

## 4. Конфликт лучше сохранить явно

Для заметок это часто лучше, чем неявный merge.

---

# Что делать дальше

После такого прототипа следующий апгрейд обычно такой:

1. добавить delete/tombstones
2. добавить WebSocket push
3. добавить AES-GCM
4. добавить chunked upload
5. добавить merge для текстовых файлов

---

# Самая короткая ментальная модель

Твой sync engine — это по сути:

```python
while True:
    detect_local_changes()
    upload_with_base_version()
    fetch_remote_change_feed()
    download_new_versions()
    handle_conflicts()
    sleep(2)
```

Если хочешь, я могу в следующем сообщении дать **улучшенную версию этого прототипа с удалениями и E2EE**, всё ещё компактную.
