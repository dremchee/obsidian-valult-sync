# Plugin UX Flow

## Назначение

Этот документ описывает актуальный пользовательский сценарий для текущего UI plugin:
от первого запуска до подключения папки к vault и первого sync.

---

## Базовая модель

Одна локальная Obsidian-папка должна быть связана только с одним logical sync vault.

С точки зрения UX это означает четыре явных действия:

- `Create vault`
- `Join server vault`
- `Disconnect`
- `Forget local state`

Смена `vaultId` для той же папки считается перепривязкой, а не временным переключением режима.

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
7. Получает один из результатов:
   - сервер доступен
   - авторизация отклонена
   - сервер недоступен
8. После успешной проверки plugin разблокирует остальную конфигурацию.
9. В секции `Vault` plugin автоматически пытается загрузить список vault с сервера.

---

## Ветка Create

1. Пользователь нажимает `Create vault`.
2. В модальном окне вводит:
   - `vaultId`
   - E2EE passphrase
   - подтверждение passphrase
3. Plugin:
   - вызывает `POST /vaults`
   - сохраняет session passphrase
   - привязывает текущую папку к новому `vaultId`
   - сбрасывает локальный sync state старой привязки, если была перепривязка
4. Пользователь видит новый `Current vault`.

---

## Ветка Join

1. Пользователь загружает список server vault или использует уже автоматически загруженный.
2. Выбирает vault и нажимает `Join`.
3. Plugin открывает модальное окно для E2EE passphrase.
4. Если на сервере уже есть encrypted content, plugin проверяет passphrase на реальном файле.
5. После успешной проверки plugin привязывает текущую папку к выбранному `vaultId`.

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
- конфликтные копии на этом шаге не создаются

### Sync vault

- запускается обычный sync cycle
- локальные файлы могут быть загружены
- при расхождениях возможны conflict copies

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

## Статусы, которые видит пользователь

### Connection

Connection показывает:

- `Not checked`
- `Checking...`
- `Server is reachable.`
- `Not authorized`
- текст ошибки, если запрос не удался

### Overview / Status bar

Основные состояния sync:

- `Up to date`
- `Pending changes`
- `Syncing`
- `Needs attention`
- `Auto sync off`
- `No vault connected`

---

## Диагностика и обслуживание

### Disconnect

`Disconnect`:

- отвязывает текущую папку от `vaultId`
- останавливает использование текущей E2EE passphrase
- сбрасывает активную привязку, но не удаляет файлы из vault

### Forget local state

`Forget local state`:

- очищает локально сохранённое sync state для текущего vault
- не удаляет серверные данные
- не удаляет локальные заметки
- полезен для пересборки состояния клиента

---

## Команды command palette

Пользователь может вызывать:

- `Sync now`
- `Show active file server history`
- `Restore active file to previous server version`

История файла открывает список серверных версий активного файла и позволяет восстановить
конкретную версию прямо из UI.

---

## Happy path

1. Установить plugin.
2. Ввести `Server URL` и `Auth token`.
3. Нажать `Check`.
4. Создать новый vault или присоединиться к существующему.
5. При необходимости выбрать стратегию первого sync.
6. Нажать `Sync now`.
7. Убедиться, что статус стал `Up to date`.
