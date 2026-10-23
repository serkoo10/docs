# План

Этапы A–G закрыты, см. таблицу в [architecture.md](architecture.md). Ниже — что осталось.
Пункт без ссылки на issue ещё не заведён как задача: `pnpm tasks runclub` в репозитории
docs создаст issue и допишет ссылку.

## G. Публикация

- [ ] Пройти ручные шаги беты из release.md: TestFlight, Google Play, RuStore ([#1](https://github.com/serkoo10/runclub/issues/1))

## H. Оплата

- [ ] ЮKassa: оплата тарифа тренера через сайт, СБП ([#2](https://github.com/serkoo10/runclub/issues/2))
- [ ] Партнёрка по слотам ([#3](https://github.com/serkoo10/runclub/issues/3))

## I. Видео

- [ ] Проверить живой звонок и трансляцию на устройствах (iOS, Android) ([#4](https://github.com/serkoo10/runclub/issues/4))
- [ ] Запись сессии и библиотека уроков клуба на устройствах ([#5](https://github.com/serkoo10/runclub/issues/5))

## J. Интеграции

- [ ] Проверить Polar и Strava с реальными аккаунтами ([#6](https://github.com/serkoo10/runclub/issues/6))
- [ ] Garmin и COROS, когда дадут доступ к API ([#7](https://github.com/serkoo10/runclub/issues/7))

## K. SwiftUI для iOS

Нативное приложение в `ios/` заменяет Flutter на iOS; `app/` остаётся для Android.

- [ ] Каркас SwiftUI-приложения: проект, тема, строки, API-клиент с refresh, Keychain, сессия ([#8](https://github.com/serkoo10/runclub/issues/8))
- [ ] SwiftUI: вход (телефон, Apple, VK), онбординг, профиль, удаление аккаунта ([#9](https://github.com/serkoo10/runclub/issues/9))
- [ ] SwiftUI: главная, клубы, тренировки и HealthKit, достижения, синхронизация ([#10](https://github.com/serkoo10/runclub/issues/10))
- [ ] SwiftUI: забеги, кроссовки, переписка, жалобы и блокировка ([#11](https://github.com/serkoo10/runclub/issues/11))
- [ ] SwiftUI: онлайн-сессии и уроки (LiveKit, AVKit), Polar и Strava ([#12](https://github.com/serkoo10/runclub/issues/12))
- [ ] SwiftUI: подготовка к TestFlight — privacy manifest, иконка, release.md ([#13](https://github.com/serkoo10/runclub/issues/13))
