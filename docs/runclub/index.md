# runclub

runclub это приложение для тренеров по бегу и бегунов. Один аккаунт, роли флагами: человек
часто и тренер, и бегун. Внутри клубы с лентой, тренировки от тренера, импорт тренировок из
«Здоровья» (HealthKit, Health Connect), достижения, календарь забегов и доска объявлений о
б/у кроссовках. Клиент написан на Flutter (iOS и Android), бэкенд на Go с PostgreSQL и
S3-совместимым хранилищем.

Статус этапов (из `docs/architecture.md`):

| Этап | Содержимое | Статус |
|---|---|---|
| A | Скелет репозитория, авторизация (телефон + код, Sign in with Apple), профиль, роли, удаление аккаунта | готов |
| B | Клубы: создание, приглашение по ссылке, участники, роли в клубе, лента клуба, жалобы и блокировки, загрузка фото | готов |
| C | Тренировки: план от тренера ученику или клубу, факт из HealthKit / Health Connect, отметка выполнения, сводка | готов |
| D | Достижения: автоматические по выполненным тренировкам, ручные, публикация в ленту клуба, публичный профиль | готов |
| E | Забеги: календарь, «Бегу», участники из клубов, забеги клуба и обратный отсчёт, результат финиша, админ-импорт | готов |
| F | Кроссовки: объявления с пробегом и фильтрами, диалоги с продавцом, статусы продажи | готов |
| G | Модерация для админа (жалобы, скрытие контента, бан), экспорт данных, бета в TestFlight, публикация | бэкенд готов, клиент и чек-лист в работе |
| H | Оплата через сайт (ЮKassa, СБП), тариф тренера, партнёрка по слотам | |
| I | Видео: живые онлайн-сессии через LiveKit, запись, библиотека уроков клуба | код готов, на устройствах не проверен |
| J | Интеграции: Polar и Strava через общий механизм, Garmin и COROS — когда дадут доступ к API | код готов, с реальными аккаунтами не проверено |

## Структура репозитория

- `backend/` : Go API. Точка входа `cmd/api`, домены в `internal/<домен>`, миграции goose в `migrations/`, `sqlc.yaml` генерирует `internal/db`.
- `app/` : Flutter-клиент. `lib/core` (API-клиент, токены, роутер, тема), `lib/features/<фича>`, строки в `lib/l10n`.
- `docs/architecture.md` : решения по устройству системы и доменная модель.
- `docs/api.md` : REST-контракт.
- `docs/release.md` : чек-лист публикации в App Store, Google Play и RuStore.
- `docker-compose.yml` : Postgres и MinIO для локальной разработки.
- `CLAUDE.md` : правила для ИИ-агента, для разработчика не обязателен.

## Быстрый старт

Нужны Docker, Go 1.27 и Flutter. Утилиты goose и sqlc ставить не надо, они идут через `go tool`.

### Бэкенд

```
docker compose up -d        # Postgres на localhost:55432, MinIO на :9000 (консоль :9001)
cd backend
cp .env.example .env        # значения по умолчанию подходят для разработки
make migrate
make run                    # API на :8080
```

Тесты: `make test` (интеграционные пропускаются без `DATABASE_URL`).

Код входа в dev не уходит по SMS, провайдер `log` печатает его в stdout сервера:

```
level=INFO msg="dev OTP: код для входа" phone=+79991234567 code=151176
```

Провайдер `log` запрещён в prod. Переменные окружения, команды `make`, примеры curl: `backend/README.md`.

### Клиент

```
cd app
flutter pub get
flutter run
flutter run --dart-define=API_BASE_URL=http://192.168.1.10:8080/v1   # реальное устройство
```

Без `API_BASE_URL` iOS-симулятор ходит на `localhost:8080`, Android-эмулятор на `10.0.2.2:8080`.
Подробности, команды кодогенерации и описание экранов: `app/README.md`.

### Только для iOS

- Нужен `sudo xcode-select -s /Applications/Xcode.app`, затем `flutter doctor` без ошибок по iOS.
- HealthKit уже включён в проекте (`ios/Runner/Runner.entitlements`). Sign in with Apple добавьте в Xcode
  вручную (Runner, Signing & Capabilities), без этого вход через Apple на устройстве не заработает.
  Подробнее: `docs/release.md`, раздел «Xcode-проект».

### iOS (SwiftUI)

Нативный клиент для iOS лежит в `ios/` и постепенно заменяет Flutter-версию на iPhone; `app/` остаётся основой для Android.
Нужны Xcode 26+ и `brew install xcodegen`. Проект `RunClub.xcodeproj` генерируется и в git не хранится.

```
cd ios
xcodegen generate
xcodebuild -project RunClub.xcodeproj -scheme RunClub \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' test
```

В Debug приложение ходит на `http://localhost:8080/v1`. Для релиза задайте `API_BASE_URL=https://...`
(build setting в `ios/project.yml`), иначе запуск завершится ошибкой. `BETA_SCOPE=YES` скрывает кроссовки,
подключённые сервисы и видео.

Вход через VK ID включается build settings `VK_APP_CLIENT_ID` и `VK_APP_CLIENT_SECRET` (значения из кабинета
VK ID; задаются в `ios/project.yml` или при сборке `xcodebuild VK_APP_CLIENT_ID=... VK_APP_CLIENT_SECRET=...`).
Они попадают в Info.plist вместе с URL-схемой `vk<client id>`. Пока id или секрет пусты, кнопка VK скрыта
и SDK не инициализируется. Sign in with Apple включён entitlement'ом `com.apple.developer.applesignin`
(`ios/RunClub/RunClub.entitlements`, генерируется из `ios/project.yml`).

## Ключевые решения

- Один аккаунт, роли флагами `is_coach` и `is_runner`, две строки пользователя на одного человека не заводятся: `docs/architecture.md`, начало и «Доменная модель».
- Тренер это платящая сторона и канал роста (тариф тренера, этап H): `docs/architecture.md`, этапы, строка H.
- Покупок внутри приложения нет. Apple с апреля 2026 не принимает платежи в России, оплата на сайте, платные функции включаются по аккаунту: `docs/architecture.md`, «Что откладываем сознательно»; `docs/release.md`, «Типовые причины отказа», пункт 3.1.1.
- Данные пользователей РФ лежат на серверах в РФ (152-ФЗ), в проде Yandex Object Storage: `docs/architecture.md`, введение; `docs/release.md`, «Бэкенд в проде».
- Собственного GPS-трекера нет, факт тренировки приходит из HealthKit и Health Connect через `POST /workouts/import`: `docs/architecture.md`, «Тренировки» и «Что откладываем сознательно».
- Достижения считаются на сервере в момент, когда тренировка становится `done`: `docs/architecture.md`, «Достижения».
- Календарь забегов ведёт админ через `/admin/*` с заголовком `X-Admin-Token`, партнёрство с регистраторами это этап H: `docs/architecture.md`, «Забеги».
- Кроссовки это объявления и чат без вебсокетов (клиент опрашивает диалог раз в 10 секунд), безопасной сделки пока нет: `docs/architecture.md`, «Кроссовки».
- Модерация и баны закрывают требование App Store 1.2: жалобы, блокировки, скрытие контента, бан, экспорт данных: `docs/architecture.md`, «Модерация»; `docs/release.md`, «Типовые причины отказа».
- Вход для ревьюера сторов задаётся парой `REVIEW_PHONE` и `REVIEW_CODE` (6 цифр, SMS не отправляется): `backend/README.md`, «Вход ревьюера сторов»; `docs/release.md`, пункт 2.1.
- Вход, токены и удаление аккаунта: access JWT 15 минут, refresh 30 дней с ротацией, `DELETE /v1/me`: `docs/architecture.md`, «Авторизация».

## Репозиторий и сохранность кода

- Репозиторий один на бэкенд и приложение, приватный, на личном GitHub (`serkoo10/runclub`),
  а не в рабочем GitLab: там проект видят администраторы. Разделять на два репозитория только
  когда внешнему человеку нужен доступ лишь к `app/`: приложение зависит от бэкенда через `docs/api.md`.
- Периметр это аккаунт, а не хостинг. Защищать нужно не код, а ключи Apple, Strava, Polar, S3 и
  базы (только в `.env` и переменных CI), прод-базу с бэкапами (`deploy/prod/backup.sh`) и сами
  аккаунты Apple и GitHub с двухфакторкой.

## Документация

- [`docs/architecture.md`](architecture.md) : архитектура, доменная модель, решения по этапам.
- [`docs/api.md`](api.md) : REST-контракт, обновляется вместе с хендлером.
- [`docs/release.md`](release.md) : путь до App Store, Google Play и RuStore.
- [`backend/README.md`](https://github.com/serkoo10/runclub/blob/main/backend/README.md) и [`app/README.md`](https://github.com/serkoo10/runclub/blob/main/app/README.md) : запуск и детали по частям.
