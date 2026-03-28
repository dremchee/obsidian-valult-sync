# DEPRECATED: Implementation Plan

## Статус документа

Deprecated.

Этот файл сохранён только как историческая заметка о том, с какого типа решения проект
стартовал. Он не описывает текущую реализацию и не должен использоваться как план работ.

Для актуального поведения проекта используйте:

- [ARCHITECTURE.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/ARCHITECTURE.md)
- [API.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/API.md)
- [PLUGIN_USAGE.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/PLUGIN_USAGE.md)

---

## Исторический контекст

Изначальная архитектурная идея была такой:

- синхронизировать markdown-файлы как отдельные file records
- хранить server-side versions для каждого `path`
- ловить гонки через explicit conflict detection
- отдавать клиенту change feed и держать модель максимально простой

Эта схема была полезна как стартовая стадия, но после перехода на document-first sync больше не
совпадает с текущей системой.

---

## Что в этом документе больше неактуально

Следующие идеи теперь считаются legacy:

- whole-file sync как основная модель
- отдельные upload/delete/rename endpoints
- `base_version` как базовый способ разрешения гонок
- conflict copies как основной пользовательский сценарий
- отдельный file-version слой как source of truth

---

## Что осталось полезным

Документ всё ещё полезен только в двух случаях:

- чтобы понять, почему проект изначально строился вокруг change feed и локального state
- чтобы сравнить старую file-sync модель с текущей document-first архитектурой

Если нужна текущая схема, смотреть нужно не сюда, а в [ARCHITECTURE.md](/Users/dremchee/Work/Projects/app/obsidian-vault-sync/docs/ARCHITECTURE.md).
