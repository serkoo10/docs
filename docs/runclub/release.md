# Путь до App Store и Google Play

Чек-лист этапа G. Пункты отмечаются по мере выполнения.

## Окружение разработчика

- [ ] `sudo xcode-select -s /Applications/Xcode.app`, `brew install xcodegen`.
- [ ] iOS-клиент — SwiftUI в `ios/` (Flutter на iOS не выпускается): `cd ios && xcodegen generate`, первая сборка
      из Xcode (пакеты LiveKit), затем тесты по README.
- [x] Android: эмулятор API 34+, `flutter run -d emulator`, API через `10.0.2.2`. Smoke-прогон на Pixel_8 (API 35) прошёл 2026-10-13.

## Xcode-проект

Проект генерируется из `ios/project.yml`; правки только там, не в Xcode.

- [x] Bundle id `ru.runclub.runclubApp`, Team `Q78L322772`, автоматическая подпись.
- [x] Entitlements из `project.yml`: Sign in with Apple, HealthKit (без Clinical Health Records).
- [x] Info.plist: NSCamera/NSMicrophone/NSHealthShare/NSHealthUpdate UsageDescription, фоновый звук для звонка,
      `ITSAppUsesNonExemptEncryption = NO`, NSAllowsLocalNetworking (только локальные адреса).
- [x] Privacy manifest `ios/RunClub/Resources/PrivacyInfo.xcprivacy`: собираемые данные как в Nutrition Labels
      ниже, трекинга нет, UserDefaults с причиной CA92.1.
- [ ] Иконка 1024×1024 без прозрачности (взята из Flutter-проекта), launch screen системный.

## Бэкенд в проде

- [ ] Хостинг в РФ (Yandex Cloud / Selectel / VK Cloud), PostgreSQL 16 managed, Object Storage
      с публичным чтением бакета, `S3_REGION` если потребуется.
- [ ] `APP_ENV=prod`, `JWT_PRIVATE_KEY` выпущен и лежит в секретах, `APPLE_BUNDLE_ID`,
      `ADMIN_TOKEN`, `OTP_PROVIDER=telegram` и `TELEGRAM_GATEWAY_TOKEN`,
      `REVIEW_PHONE` и `REVIEW_CODE` для ревьюера.
- [ ] Уборка загрузок: `UPLOAD_SWEEP=dry` по умолчанию, посмотреть лог dry-прогона, затем `UPLOAD_SWEEP=on`.
      При нескольких экземплярах каждый убирает раз в сутки после старта (прогон линейный и идемпотентный, блокировки
      нет); `on` безопасно включать после просмотра dry-лога.
- [ ] За reverse proxy выставлен `TRUST_PROXY=true`; прокси перезаписывает `X-Forwarded-For`
      (иначе лимиты OTP по IP обходятся подменой заголовка). Без прокси оставить `false`.
- [ ] Вход через VK ID: приложение в кабинете id.vk.ru (iOS bundle id `ru.runclub.runclubApp`, Android-пакет
      `ru.runclub.runclub_app` и SHA-1/SHA-256 ключа подписи), `VK_CLIENT_ID` на бэкенде. В клиенте один и тот же
      client id в трёх местах: build settings `VK_APP_CLIENT_ID`/`VK_APP_CLIENT_SECRET` при сборке `ios/`,
      `VKIDClientID`/`VKIDClientSecret` в `app/android/local.properties` (или `-P`), `--dart-define=VK_APP_CLIENT_ID=...`
      в сборке (без него кнопка скрыта). Секреты не коммитить. Модерация приложения в VK ID для scope phone/email.
- [ ] `INTEGRATION_TOKEN_KEY` выпущен (`openssl rand -base64 32`) и лежит в секретах; потеря ключа требует переподключения всех сервисов.
- [ ] Интеграция Polar: вебхук создан запросом `POST https://www.polaraccesslink.com/v3/webhooks` (события `EXERCISE`,
      url `<PUBLIC_BASE_URL>/webhooks/polar`), `signature_secret_key` из ответа лежит в `POLAR_WEBHOOK_SECRET`.
- [ ] Интеграция Strava: приложение на strava.com/settings/api (callback domain — хост `PUBLIC_BASE_URL`),
      `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_WEBHOOK_VERIFY_TOKEN` заданы; подписка создана
      `POST https://www.strava.com/api/v3/push_subscriptions` (после запуска API, Strava проверяет callback сразу).
- [ ] HTTPS с валидным сертификатом, домен `api.<домен>`, `--dart-define=API_BASE_URL` в сборке.
- [ ] Бэкапы базы, логи, алерт на 5xx.
- [ ] Уведомление в Роскомнадзор об обработке ПДн подано, политика конфиденциальности и
      пользовательское соглашение опубликованы по постоянным URL.

## Бета на одной виртуалке

Всё в `deploy/prod`: Postgres, Redis, MinIO, API и Caddy на одном сервере. Видео (LiveKit и Egress) в этот состав не входит.

1. Виртуалка в РФ с Docker и плагином compose, открыты порты 80 и 443.
2. DNS: A-записи `api.<домен>` и `files.<домен>` на адрес виртуалки.
3. `cp deploy/prod/.env.example deploy/prod/.env`, заполнить все значения (`замените` — секреты, команды выпуска в комментариях). `DOMAIN` и адреса `api.`/`files.` в файле должны совпадать с настоящим доменом.
4. Бакет, один раз: `docker compose -f deploy/prod/compose.yml --profile init run --rm minio-init`.
5. Запуск: `docker compose -f deploy/prod/compose.yml up -d`. Миграции применяет сервис `migrate` до старта API.
6. Проверка: `curl https://api.<домен>/healthz` отвечает 200, `curl -i https://api.<домен>/v1/me` отвечает 401. Первый ответ может прийти через минуту: Caddy выпускает сертификат.
7. Бэкапы: в `crontab -e` строка `0 3 * * * /путь/к/репозиторию/deploy/prod/backup.sh`. Дампы лежат в `deploy/prod/backups` 14 дней; при `BACKUP_RCLONE_REMOTE` в `.env` копируются через `rclone` (установить и настроить вручную).
8. Обновление: `git pull`, затем `docker compose -f deploy/prod/compose.yml up -d --build`; миграции выполнятся сами.
9. Календарь забегов: `deploy/prod/races-moscow.json` (Москва, ноябрь 2026 — май 2027, собран 2026-10-22 по probeg.org,
   get.run и marathonec.ru; даты сверять с организатором). Загрузка:
   `curl -X POST https://api.<домен>/v1/admin/races/import -H "X-Admin-Token: $ADMIN_TOKEN" -H "Content-Type: application/json" --data-binary @deploy/prod/races-moscow.json`.
   Повтор безопасен: дубль по названию, городу и дате обновляет поля.

## App Store Connect

- [ ] Приложение создано, bundle id привязан, категория Health & Fitness.
- [ ] Privacy Nutrition Labels: контакты (телефон), здоровье и фитнес (тренировки),
      пользовательский контент (фото, посты, сообщения), идентификаторы (user id).
      Ничего не используется для трекинга. Health data не передаётся третьим лицам.
- [ ] Ссылки: политика конфиденциальности, поддержка.
- [ ] Возрастной рейтинг: пользовательский контент без ограничений → 12+ по опроснику.
- [ ] App Review Information: тестовый номер `REVIEW_PHONE` и код `REVIEW_CODE`, пояснение, что
      Sign in with Apple тоже работает; описание, где удалить аккаунт (Профиль → Удалить аккаунт),
      где пожаловаться и заблокировать (меню поста, объявления, профиля).
- [ ] Скриншоты 6.7" и 6.1" на русском, 5–8 штук: клубы, тренировки, забеги, кроссовки, профиль.
- [ ] Описание, подзаголовок, ключевые слова: тренер по бегу, беговой клуб, дневник тренировок, забеги.

## Типовые причины отказа и как закрыты

| Гайдлайн | Требование | Где закрыто |
|---|---|---|
| 1.2 | Жалобы, блокировка, модерация UGC в течение 24 ч | Меню поста/объявления/профиля, `/admin/reports` |
| 4.8 | Sign in with Apple при сторонних входах | Кнопка на экране входа (iOS) |
| 5.1.1 (v) | Удаление аккаунта из приложения | Профиль → Удалить аккаунт → `DELETE /me` |
| 5.1.1 | Запрос разрешений с объяснением | Строки NSHealth*, NSPhotoLibrary* |
| 2.1 | Ревьюер должен войти | `REVIEW_PHONE` / `REVIEW_CODE` |
| 3.1.1 | Нет цифровых покупок в обход IAP | Платных функций в приложении нет, оплата только на сайте без ссылок |
| 3.1.3(e) | Оплата услуг вне приложения | Регистрация на забег через сайт организатора |

## TestFlight

- [ ] Версия: `MARKETING_VERSION` и `CURRENT_PROJECT_VERSION` в `ios/project.yml`, номер сборки растёт с каждой загрузкой.
- [ ] `cd ios && xcodegen generate && xcodebuild archive -project RunClub.xcodeproj -scheme RunClub
      -destination 'generic/platform=iOS' -archivePath build/RunClub.xcarchive
      API_BASE_URL=https://api.<домен>/v1 VK_APP_CLIENT_ID=... VK_APP_CLIENT_SECRET=...`,
      загрузка через Xcode Organizer. dSYM лежат в архиве, Organizer отправляет их вместе со сборкой.
- [ ] Внутренняя группа (команда), внешняя группа 3–5 клубов до 200 человек.
- [ ] Метрики беты: тренеры, создавшие клуб за первую неделю; ученики, выполнившие первое задание;
      удержание на 4-й неделе. Собираются из базы SQL-запросами, аналитика третьих сторон не ставится.

## Google Play и RuStore

- [ ] Подпись приложения, `flutter build appbundle --obfuscate --split-debug-info=build/symbols/<версия>`
      (символы хранить так же, как для iOS), Data safety форма по тем же данным.
- [ ] Health Connect: декларация в консоли Play, иначе разрешения отклонят; политика
      конфиденциальности должна описывать использование данных здоровья.
- [ ] RuStore как второй канал для Android: тот же aab.

## План владельца: что сделать руками, от простого к долгому

Записан 2026-10-08. Всё делается в кабинетах и браузере; после каждого шага подключение
в коде занимает минуты. Секреты только в `.env` и в xcconfig, в git не попадают.

### 1. Telegram Gateway для кодов входа, 10 минут

- [x] gateway.telegram.org → Account → API, создать токен.
- [x] В `backend/.env`: `OTP_PROVIDER=telegram`, `TELEGRAM_GATEWAY_TOKEN=...`.
- [x] Проверить вход по реальному номеру с телефона. Сделано 2026-10-08; платные отправки
      потребуют пополнения через Fragment перед TestFlight.

### 2. Apple Developer Program, 20 минут и ожидание до недели

- [ ] Приложение Apple Developer на iPhone → Enroll → Individual, подтверждение по паспорту,
      оплата 99 $. Российская карта может не пройти: карта другой страны или оплата через
      знакомого, аккаунт остаётся ваш.
- [ ] После одобрения: в Xcode включить Sign in with Apple (Team ID уже в проекте), проверить
      вход через Apple на телефоне.

### 3. VK ID, 30 минут и модерация VK

Код входа готов на обеих платформах, не хватает только ключей. Android-сборка с VK ID
починена 2026-10-13 (новый репозиторий VK, плейсхолдеры манифеста вместо плагина).

- [ ] id.vk.ru, кабинет разработчика → мобильное приложение. iOS bundle id `ru.runclub.runclubApp`,
      Android-пакет `ru.runclub.runclub_app` и SHA-1/SHA-256 ключа подписи. Пока релиз подписан
      debug-ключом, отпечатки берутся из `cd app/android && ./gradlew signingReport`; после
      заведения ключа для Play добавить и его отпечатки.
- [ ] Модерация в VK ID на scope phone и email, иначе вход отдаёт только id.
- [ ] Client id и secret, в git не коммитить:
      - iOS: build settings `VK_APP_CLIENT_ID` / `VK_APP_CLIENT_SECRET` в команде `xcodebuild archive`
        (раздел TestFlight), в `ios/project.yml` не коммитить;
      - Android: `VKIDClientID` / `VKIDClientSecret` в `app/android/local.properties` или `-P`;
        без них схема возврата в манифесте пустая (`vk`) и вход не вернётся в приложение;
      - бэкенд: `VK_CLIENT_ID` в `backend/.env`, перезапуск API.
- [ ] Android: сборка с `--dart-define=VK_APP_CLIENT_ID=...`, без него кнопка VK скрыта. iOS: без обоих build settings
      кнопка скрыта.
- [ ] Проверка на iPhone и Android: «Войти через VK» → VK или браузер → возврат в приложение
      авторизованным.

### 4. Юрлицо и документы, дни

- [ ] ИП или самозанятость; для магазинов и РКН проще ИП.
- [ ] Политика конфиденциальности и пользовательское соглашение по постоянным URL на домене,
      который останется. Тексты готовятся по реквизитам.
- [ ] Уведомление об обработке ПДн на pd.rkn.gov.ru.

### 5. Хостинг в РФ, вечер

- [ ] Провайдер: Yandex Cloud, Selectel или VK Cloud. Виртуалка под API, managed PostgreSQL 16,
      Object Storage с публичным чтением бакета.
- [ ] Домен, DNS на `api.<домен>`, HTTPS.
- [ ] Развернуть бэкенд по разделу «Бэкенд в проде», бэкапы базы, алерт на 5xx.
- [ ] LiveKit отдельно: внешний IP, UDP-диапазон, свой TURN (`turn` в `livekit.yaml`).
- [ ] Ссылка-приглашение `https://<домен>/join/<код>`, после домена и Apple Developer (шаг 2). Сейчас
      приглашают кодом из буфера обмена; маршрут `/join/:code` и перенос адреса через вход уже
      готовы в клиенте. Нужны: `/.well-known/apple-app-site-association` и `assetlinks.json` на домене
      (Team ID, `ru.runclub.runclubApp`; пакет `ru.runclub.runclub_app` и SHA-256 ключа подписи),
      Associated Domains `applinks:<домен>` в entitlements `ios/project.yml`, intent-filter `autoVerify` на
      `https://<домен>/join` в AndroidManifest, кнопка «Поделиться ссылкой» рядом с кодом.

### 6. App Store Connect, после шагов 2 и 4

- [ ] Приложение, bundle id, категория Health & Fitness.
- [ ] Privacy Nutrition Labels, возрастной рейтинг, ссылки на политику и поддержку, тестовый
      номер и код ревьюера — по разделу «App Store Connect» выше.
- [ ] Скриншоты и описание, TestFlight: сначала сами, потом пара бегунов из клуба.

### Пока ждём ответы, в коде

- [ ] Android на устройстве: smoke на эмуляторе Pixel_8 уже прошёл (2026-10-13); Health Connect только на
      устройстве с установленным Health Connect.
- [ ] Второе устройство для проверки звонка; до него звонок проверяется Go-клиентом `cmd/lkprobe`.
- [ ] Egress: `docker compose --profile recording up -d`, запись одной сессии локально до прода.
- [x] Генератор данных `backend/cmd/seed` и k6-сценарии по `docs/testing.md`, замеры: `docs/perf/`.
- [x] Контрактные фикстуры JSON между бэкендом и клиентом: `docs/fixtures`, порядок в `docs/testing.md`.
- [ ] Этап H: ЮKassa и СБП на сайте, тариф тренера, активация по аккаунту.
