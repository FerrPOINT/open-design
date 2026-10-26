# Проверка интеграции PDLC

Дата: 2026-10-27. Source delivery:
[OpenDesign PR #1](https://github.com/FerrPOINT/open-design/pull/1),
[Base PR #353](https://github.com/FerrPOINT/services-base/pull/353).
Merge, установка в общие окружения и production deployment не выполнялись.

## Контур и границы доказательств

Проверки выполняются на собственных тестовых пользователях и проектах:
реальный Central Auth и PostgreSQL в отдельном временном Compose project,
нативный daemon OpenDesign со статическим production web export и настоящий
production build Base host. Жизненным циклом daemon управляет `tools-dev`.
Daemon-managed данные следуют [корневому контракту](../AGENTS.md#daemon-data-directory-contract).

После приёмки HTTP gate повторён на финальном candidate: все 16 проверок прошли.
Собственные daemon/host/peer listeners и временные Auth/PostgreSQL остановлены;
отсутствие их процессов, контейнеров и listeners проверено. Общие stacks не изменялись.

Auth собран из Base `26e678d4a11d3a9e92b1457c745fd6ef8375ac2e`;
immutable image ID:
`sha256:98ab5b036bc6ea4aa1746cc9b5b28a11b1bf5958088b1c65470bda830cb20357`.
UI source pin, archive hash и fingerprint находятся в
[vendor metadata](../vendor/base-ui.json). Последующий Base commit меняет
только документацию и не требует нового UI archive.

Квалифицированный app code: `9be8c7781268581c1b6eac1f881871110b8cb2f1`.
SHA-256 production `index.html`:
`7e913a6061e739091a4d4cd831ad3c6351e235d3065e75065b6ccc0237f8bd71`.
Байты HTTP-ответа совпали с собранным файлом. Следующие task commits обновляют
только документацию; версии и pins исходников от этого не меняются.

Каталог и второе приложение являются явно обозначенными QA fixtures.
Это проверка существующего host protocol, а не приёмка установленного Admin
или второго продукта. AI Hub не используется и не изменяется.

## Source и автоматические проверки

- Root `guard` и workspace `typecheck` прошли. После исправлений повторяются
  только затронутые scoped checks и web production build.
- Daemon: 103 теста в семи файлах — verifier, admission, cookie transport,
  origin, Cloud boundary, scoped preview/tool authority и stream lifecycle.
- Web: 84 теста auth/router/appearance/manual editing; затем 13 auth-тестов
  после добавления проверки выхода из запрещённого аккаунта.
- Onboarding: платформенный Local CLI/BYOK без Cloud CTA и два соседних
  standalone Cloud сценария — три теста.
- Workspace: три focused теста dirty sketch guard, inline safe exit и flush
  sketch autosave при unmount. После успешного сохранения guard снимается.
- Canvas: 46 тестов default color, сохранения и прежней SVG palette. Excalidraw
  получает канонический цвет нового пера; theme transform принадлежит renderer.
  Цвета существующих элементов не переписываются.
- Manual HTML: 17 тестов. Новые success/failure сценарии воспроизвели потерю
  inspector draft до исправления; safe exit теперь сохраняет его существующим
  write path, а ошибка записи запрещает уход и сохраняет черновик.
- Base native runtime: два теста подтверждают свежесть generated JS и загрузку
  публичного access entrypoint без React и TypeScript loader.
- UI reference check: 139 компонентов, 760 файлов; fingerprint совпадает с pin.

Полные daemon/web test suites не запускались согласно правилам репозитория.
Hosted checks у обоих PR отсутствуют; это не результат успешного CI.
OpenDesign проверяется на Node 24 и pnpm 10.33.2. Base проверен на этом же Node;
его заявленный Node engine 22 отдельно в этой поставке не квалифицирован.

## Живой HTTP gate

16 проверок на настоящих Auth и daemon прошли: анонимные API, raw file,
artifacts, frames и MCP закрыты; legacy bearer не принимается; пользователь
без application grant получает `403`, допущенный — `200`; поддельный workspace
и чужой Origin отклоняются. Невалидный явный bearer не использует cookie.

Cookie позволяет разрешённое чтение файла. Локальный logout отзывает binding
и закрывает реальный project SSE. Central Auth logout делает ранее выданный
bearer непригодным. `/health` возвращает JSON настоящего probe, а не SPA fallback.
Cloud directory возвращает пустой каталог; Cloud context отсутствует.

## Браузерная приёмка

Используется только Codex IAB. Подтверждены настоящий PKCE login, профиль
Central Auth, восстановление через общую сессию без ввода пароля, открытие
deep link и проекта после сохранения. HTML изменён через штатный inspector,
сохранённый результат подтверждён повторным открытием и серверным чтением.
Excalidraw создаёт фигуру и сохраняет её; light/dark/gray переключаются через
общий account menu. После reload сохранённая фигура видима во всех трёх темах;
сервер подтвердил исходный canonical stroke color. Скриншоты проверены визуально.

Общий logout убирает редактор и профиль из другого открытого документа.
Запрещённый аккаунт видит отказ без студии и может завершить SSO. После
изменения допуска в собственных fixture-данных второй аккаунт отображается
своим именем/email; законно общий проект остаётся доступен.

Base host открывает OpenDesign по прямому адресу, принимает readiness и
отражает канонический продуктовый маршрут. Back/Forward между адресами
OpenDesign и QA peer восстанавливают ожидаемые host routes. Отказ в доступе
появляется в host без раскрытия студии.

Интерактивное переключение OpenDesign → QA peer → OpenDesign подтверждено
в persistent host. Уход с новым штрихом вызывает настоящий confirm; отмена
сохраняет текущий editor route. После автосохранения переключение проходит без
предупреждения. Host reload восстанавливает аккаунт и прежний canvas route.
HTML inspector draft сохраняется перед внутренним уходом; серверное чтение
подтвердило новую строку после перехода на главную.

High-level input IAB в cross-origin iframe сначала завершался ошибкой target.
Проверка продолжена через документированную CDP capability того же Codex IAB:
только обычные pointer events, без изменения DOM или программной подмены
продуктового состояния. Другой браузер и standalone Playwright не использовались.

## Модель исполнения и следующий этап

Допущенные доверенные пользователи работают с общими локальными проектами и
инструментами студии. Приватные project ACL, новые роли и изоляция недоверенного
агентного кода не реализуются и не обещаются. Cloud/provider identity отделена
от PDLC. Установленный Central Auth должен поддерживать browser SID и свежий
`/auth/access`; старый runtime не обновляется этим PR.

Во время первоначального onboarding upstream автоматически запустил один CLI
smoke, завершившийся за 12,3 секунды. Стоимость в app log не записана. После
обнаружения QA закреплён за штатным fake agent; дальнейшие проверки не вызывают
модельного провайдера. Стоимость и качество реальной генерации не квалифицированы.

Дальнейшая установка использует [owner registration contract](pdlc-integration.md)
и сохраняет существующие clients/catalog/data. Приёмка установленного Admin,
production, Kubernetes и реального провайдера в эту source-поставку не входит.
