# DEPRECATED: EXAMPLE_SYNC

## Статус документа

Deprecated.

Этот файл не описывает текущую реализацию репозитория.
Он сохранён как учебный и исторический пример минимального sync-движка.

Использовать его как документацию к реальному коду нельзя:

- в примере нет multi-vault
- в примере нет device registry
- в примере нет E2EE
- в примере нет history/restore
- в примере нет SSE realtime

Для реального проекта см.:

- [API.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/API.md)
- [PLUGIN_USAGE.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/PLUGIN_USAGE.md)
- [MVP.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/MVP.md)

---

## Зачем файл оставлен

Он всё ещё полезен как короткий conceptual prototype:

- показывает local-first sync-идею
- объясняет change feed и conflict copy на минимальном примере
- годится для обсуждения архитектуры без деталей production-кода

Но любые интеграционные решения нужно принимать только по актуальным документам и коду.
