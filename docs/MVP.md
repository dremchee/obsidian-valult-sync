# MVP

## Статус

Изначальный whole-file MVP больше не описывает текущую систему.

После cutover актуальная базовая модель такая:

- document-first sync на базе Loro payload
- сервер хранит текущий snapshot документа, историю версий и change feed
- клиент синхронизирует документы и только на границе с Obsidian пишет `.md`

Этот документ фиксирует, что сейчас считается минимально рабочей версией системы.

---

## Текущее ядро системы

Система должна обеспечивать:

- синхронизацию одного vault между несколькими устройствами
- стабильный реестр vault и устройств
- document change feed и realtime wake-up через SSE
- историю версий документа на сервере
- restore документа на предыдущую версию
- устойчивое локальное состояние клиента
- include/ignore scope на клиенте

---

## Текущая продуктовая модель

### Vault model

- одна локальная папка Obsidian подключается к одному `vaultId`
- сервер хранит отдельные пространства по `vault_id`
- один и тот же путь может существовать независимо в разных vault

### Document model

- документ идентифицируется парой `vault_id + path`
- контент синхронизируется как Loro payload
- сервер ведёт текущий head, историю и `document_changes`
- `deleted: true` представляет tombstone

### Client model

- plugin строит локальное состояние по `documents`
- удалённые изменения читаются через `changes + snapshot`
- markdown на диске остаётся пользовательским представлением документа

---

## Что остаётся вне текущего scope

- rename detection как отдельная сущность
- server-side selective sync
- multi-user auth flow
- chunked blob storage
- server-side semantic merge beyond Loro payload import

---

## Что считать успехом

Практически значимая версия системы считается рабочей, если:

- два и более клиента могут синхронизировать один vault через сервер
- vault можно создать или обнаружить через серверный реестр
- realtime-сигналы ускоряют доставку изменений, а polling остаётся fallback
- история документа доступна из plugin UI
- restore создаёт новую актуальную серверную версию без потери истории
- после рестарта клиента локальное document state не теряется

---

## Связанные документы

- Архитектура: [ARCHITECTURE.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/ARCHITECTURE.md)
- API: [API.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/API.md)
- Plugin usage: [PLUGIN_USAGE.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/PLUGIN_USAGE.md)
- Регрессионный чеклист: [MVP_CHECKLIST.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/MVP_CHECKLIST.md)
