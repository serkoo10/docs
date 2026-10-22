# Эксплуатация StudCore

## Первый запуск на сервере

1. Установить Docker и склонировать репозиторий.
2. `cp deploy/.env.example deploy/.env`, задать пароли и домен.
3. `cd deploy && docker compose --env-file .env up --build -d`.
   Сервис `migrate` накатывает схему и завершается; `api` стартует после него.
4. Выдать роли приложения пароль — она создаётся миграцией без права входа:
   `docker compose exec -T postgres psql -U owner -d studcore -c "ALTER ROLE studcore_app LOGIN PASSWORD '<APP_PASSWORD>'"`
5. Завести администратора арендатора:
   `docker compose exec api /usr/local/bin/createuser -tenant <код> -tenant-name "<название>" -email <почта> -password <пароль> -name "<ФИО>"`

## Обновление версии

`git pull && docker compose --env-file .env up --build -d`.
Миграции накатываются автоматически перед стартом `api`.

## Резервное копирование

Ежедневно: `docker compose exec -T postgres pg_dump -U owner studcore | gzip > /backup/studcore-$(date +%F).sql.gz`.
Каталог `/backup` создать заранее и синхронизировать за пределы сервера: копия,
лежащая на том же диске, не переживёт отказ этого диска.
Хранить 30 копий.

**Раз в месяц восстанавливать копию и проверять, что приложение на ней стартует** —
непроверенная копия копией не считается:

```bash
docker compose exec -T postgres createdb -U owner studcore_check
gunzip -c /backup/studcore-<дата>.sql.gz | docker compose exec -T postgres psql -U owner -d studcore_check
# Роль приложения восстанавливается из дампа как NOLOGIN — пароль выдаётся заново:
docker compose exec -T postgres psql -U owner -d studcore_check -c "ALTER ROLE studcore_app LOGIN PASSWORD '<APP_PASSWORD>'"
# Проверить, что схема на месте:
docker compose exec -T postgres psql -U owner -d studcore_check -c '\dt'
docker compose exec -T postgres dropdb -U owner studcore_check
```

## Порядок первого запуска важен

Сервис `api` стартует раньше, чем роли `studcore_app` выдан пароль, и до шага 4
перезапускается в цикле с ошибкой `password authentication failed`. Это ожидаемо:
секрет не хранится в репозитории и в миграции. После шага 4 выполните
`docker compose restart api` — сервис поднимется.

## Диагностика

- Логи: `docker compose logs -f api` (формат JSON, поле `err` содержит причину).
- Живость: `curl -s https://<домен>/healthz` → `{"status":"ok"}`.
- Не работает вход и в логах «проверка подключения к базе»: роли `studcore_app`
  не выдан пароль — повторить шаг 4 первого запуска.
- Пустые списки при заполненной базе: не установлен контекст арендатора.
  Проверить, что запрос идёт через `WithTenant`, а не через `Tx`.
- Caddy падает с `unrecognized global option`: сервису не передана переменная
  `SC_DOMAIN`, и шаблон домена развернулся в пустую строку. Проверить блок
  `environment` у сервиса `caddy` в `docker-compose.yml`.

## Ограничения текущей версии

- Статику отдаёт сам сервис, Caddy только терминирует TLS. Разделение —
  на этапе 6, когда появится нагрузка на выдачу файлов.
- Реплики `api` не настроены: обновление даёт простой в несколько секунд.
- Соединение с базой внутри стека идёт без шифрования (`sslmode=disable`).
  Это приемлемо, пока `postgres` и `api` работают на одном сервере и порт базы
  не опубликован наружу — трафик не покидает внутреннюю сеть контейнеров.
  **Точка пересмотра:** при выносе базы на отдельный узел или в управляемый
  сервис включить TLS (`sslmode=verify-full`) — до того, как база окажется
  доступна по сети.
- Образы не закреплены по контрольной сумме: пересборка через год может взять
  другую версию базового образа.
