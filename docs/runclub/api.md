# API runclub

Базовый путь `/v1`. JSON, поля в snake_case, время в ISO 8601 UTC. Авторизация:
`Authorization: Bearer <access>`.

Ошибки: `{"error": {"code": "string", "message": "string"}}`. Коды: `validation`,
`unauthorized`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `unavailable` (503), `internal`.

## Служебное

| Метод | Путь | Описание |
|---|---|---|
| GET | /healthz | 200 если процесс жив |
| POST | /webhooks/livekit | Вебхуки LiveKit, подпись по ключу сервера, без пользовательского токена |
| GET, POST | /webhooks/{provider} | Вебхуки провайдеров интеграций (polar, strava), проверка по правилам провайдера, без пользовательского токена; см. «Интеграции» |
| GET | /readyz | 200 если база доступна |

## Авторизация

### POST /auth/otp/request
Тело: `{"phone": "+79991234567"}`. Ответ 204. Ошибки: `validation`, `rate_limited`.
Лимиты: на номер — раз в 60 секунд и 5 в час; на источник (IP) — 10 кодов в час и 2 в час на пару IP+номер.
Лимиты по IP — счётчики в Redis, общие для всех экземпляров, окно фиксированное.
Тестовый номер ревьюера (`REVIEW_PHONE`) лимитам запроса не подлежит и квоту источника не тратит: код фиксированный и не отправляется.

### POST /auth/otp/verify
Тело: `{"phone": "+79991234567", "code": "123456"}`.
Ответ 200: `{"access_token", "refresh_token", "expires_in", "is_new_user"}`.
Ошибки: `unauthorized` (код не подошёл или истёк), `rate_limited` (исчерпаны попытки).
Лимиты: 5 неверных вводов за время жизни кода на пару IP+номер (счётчики в Redis, как у request) и 20 попыток на сам код.

### POST /auth/apple
Тело: `{"identity_token": "...", "full_name": "Имя Фамилия"?}`.
Ответ как у verify. Ошибки: `unauthorized`.

### POST /auth/vk
Тело: `{"access_token": "..."}` — access token VK ID, полученный клиентом.
Ответ как у verify. Ошибки: `unauthorized` (VK не принял токен или он пуст), `conflict` (телефон уже привязан к другой
учётной записи VK), `rate_limited` (20 попыток в час на IP, считаются все попытки с непустым токеном),
`unavailable` (вход через VK не настроен, `VK_CLIENT_ID` пуст, либо VK временно недоступен).

### POST /auth/refresh
Тело: `{"refresh_token": "..."}`. Ответ как у verify без `is_new_user`.
Старый refresh отзывается.

### POST /auth/logout
Тело: `{"refresh_token": "..."}`. Ответ 204.

## Профиль

### GET /me
Ответ: `{"id", "phone"?, "email"?, "name", "avatar_url"?, "city"?, "is_coach", "is_runner", "created_at"}`.

### PATCH /me
Тело: любые из `name`, `city`, `is_coach`, `is_runner`, `avatar_url`. Ответ как у GET /me.
Хотя бы одна роль должна остаться включённой. `name` не пустое, до 100 символов; `city` до 100;
`avatar_url` до 2048, ссылка из POST /uploads (kind `avatar`) под `S3_PUBLIC_BASE_URL`. Пустая строка в `city` или `avatar_url` очищает поле.

### DELETE /me
Мягкое удаление, отзыв всех refresh-токенов. Ответ 204.

## Загрузка файлов

### POST /uploads
Тело: `{"kind": "avatar|post|video", "content_type", "size"}`. Для изображений `image/jpeg|image/png|image/webp`
до 10 МБ; для `video` `video/mp4|video/quicktime` до 500 МБ. Ответ 200: `{"upload_url", "public_url", "expires_in"}`. Клиент делает
`PUT upload_url` с телом файла и тем же `Content-Type`, что в запросе (он входит в подпись), затем
использует `public_url`. Ссылка действует 15 минут. Размер проверяется по заявленному `size`;
хранилище длину тела по ссылке не ограничивает.

### POST /uploads/complete
Тело: `{"public_url"}` — ссылка на только что загруженное изображение вида `avatar` или `post`. Сервер читает объект
из хранилища, делает превью JPEG (качество 80) до 480 px по длинной стороне (меньшие не увеличиваются) и кладёт его
по соглашению `thumbs/<uuid>.jpg`. Ответ 200: `{"thumbnail_url", "width", "height"}`. Повторный вызов перезаписывает превью.
Ориентация EXIF у JPEG учитывается: превью повёрнуто пикселями и EXIF не содержит. Ссылка на превью выводится из
ссылки оригинала заменой каталога и расширения (`<base>/thumbs/<uuid>.jpg`), поэтому в постах и объявлениях по-прежнему
хранятся только ссылки оригиналов. Ошибки: `validation` (чужая ссылка, не изображение, больше 12 000x12 000 px, вид не
avatar/post), `not_found` (оригинала ещё нет: вызывать после `PUT`). Клиент показывает в сетках и списках
`thumbnail_url`, оригинал открывает по тапу; если превью нет, грузит оригинал.

## Клубы

Клуб может создать любой пользователь. Роли в клубе: `owner` (один), `coach`, `member`.
Объект клуба: `{"id", "name", "city", "description", "owner_id", "member_count", "my_role"?, "invite_code"?, "created_at"}`.
`invite_code` отдаётся только `owner` и `coach`. `my_role` отсутствует, если пользователь не участник.

| Метод | Путь | Кто | Описание |
|---|---|---|---|
| POST | /clubs | любой | Тело `{"name", "city", "description"?}`. Создатель становится `owner`. Ответ 201, объект клуба |
| GET | /clubs/mine | любой | Список клубов пользователя с `my_role` |
| GET | /clubs/{id} | участник | Объект клуба |
| PATCH | /clubs/{id} | owner, coach | Любые из `name`, `city`, `description` |
| DELETE | /clubs/{id} | owner | Мягкое удаление. 204 |
| POST | /clubs/{id}/invite/rotate | owner, coach | Новый `invite_code`, старый перестаёт работать. Ответ объект клуба |
| GET | /clubs/invite/{code} | любой | Превью: `{"id", "name", "city", "member_count", "my_role"?}` |
| POST | /clubs/join | любой | Тело `{"invite_code"}`. Вступление с ролью `member`. Повторное вступление — `conflict`. Ответ объект клуба |
| GET | /clubs/{id}/members | участник | `{"items": [{"user_id", "name", "avatar_url"?, "role", "joined_at"}]}`, отсортировано по роли, затем по дате. Без пагинации, клубы до нескольких сотен человек |
| PATCH | /clubs/{id}/members/{user_id} | owner | Тело `{"role": "coach|member"}`. Роль `owner` не назначается этим методом, роль владельца не меняется. 204 |
| DELETE | /clubs/{id}/members/{user_id} | см. ниже | Исключение или выход. 204 |

Правила удаления участника: участник может удалить сам себя, кроме `owner`; `coach`
удаляет `member`; `owner` удаляет любого, кроме себя. `name` до 100 символов, `city` до 100,
`description` до 1000. `name` и `city` не пустые. `invite_code` 8 символов, заглавная латиница и цифры
без похожих (`0 O 1 I L`); при вводе регистр не важен. Не участник клуба получает `forbidden` на
методы «участник», несуществующий или удалённый клуб — `not_found` (у методов участников и ленты
оба случая дают `forbidden`).

## Лента клуба

Пост: `{"id", "club_id", "author": {"user_id", "name", "avatar_url"?}, "text", "photos": [url], "achievement"?: {объект достижения}, "created_at"}`.

| Метод | Путь | Кто | Описание |
|---|---|---|---|
| POST | /clubs/{id}/posts | участник | Тело `{"text", "photos"?: [url], "achievement_id"?}`. Текст до 2000 символов, фото до 6, каждое — ссылка из POST /uploads (kind `post`) под `S3_PUBLIC_BASE_URL`. Достижение должно принадлежать автору. Пост должен содержать текст, фото или достижение. Ответ 201 |
| GET | /clubs/{id}/posts | участник | `?limit=20&cursor=...`. Ответ `{"items": [...], "next_cursor"?}`. Новые сверху. Посты заблокированных пользователей и удалённые не отдаются |
| DELETE | /clubs/{id}/posts/{post_id} | автор, owner, coach | Мягкое удаление. 204 |

`limit` от 1, по умолчанию 20, больше 50 обрезается до 50. Пост должен содержать `text`, фото или достижение. Чужое или несуществующее `achievement_id` — `validation`.
Курсор непрозрачная строка, кодирует `created_at` и `id` последнего элемента.

## Жалобы и блокировки

Нужны для публикации в App Store при любом пользовательском контенте.

| Метод | Путь | Описание |
|---|---|---|
| POST | /reports | Тело `{"target_type": "post|listing|user", "target_id", "reason"}`. `reason` до 500 символов. Ответ 201 `{"id"}`. Повторная жалоба того же пользователя на ту же цель — `conflict` |
| POST | /users/{id}/block | Блокировка. Посты этого пользователя пропадают из лент. Повторно — 204 без ошибки |
| DELETE | /users/{id}/block | Снятие блокировки. 204 |
| GET | /users/blocked | `{"items": [{"user_id", "name", "avatar_url"?, "blocked_at"}]}` |

Заблокировать себя нельзя — `validation`.

## Тренировки

Объект тренировки:
```
{"id", "athlete": {"user_id", "name", "avatar_url"?}, "club_id"?, "coach_id"?, "assignment_id"?,
 "planned_on": "2026-10-12", "kind": "easy|long|interval|tempo|race|cross|rest|free",
 "title", "target": {"distance_m"?, "duration_s"?, "pace_s_per_km"?, "description"?}, "note",
 "status": "planned|done|skipped", "result"?: {...}, "source"?, "completed_at"?, "created_at"}
```
Результат: `{"distance_m", "duration_s", "avg_pace_s_per_km"?, "avg_hr"?, "started_at", "external_id"?}`.
`title` до 100 символов, `note` до 1000, `description` до 1000. `planned_on` дата без времени
в календаре спортсмена, часовой пояс не передаётся.

| Метод | Путь | Кто | Описание |
|---|---|---|---|
| POST | /clubs/{id}/workouts | owner, coach | Тело `{"athlete_ids": [..]}` или `{"all_members": true}`, плюс `planned_on`, `kind`, `title`, `target`?, `note`?. Все `athlete_ids` должны быть участниками. Ответ 201 `{"assignment_id", "created": n}` |
| GET | /clubs/{id}/workouts | owner, coach | `?from=2026-10-06&to=2026-10-12`, окно до 62 дней. `{"items": [...]}`, сортировка по `planned_on`, затем по имени спортсмена |
| PATCH | /clubs/{id}/assignments/{assignment_id} | owner, coach | Любые из `planned_on`, `kind`, `title`, `target`, `note`. Меняет все строки группы со статусом `planned`. Ответ `{"updated": n}` |
| DELETE | /clubs/{id}/assignments/{assignment_id} | owner, coach | Удаляет строки группы со статусом `planned`. 204 |
| GET | /workouts | спортсмен | Свои: `?from&to&status?`, окно до 62 дней. `{"items": [...]}` |
| POST | /workouts | спортсмен | Своя тренировка: `planned_on`, `kind`, `title`, `target`?, `note`?. Ответ 201, объект |
| GET | /workouts/{id} | спортсмен, тренер клуба | Объект |
| PATCH | /workouts/{id} | автор плана | Спортсмен правит свои без тренера, тренер правит одну строку своего назначения. Поля как у POST. Статус `done` не правится |
| DELETE | /workouts/{id} | автор плана | Только `planned`. 204 |
| POST | /workouts/{id}/complete | спортсмен | Тело `{"result": {...}}`. `planned` → `done`. Ответ объект |
| POST | /workouts/{id}/skip | спортсмен | Тело `{"reason"?}` до 200 символов, пишется в `note`. `planned` → `skipped` |
| POST | /workouts/{id}/reopen | спортсмен | `done`/`skipped` → `planned`, результат очищается |
| POST | /workouts/import | спортсмен | Тело `{"source": "healthkit|health_connect|polar|strava", "items": [{"external_id", "started_at", "distance_m", "duration_s", "avg_pace_s_per_km"?, "avg_hr"?}]}` до 100 штук. Дубли по `(source, external_id)` пропускаются. Привязка к плану по правилу из architecture.md. Ответ `{"imported": n, "matched": n, "skipped": n}` |
| GET | /workouts/summary | спортсмен | `?from&to`. `{"count", "distance_m", "duration_s", "done", "skipped", "planned"}` одним запросом |

Смена статуса из неподходящего состояния — `conflict`. Тренер видит тренировки участника
только в рамках клубов, где он owner или coach.

Уточнения:
- `distance_m`, `duration_s`, `pace_s_per_km`, `avg_hr` целые. `from` и `to` обязательны во всех списках и сводке.
- `PATCH` и `DELETE` строки, как и группы, работают только со статусом `planned`; иначе `conflict`.
  Править назначенную строку может только её тренер, и только пока он owner или coach клуба.
- `POST /clubs/{id}/workouts`: повторы в `athlete_ids` схлопываются; если хоть один адресат не участник, `validation` и ничего не создаётся.
- `reopen` очищает результат, `source` возвращается в `manual`, `external_id` сбрасывается: так тренировку можно импортировать заново.
- Импорт: `imported` включает `matched`. План на дату ищется среди своих `planned`, кроме `kind = rest`, берётся самый ранний.
  Дата тренировки — дата в смещении `started_at` (RFC 3339 со смещением обязателен). Невалидный элемент отклоняет весь пакет `validation`.
- Сводка: `count` — все тренировки окна по `planned_on`, `distance_m` и `duration_s` суммируются только по `done`.

## Интеграции

Подключение внешних сервисов тренировок по OAuth2: пробежки провайдера попадают в тренировки через тот же
импорт, что и HealthKit (`source` = имя провайдера). Сейчас реализованы `polar` и `strava`; список зависит от настроек сервера.
Без настроенных провайдеров маршруты не регистрируются (404).

| Метод | Путь | Кто | Описание |
|---|---|---|---|
| GET | /me/integrations | любой | `{"items": [{"provider", "connected", "status"?: "active|reconnect", "last_synced_at"?}]}`: по строке на каждый провайдер сервера, в порядке имён. `reconnect` — доступ отозван на стороне провайдера, нужно подключить заново |
| POST | /me/integrations/{provider}/connect | любой | Ответ `{"auth_url": "..."}`: клиент открывает его в браузере. Неизвестный провайдер — `not_found` |
| GET | /integrations/{provider}/callback | браузер, без токена | `?code&state` от провайдера. Ничего не сохраняет, всегда `302` на `runclub://integrations/{provider}?status=ok&code=<code>&state=<state>`; при `error=` или без `code`/`state` — на `?status=error&code=validation` |
| POST | /me/integrations/{provider}/complete | любой | Тело `{"code", "state"}` из deep link. Обменивает код и сохраняет подключение. 204; `state` недействителен или истёк — `validation`; выдан другому пользователю — `forbidden`; внешний аккаунт уже привязан к другому — `conflict`; провайдер недоступен — `unavailable` |
| DELETE | /me/integrations/{provider} | любой | Отзывает доступ у провайдера по возможности и забывает подключение. 204; не подключён — `not_found` |
| GET, POST | /webhooks/{provider} | провайдер, без токена | Вебхук провайдера вне `/v1`; подлинность проверяет адаптер (подпись Polar, `verify_token` Strava), неверная — `unauthorized`. Ответ 200: новая тренировка синхронизирует владельца, неизвестный аккаунт и служебные события игнорируются; на проверочный запрос подписки отвечает тело-challenge; 5xx просит провайдера повторить доставку |
| POST | /me/integrations/{provider}/sync | любой | Забирает пробежки за последние 30 дней и импортирует. Ответ как у `POST /workouts/import` |

Уточнения:
- `state` подписан сервером, действует 10 минут и привязан к пользователю и провайдеру. Callback только передаёт `code` и `state` приложению;
  подключение завершает `complete` под токеном того же пользователя, поэтому пересланная чужая ссылка согласия не привяжет аккаунт жертвы к автору ссылки.
- В callback `error=` вместо `code=` (пользователь отказал) даёт `status=error&code=validation`.
- `sync`: токен отозван на стороне провайдера — `conflict` и статус `reconnect`; провайдер недоступен — `unavailable` (503).
  Окно выборки всегда последние 30 дней (запоздало загруженная у вендора пробежка тоже попадёт), дубли по `(source, external_id)` пропускаются.
- Вебхук: не чаще одной синхронизации в минуту на подключение и не больше 30 событий в час на внешний аккаунт (сверх — 200 без синхронизации).
- Статус `reconnect` выставляется и событием отзыва доступа от провайдера (вебхук), не только ошибкой токена при `sync`.
- Удаление аккаунта (`DELETE /me`) подключения не удаляет.

## Достижения

Объект: `{"id", "user_id", "kind", "title", "payload": {...}, "workout_id"?, "achieved_at"}`.
Виды и правила начисления в architecture.md. `payload` по виду: для дистанционных
`{"distance_m"}`, для количественных `{"count"}`, для рекордов времени
`{"distance_m", "duration_s", "pace_s_per_km"}`, для `custom` то, что передал пользователь.
`title` на русском формирует сервер, кроме `custom`.

| Метод | Путь | Кто | Описание |
|---|---|---|---|
| GET | /me/achievements | любой | `{"items": [...]}`, новые сверху, без пагинации (их десятки) |
| GET | /users/{id}/achievements | одноклубник | То же для другого пользователя. Нет общего клуба — `forbidden` |
| POST | /achievements | любой | Ручное: `{"title", "achieved_at", "payload"?: {"distance_m"?, "duration_s"?, "note"?}}`. `title` до 100, `note` до 500. Ответ 201, kind `custom` |
| DELETE | /achievements/{id} | владелец | Только `custom`. 204 |

Автоматические достижения появляются после `POST /workouts/{id}/complete` и
`POST /workouts/import`; ответ этих методов получает поле `"new_achievements": [...]`,
чтобы клиент мог показать их сразу.

Уточнения реализации:
- `DELETE /achievements/{id}` скрывает посты ленты, которые состояли только из этого достижения (без текста и фото).
- Достижение не пропадает при возврате тренировки в план. Если planned-тренировку потом удалили, у достижения исчезает `workout_id`.
- `new_achievements` возвращает только впервые записанные достижения; при пустом результате это `[]`. Ошибка начисления не ломает
  `complete` и `import`: она пишется в лог, достижения в этом случае могут не появиться.
- Достижения за пакет импорта считаются по порядку элементов пакета, а не по `started_at`.

## Публичный профиль

### GET /users/{id}
`{"id", "name", "avatar_url"?, "city"?, "is_coach", "is_runner", "shared_clubs": n}`.
Доступно любому авторизованному. Удалённый пользователь — `not_found`.

## Забеги

Объект забега:
```
{"id", "title", "city", "date": "2026-05-23", "distances_m": [5000, 10000, 21100], "organizer"?, "url"?,
 "description"?, "source": "admin|club", "club_id"?, "going_count", "my_entry"?: {объект заявки}, "created_at"}
```
Заявка: `{"race_id", "user_id", "distance_m", "status": "going|finished|withdrawn", "result"?: {"duration_s", "place"?, "bib"?}, "workout_id"?, "updated_at"}`.
`going_count` считает заявки `going` и `finished`. Клубные забеги видны только участникам клуба.
`title` до 150, `city` до 100, `organizer` до 150, `url` до 2048, `description` до 2000, дистанций от 1 до 10.

| Метод | Путь | Кто | Описание |
|---|---|---|---|
| GET | /races | любой | `?from=YYYY-MM-DD&to=YYYY-MM-DD&city=&q=&limit=20&cursor=`. `from` по умолчанию сегодня, окно до 366 дней, `q` по подстроке названия без учёта регистра. Публичные плюс клубные забеги моих клубов. Keyset по `(date, id)`. `{"items", "next_cursor"?}` |
| GET | /races/{id} | любой с доступом | Объект |
| GET | /races/{id}/participants | любой с доступом | `{"items": [{"user_id", "name", "avatar_url"?, "distance_m", "status", "result"?}]}` только одноклубники, свой профиль включён. Сортировка: finished по времени, затем going по имени |
| PUT | /races/{id}/entry | любой с доступом | Тело `{"distance_m"}` из списка дистанций. Создаёт или меняет заявку `going`; `finished` менять нельзя — `conflict`. Ответ заявка |
| DELETE | /races/{id}/entry | владелец заявки | `going` → `withdrawn`. `finished` — `conflict`. 204 |
| POST | /races/{id}/entry/result | владелец заявки | Тело `{"duration_s", "place"?, "bib"?}`. Только если `date` ≤ сегодня. `going` → `finished`, создаёт тренировку `race` со статусом `done` и достижение `race_finish`. Ответ заявка с `new_achievements` |
| DELETE | /races/{id}/entry/result | владелец заявки | `finished` → `going`, удаляет созданные тренировку и достижение. 204 |

## Забеги клуба

| Метод | Путь | Кто | Описание |
|---|---|---|---|
| GET | /clubs/{id}/races | участник | Будущие и прошедшие за 30 дней: `{"items": [{забег, "club_going_count"}]}` по дате |
| POST | /clubs/{id}/races | owner, coach | Тело `{"race_id"}`. Добавляет публичный забег в клуб. Повтор — `conflict`. 201 |
| DELETE | /clubs/{id}/races/{race_id} | owner, coach | Убирает из клуба; клубный забег (`source = club`) при этом мягко удаляется вместе с заявками `going`. 204 |
| POST | /clubs/{id}/races/custom | owner, coach | Тело `{"title", "city", "date", "distances_m", "url"?, "description"?}`. Создаёт клубный забег и сразу добавляет в клуб. 201, объект |

Уточнения реализации (забеги и клубные забеги):
- Недоступный забег (чужой клубный, удалённый, несуществующий) во всех методах `/races/{id}...` даёт `not_found`, чтобы не раскрывать существование.
- `to` в `GET /races` по умолчанию `from` плюс 366 дней; окно `from..to` не больше 366 дней, иначе `validation`.
- `DELETE /races/{id}/entry`: нет заявки — `not_found`; повторный отзыв уже `withdrawn` — 204. `POST .../entry/result` без заявки — `not_found`,
  для заявки не в `going` — `conflict`, до даты забега (по UTC) — `validation`. `DELETE .../entry/result` для заявки не в `finished` — `conflict`.
- `POST /clubs/{id}/races` отвечает 201 с объектом забега. Клубный забег (`source = club`) в клуб не добавляется: `validation`.
- Тренировка забега (`race_id` задан) не возвращается в план через `POST /workouts/{id}/reopen`: `conflict`; её удаляет только `DELETE .../entry/result`.
- `POST .../entry/result` атомарен: заявка, тренировка `race` и достижение `race_finish` пишутся одним запросом, при сбое не остаётся ничего. Повтор или гонка с параллельным
  внесением — `conflict`, вторая тренировка и достижение не создаются (уникальный индекс `workouts (athlete_id, race_id)`). Рекорды из общего хука считаются после записи; их сбой финиш не отменяет.
  `DELETE .../entry/result` так же одним запросом возвращает `going`, удаляет тренировку и достижение финиша.
- `GET /clubs/{id}/races` отдаёт забеги с датой не раньше «сегодня минус 30 дней». `my_entry` отдаётся и для `withdrawn`.

## Админ: календарь забегов

Заголовок `X-Admin-Token: <ADMIN_TOKEN>`, иначе `unauthorized`. Без пользовательского токена.

| Метод | Путь | Описание |
|---|---|---|
| POST | /admin/races | Тело: поля забега без `source`, `club_id`. 201 |
| PATCH | /admin/races/{id} | Любые поля забега. Только `source = admin` |
| DELETE | /admin/races/{id} | Мягкое удаление. 204 |
| POST | /admin/races/import | Тело `{"items": [забег, ...]}` до 500. Дубль по `(title, city, date)` обновляет поля. Ответ `{"created", "updated"}` |

## Кроссовки

Объявление:
```
{"id", "seller": {"user_id", "name", "avatar_url"?, "city"?}, "title", "brand", "model", "size_eu": 42.5,
 "gender": "m|f|unisex", "condition": "new|like_new|good|worn", "mileage_km"?, "price_rub", "city",
 "description", "photos": [url], "status": "active|reserved|sold|hidden", "created_at", "updated_at"}
```
`title` до 100, `brand` до 50, `model` до 100, `city` 1–100, `description` до 2000, `size_eu` 30.0–55.0 с шагом 0.5,
`mileage_km` 0–5000, `price_rub` 1–1 000 000, фото 1–8, каждое — ссылка из POST /uploads (kind `post`) под `S3_PUBLIC_BASE_URL`. `brand` нормализуется: обрезка пробелов,
первая буква заглавная при сравнении в фильтре без учёта регистра.

| Метод | Путь | Кто | Описание |
|---|---|---|---|
| GET | /listings | любой | `?city=&brand=&size_eu=&gender=&price_min=&price_max=&q=&limit=20&cursor=`. Только `active`, без объявлений заблокированных в любую сторону пользователей. `q` по подстроке `title`, `brand`, `model`. Keyset по `(created_at, id)`, новые сверху. `{"items", "next_cursor"?}` |
| GET | /listings/mine | любой | Свои объявления всех статусов, кроме удалённых, новые сверху, без пагинации |
| GET | /listings/{id} | любой | Объект. Чужое `hidden` или удалённое — `not_found` |
| POST | /listings | любой | Все поля кроме `status`. `city` по умолчанию город профиля. 201 |
| PATCH | /listings/{id} | продавец | Любые поля, включая `status`. `sold` необратим — `conflict` при попытке вернуть |
| DELETE | /listings/{id} | продавец | Мягкое удаление. 204 |
| GET | /listings/brands | любой | `{"items": [{"brand", "count"}]}` по активным объявлениям, для подсказок в фильтре |

## Диалоги по объявлениям

Диалог: `{"id", "listing": {"id", "title", "price_rub", "photo"?, "status"}, "buyer": {...}, "seller": {...},
"last_message"?: {сообщение}, "unread_count", "created_at"}`. Сообщение: `{"id", "thread_id", "sender_id", "text", "created_at"}`.
`text` до 2000 символов.

| Метод | Путь | Кто | Описание |
|---|---|---|---|
| POST | /listings/{id}/thread | не продавец | Открывает или возвращает существующий диалог покупателя с продавцом. Своё объявление — `validation`. Блокировка в любую сторону — `forbidden`. 200 с диалогом |
| GET | /threads | любой | `?limit=50&cursor=`. Мои диалоги как покупателя и как продавца. Keyset по `(last_message_at, id)`, новые сверху. Диалоги без сообщений не показываются. `{"items", "next_cursor"?}` |
| GET | /threads/{id} | участник | Объект диалога |
| GET | /threads/{id}/messages | участник | `?limit=50&cursor=`. Keyset по `(created_at, id)`, новые сверху. Вызов отмечает диалог прочитанным до последнего отданного сообщения |
| POST | /threads/{id}/messages | участник | Тело `{"text"}`. Блокировка в любую сторону — `forbidden`. Объявление `sold` или удалено — `conflict`. 201, сообщение |
| GET | /threads/unread | любой | `{"count"}` для бейджа на вкладке |
| POST | /threads/{id}/read | участник | Отмечает диалог прочитанным до текущего момента; клиент зовёт при получении сообщения событием в открытый диалог. 204 |

Уточнения реализации (админ):
- Пустой `ADMIN_TOKEN` в конфигурации отключает маршруты `/v1/admin/*`: они отвечают `not_found`. Неверный или отсутствующий заголовок — `unauthorized`.
- `PATCH` клубного забега (`source = club`) — `forbidden`. Пустая строка в `organizer`, `url`, `description` очищает поле. `DELETE` удаляет любой забег.
- Дубль `(lower(title), city, date)` среди живых админских забегов при `POST` и `PATCH` — `conflict`; при импорте обновляет поля.
  Импорт: пустой список или больше 500 элементов — `validation`, плохой элемент отклоняет весь пакет.

Уточнения реализации (кроссовки):

- Объявления удалённого продавца не отдаются ни списком, ни по id, ни в `brands`: фильтр по `users.deleted_at`, как в ленте.
- `GET /listings/{id}` и `GET /listings/brands` тоже скрывают объявления заблокированных в любую сторону пользователей (`not_found` и пропуск в счётчике); продавец всегда видит своё.
- Фильтр `city` сравнивает точно (по индексу), `brand` без учёта регистра. `price_min` и `price_max` вне 0..1 000 000 — `validation`. `/listings/brands` склеивает варианты регистра и отдаёт один из них.
- `PATCH` не умеет очищать `mileage_km`: `null` означает «не менять». `sold` не мешает менять остальные поля, запрещён только возврат статуса.
- Диалог не участника — `not_found`, а не `forbidden`, чтобы не раскрывать чужие id. Блокировка не убирает диалоги из `GET /threads` и не обнуляет `unread_count`: она запрещает открывать диалог и писать.
- Страница сообщений по умолчанию 50 (максимум 50). Отметка прочитанного не откатывается при чтении более старой страницы по курсору.
- В `listing` диалога `photo` — первое фото объявления; у удалённого объявления диалог остаётся читаемым, писать в него нельзя (`conflict`).

## Админ: модерация

Заголовок `X-Admin-Token`, как у календаря забегов.

Жалоба: `{"id", "reporter": {"user_id", "name"}, "target_type", "target_id", "reason", "status": "open|resolved|dismissed",
"target_preview": {...}, "created_at", "resolved_at"?, "resolution_note"?}`. `target_preview` для `post`: `{"text", "photos", "author", "club_id", "deleted"}`;
для `listing`: `{"title", "price_rub", "seller", "status", "deleted"}`; для `user`: `{"name", "city", "banned"}`.

| Метод | Путь | Описание |
|---|---|---|
| GET | /admin/reports | `?status=open&limit=50&cursor=`. Keyset по `(created_at, id)`, старые сверху, чтобы очередь шла по порядку. `{"items", "next_cursor"?}` |
| POST | /admin/reports/{id}/resolve | Тело `{"action": "hide_target|ban_user|none", "note"?}`. `hide_target` мягко удаляет пост или объявление; `ban_user` банит автора цели или пользователя-цель. Статус → `resolved`. Ответ жалоба |
| POST | /admin/reports/{id}/dismiss | Тело `{"note"?}`. Статус → `dismissed` |
| POST | /admin/users/{id}/ban | Тело `{"reason"}` до 500. Ставит `banned_at`, отзывает все refresh-токены. Повтор — 204 |
| DELETE | /admin/users/{id}/ban | Снимает бан. 204 |
| GET | /admin/users/{id} | Профиль с телефоном и почтой, счётчики: клубы, посты, объявления, жалобы на него |
| DELETE | /admin/posts/{id} | Мягкое удаление. 204 |
| DELETE | /admin/listings/{id} | Мягкое удаление. 204 |

Забаненный пользователь получает `forbidden` с кодом `banned` на любой авторизованный запрос,
`POST /auth/otp/verify`, `POST /auth/apple` и `POST /auth/vk` для него тоже возвращают `forbidden`.

Как реализовано: статус 403, в теле `{"error": {"code": "banned"}}` (код `banned` вместо `forbidden`). `status` в `GET /admin/reports`
необязателен, без него отдаются все статусы. `target_preview` равен `null`, если цели жалобы не существует. Счётчики профиля лежат в
`counters`: `{"clubs", "posts", "listings", "reports"}`, в профиле также `banned_at?`, `ban_reason?`, `deleted_at?`. Без `note` при
`ban_user` причиной бана становится текст жалобы. `resolved_by` не ведётся: админ один, пользователя за токеном нет.

## Экспорт данных

### GET /me/export
Один JSON со всеми данными пользователя: профиль, членства, тренировки, достижения, посты,
заявки на забеги, объявления, сообщения (только свои), жалобы. Не чаще раза в час — `rate_limited`.

## Онлайн-сессии

Сессия:
```
{"id", "club_id", "host": {"user_id", "name", "avatar_url"?}, "assignment_id"?, "title", "starts_at", "duration_min",
 "mode": "call|broadcast", "status": "scheduled|live|ended|cancelled", "participant_count", "my_presence_s",
 "recording": "none|recording|ready|failed", "recording_url"?, "lesson_id"?, "started_at"?, "ended_at"?, "created_at"}
```
`title` до 100, `duration_min` 10–180, `starts_at` не раньше чем за 5 минут до текущего времени при создании.
Вид тренировки `online` добавлен к `kind`; у таких тренировок `target.description` хранит заголовок сессии,
`result.duration_s` время присутствия.

| Метод | Путь | Кто | Описание |
|---|---|---|---|
| POST | /clubs/{id}/sessions | owner, coach | Тело `{"title", "starts_at", "duration_min", "mode", "athlete_ids"? или "all_members": true}`. Создаёт сессию и назначение тренировок `online` на дату `starts_at` в смещении клиента. 201, сессия |
| GET | /clubs/{id}/sessions | участник | `?from&to` по `starts_at`, окно до 62 дней. `{"items"}` по времени |
| GET | /sessions/{id} | участник клуба | Сессия |
| PATCH | /sessions/{id} | host | `title`, `starts_at`, `duration_min`, `mode`; только `scheduled`, иначе `conflict`. Меняет и строки назначения. `mode` нельзя менять с `starts_at − 10 мин` (токены уже могли быть выданы): `conflict` |
| DELETE | /sessions/{id} | host | `scheduled` → `cancelled`, удаляет `planned` тренировки группы. 204 |
| POST | /sessions/{id}/token | участник клуба | Ответ `{"url", "token", "room", "can_publish", "expires_in"}`. Доступно с `starts_at − 10 мин` до `starts_at + duration + 30 мин` и пока сессия не `ended`; иначе `conflict`. Первый токен ведущего переводит в `live` |
| POST | /sessions/{id}/end | host | Закрывает комнату, статус `ended`, засчитывает тренировки по присутствию. 204 |
| GET | /sessions/{id}/participants | участник клуба | `{"items": [{"user_id", "name", "avatar_url"?, "total_s", "online": bool}]}` |
| POST | /sessions/{id}/recording | host | Запуск записи, только `live`. Без Egress — `unavailable`. Ответ сессия |
| DELETE | /sessions/{id}/recording | host | Остановка записи. Ответ сессия |

Вебхук `room_finished`: у `scheduled` игнорируется; у `live` завершает сессию как `POST /sessions/{id}/end` только начиная с планового конца
(`starts_at + duration`), раньше — оставляет `live`, чтобы участники могли вернуться, и лишь закрывает открытые заходы. Досрочно завершает только ведущий через `POST /sessions/{id}/end`.
`room_started` статус не меняет: `live` ставит только первый токен ведущего.
Сессии клуба видны в `GET /clubs/{id}/workouts`, `GET /workouts` и `GET /workouts/{id}` как тренировки `online`
с полем `session_id` и вложенным объектом `"session": {"id", "title", "starts_at", "duration_min", "mode", "status"}`
(тот же запрос, `LEFT JOIN` на сессию, отдельный вызов не нужен). Объекта нет у тренировок без сессии и в ответах
`complete`, `skip`, `reopen`, `PATCH`.

Реализация и отклонения от описания выше:
- `from` и `to` в `GET /clubs/{id}/sessions` это время RFC 3339 (оба обязательны, `+` в смещении кодируется как `%2B`), граница включительная.
- Идентичность участника комнаты LiveKit равна id пользователя (строка UUID); по ней клиент находит трек ведущего в `broadcast`.
- `POST /sessions/{id}/end` идемпотентен: повтор после `ended` отвечает 204 и доводит зачёт тренировок; отменённая сессия даёт `conflict`.
  Если LiveKit не закрыл комнату, ответ `unavailable`, статус не меняется.
- `PATCH /sessions/{id}` и `DELETE /sessions/{id}` правят и удаляют только `planned` строки назначения; повторное `DELETE` даёт `conflict`.
- Запись: `POST .../recording` требует `live` и ответа Egress, иначе `conflict` или `unavailable`; повтор при `recording` или `ready` — `conflict`,
  после `failed` запись можно запустить снова. `DELETE .../recording` только останавливает Egress, `ready` и `lesson_id` приходят вебхуком `egress_ended`.
- Ведущий должен оставаться участником клуба с ролью owner или coach: иначе `PATCH`, `DELETE`, `end` и запись дают `forbidden`.
- Присутствие считается по времени события вебхука и не зависит от порядка доставки: повторный `participant_joined` при открытом заходе и `participant_left` раньше начала захода
  игнорируются, `participant_joined` переоткрывает закрытый заход только если он строго позже `left_at`, `participant_left` без захода пишет закрытую строку нулевой длины;
  события завершённой и отменённой сессии игнорируются. `participant_count` это число участников, которые заходили в комнату, `my_presence_s` включает текущий заход.
- Токен живёт до `starts_at + duration + 30 мин`, но не меньше 30 минут от выдачи; права `can_publish` и публикации данных совпадают.
- Урок записи один на сессию, `lesson_id` в сессии указывает на него; `video_url` и `poster_url` урока должны начинаться с `S3_PUBLIC_BASE_URL`.
- Тренировками `online` управляет сессия: `POST /workouts/{id}/complete|skip|reopen`, `PATCH` и `DELETE /workouts/{id}`,
  `PATCH` и `DELETE /clubs/{id}/assignments/{assignment_id}` для группы `online` отвечают `conflict`
  «онлайн-сессия управляется через сессию»; `POST /clubs/{id}/workouts` с `kind = online` — `validation`. Читать тренировку можно.
- Вебхук: неверная подпись — `unauthorized`, неизвестные события и комнаты — 200.

## Уроки клуба

Урок: `{"id", "club_id", "author": {...}, "title", "description", "video_url", "poster_url"?, "duration_s"?,
"source": "upload|recording", "session_id"?, "created_at"}`. `title` до 100, `description` до 2000.

| Метод | Путь | Кто | Описание |
|---|---|---|---|
| GET | /clubs/{id}/lessons | участник | `?limit=20&cursor=`, новые сверху. `{"items", "next_cursor"?}` |
| GET | /lessons/{id} | участник клуба | Урок |
| POST | /clubs/{id}/lessons | owner, coach | Тело `{"title", "description"?, "video_url", "poster_url"?, "duration_s"?}`. `video_url` из `POST /uploads` с `kind = video`. 201 |
| PATCH | /lessons/{id} | автор, owner | `title`, `description`, `poster_url` |
| DELETE | /lessons/{id} | автор, owner | Мягкое удаление. 204 |

## События в реальном времени

### GET /events
Поток Server-Sent Events для текущего пользователя. Заголовок `Authorization: Bearer`, ответ
`text/event-stream`. Сервер шлёт `: ping` каждые 25 секунд. Клиент держит одно соединение, пока
приложение на переднем плане, и переподключается с экспоненциальной паузой от 1 до 30 секунд.
Заголовок `Last-Event-ID` не поддерживается: события не хранятся, после переподключения клиент
один раз перечитывает открытый экран.

Событие:
```
id: <uuid>
event: message.created
data: {"thread_id", "message": {сообщение}, "unread_count"}
```
`unread_count` это непрочитанные получателя по всем диалогам после этого сообщения. Отправителю
событие тоже приходит, чтобы второе устройство увидело своё сообщение. Другие типы событий будут
добавляться тем же каналом.

Доставка через Redis pub/sub по каналу `user:<id>`, поэтому несколько экземпляров API делят одних
клиентов. Опрос `GET /threads/{id}/messages` остаётся запасным режимом: клиент опрашивает открытый
диалог раз в 30 секунд, когда поток не подключён.

### data.changed
Сигнал «данные устарели, перечитайте», без содержимого сущностей:
```
event: data.changed
data: {"topics": ["workouts", "sessions", "achievements"]}
```
`topics` это подмножество закрытого списка: `workouts` (тренировки и планы), `sessions` (онлайн-сессии),
`achievements` (достижения). Клиент перечитывает данные по каждой теме из события; неизвестные темы
игнорирует, список может расшириться. Одно событие на пользователя за действие.

Кто получает:
- Назначение, правка и удаление плана тренером (в том числе онлайн-сессии): спортсмены назначения,
  `workouts` (для онлайн-назначения ещё `sessions`).
- Спортсмен отметил, пропустил или вернул в план тренировку, назначенную тренером: тренер, `workouts`.
  Тренер правит или удаляет одну строку плана: спортсмен, `workouts`.
- Завершение онлайн-сессии: спортсмены, которым засчитана тренировка, `workouts` и `sessions`.
- Импорт по вебхуку Polar или Strava: спортсмен, `workouts` и `achievements`.

Автор действия событие не получает: его клиент обновляет данные локально. Если автора нет
(вебхук провайдера, автозавершение сессии по `room_finished`), событие получают все затронутые.
Доставка best effort: при сбое Redis событие теряется, поэтому клиент по-прежнему перечитывает
данные при переходе на экран и после переподключения потока.

### achievements.earned
Достижения, полученные без запроса клиента: импорт по вебхуку Polar или Strava. Клиент показывает
лист поздравления так же, как после `new_achievements` в ответе импорта:
```
event: achievements.earned
data: {"achievements": [{достижение}]}
```
Получает только спортсмен и только когда список не пуст. Приходит вместе с `data.changed`
(`workouts`, `achievements`). Синхронизация, запущенная самим спортсменом, события не шлёт: новые
достижения уже есть в ответе `POST /me/integrations/{provider}/sync`.
