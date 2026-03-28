# Plugin UX Flow

## Назначение

Этот документ описывает текущий пользовательский сценарий для UI plugin:
от первого запуска до подключения папки к vault и первого sync.

---

## Базовая модель

Одна локальная Obsidian-папка должна быть связана только с одним logical sync vault.

С точки зрения UX это означает четыре явных действия:

- `Create vault`
- `Join server vault`
- `Disconnect`
- `Forget local state`

---

## Основной flow

1. Пользователь устанавливает plugin в `.obsidian/plugins/obsidian-sync-plugin/`.
2. Включает plugin в `Community plugins`.
3. Открывает настройки plugin.
4. В секции `Connection` вводит:
   - `Server URL`
   - `Auth token`
5. При необходимости проверяет `Device ID`, `Poll interval`, `Auto sync`.
6. Нажимает `Check`.
7. После успешной проверки plugin разблокирует остальную конфигурацию.
8. В секции `Vault` plugin автоматически пытается загрузить список vault с сервера.

---

## Ветка Create

1. Пользователь нажимает `Create vault`.
2. В модальном окне вводит `vaultId`.
3. Plugin:
   - вызывает `POST /vaults`
   - привязывает текущую папку к новому `vaultId`
   - сбрасывает локальный sync state старой привязки, если была перепривязка
4. Пользователь видит новый `Current vault`.

---

## Ветка Join

1. Пользователь загружает список server vault или использует уже автоматически загруженный.
2. Выбирает vault и нажимает `Join`.
3. Plugin привязывает текущую папку к выбранному `vaultId`.

---

## Первый sync после Join

Если одновременно выполняются два условия:

- локальная папка уже содержит syncable-файлы
- выбранный server vault не пустой

plugin требует выбрать стратегию первого sync.

Пользователь выбирает одно из двух:

- `Download vault from server`
- `Sync vault`

### Download vault from server

- серверный vault принимается как source of truth
- локальные syncable-файлы перезаписываются содержимым сервера

### Sync vault

- запускается обычный sync cycle
- локальные документы отправляются на сервер
- удалённые snapshots подтягиваются обратно на клиент
- история и document merge помогают свести состояние без отдельного file-conflict UI

---

## Дальнейшая настройка

После выбора vault пользователь может настраивать:

- `Poll interval`
- `Auto sync`
- `Include patterns`
- `Ignore patterns`

И использовать быстрые действия:

- `Sync now`
- `Check connection`
- `Refresh devices`

---

## Диагностика и обслуживание

### Disconnect

`Disconnect`:

- отвязывает текущую папку от `vaultId`
- сбрасывает активную привязку, но не удаляет файлы из vault

### Forget local state

`Forget local state`:

- очищает локально сохранённое sync state для текущего vault
- не удаляет серверные данные
- не удаляет локальные заметки
- полезен для пересборки document state на клиенте

---

## Команды command palette

Пользователь может вызывать:

- `Sync now`
- `Show active file server history`
- `Restore active file to previous server version`

История файла открывает список серверных версий активного файла и позволяет восстановить
конкретную версию прямо из UI.
