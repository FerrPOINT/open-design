# Интеграция OpenDesign с PDLC

## Границы реализации

OpenDesign поставляется одной общей студией на окружение. Central Auth владеет
пользователями и сессиями, Base UI — общей оболочкой и навигационным протоколом.
Локальные проекты upstream остаются общими ресурсами доверенной студии;
интеграция не вводит личные проекты, приглашения или новые роли.
Допуск к приложению проверяется через действующий `/auth/access`, включая
application key `open-design`. Доступ к студии подразумевает работу с её общими
проектами и агентными инструментами. Это не sandbox для недоверенных исполнителей.

Cloud/Vela membership не выводится из identity PDLC. Серверная Cloud-сессия
upstream не является личной сессией каждого вошедшего пользователя PDLC.
Доступные платформенному пользователю операции должны соблюдать эту границу.
Изоляция произвольного агентного кода не доказывается ни SSO, ни переменной
upstream sandbox mode: перед установкой оператор определяет доверенный scope
студии и её процессов. Отдельные студии на пользователя не создаются.

## Конфигурация

Платформенный режим задаётся daemon runtime configuration:

| Переменная | Назначение |
| --- | --- |
| `OD_PDLC_AUTH_ISSUER` | Точный публичный issuer Central Auth |
| `OD_PDLC_CLIENT_ID` | Зарегистрированный OIDC client ID |
| `OD_PDLC_PUBLIC_ORIGIN` | Собственный origin web/API OpenDesign |
| `OD_PDLC_HOST_ORIGIN` | Необязательный origin persistent host Base |
| `OD_PDLC_CATALOG_URL` | Необязательный публичный runtime catalog Admin |
| `OD_PDLC_BRANDING_URL` | Необязательный published runtime branding Admin |
| `OD_PDLC_AUTH_INTERNAL_ORIGIN` | Только сервер: private transport Central Auth; публичный issuer неизменен |
| `OD_PDLC_TRACKER_URL` | Только сервер: явный origin Task Tracker для каталога проектов текущего пользователя |

HTTPS обязателен, кроме loopback для локальной проверки. Частичная конфигурация
отклоняется при старте; отсутствие или пустые значения всех полей сохраняют
standalone upstream mode. Собственный origin добавляется к существующей проверке
Origin daemon. HTML оболочки разрешает embedding только `self` и точному host origin.
Frontend получает только публичную конфигурацию; ключи подписания Central Auth
и пароли ему не передаются. Daemon-managed data и тестовое хранение следуют
[Daemon data directory contract](../AGENTS.md#daemon-data-directory-contract).

Разработка ведётся в отдельной ветке текущего workspace. AI Hub, production,
остальные установленные приложения, их данные и конфигурация не изменяются.
Локальная установка OpenDesign в `pdlc3` выполняется отдельной operator-процедурой;
это не production deployment.

## Регистрация в PDLC

Оператор обновляет декларации выбранного окружения обычным способом; установка
не выполняется автоматически при сборке форка. Для платформенного режима нужен
образ, собранный из этого форка, а не upstream `ghcr.io/nexu-io/od`.

| Владелец | Изменение |
| --- | --- |
| Central Auth | Добавить точный client ID и `OD_PDLC_PUBLIC_ORIGIN` + `/sso/callback` в `AUTH_OIDC_CLIENTS_JSON`, сохранив существующие clients |
| Central Auth | Добавить `{ "key": "open-design", "label": "OpenDesign" }` в `AUTH_ADDITIONAL_TOKEN_SERVICES_JSON`, сохранив существующий каталог |
| Central Auth / Admin | При включённом application access предоставить нужным пользователям доступ `open-design` штатным управлением; роль из JWT не заменяет свежий proof |
| Admin | Создать и одобрить declaration `open-design` с `health.read`, `ui.render`, проверенным integration URL и `public_ui_url`; каталог не содержит credentials |
| Base host | Только для embedding: добавить приложение в существующую topology; отдельный host для standalone-студии не нужен |
| OpenDesign | Задать issuer/client/public origin и настоящий Admin catalog; branding и embedding host необязательны |

[Пример публичных записей](../deploy/pdlc-registration.example.json) показывает
форму owner-контрактов, а не готовую конфигурацию установки. Заменить example
origins, проверить свободный path и объединить записи с существующими списками.
`runtime_catalog_service` — ожидаемая публичная проекция Admin; её регистрация
выполняется штатным механизмом Admin, а не записью JSON в обход владельца.
Пример не заменяет release manifest и не применяется к работающему стеку.
`ui.render` нужен для появления `ui_url` в каталоге Admin. `health.read`
использует его фиксированный `GET /health`; daemon публикует этот probe тем
же обработчиком, что и прежний `/api/health`, без SPA fallback.

Регистрация метаданных в каталоге Auth не выдаёт токен и не заменяет admission.
Браузер использует JWT с настоящим SID; PAT проходит отдельную introspection
без фиктивной браузерной сессии. Подробности — в разделе CLI и MCP ниже.

Нужен совместимый Central Auth с browser SID, `/auth/access` и CORS для
зарегистрированного callback origin. Наличие `/health` и JWKS у старой версии
Auth не доказывает этот контракт. Отсутствующий owner endpoint закрывает доступ
с `503`; legacy shared token не становится обходом. Для legacy Auth совместимость
поставляется отдельным узким backport с сохранением БД, signing keys и SDK pin.

## Поведение авторизации

Access token хранится в памяти frontend. Daemon создаёт непрозрачную HttpOnly,
SameSite=Lax cookie-привязку; при HTTPS используется Secure и префикс `__Host-`.
Cookie name зависит от issuer и собственного origin, поскольку порты сами по
себе не изолируют cookies. Привязка не является отдельной системой сессий:
каждый защищённый запрос проверяется через JWKS и актуальные `/auth/access` и
`/auth/me` Central Auth. Restart требует восстановления через общий PKCE flow.

Повторный PKCE exchange с тем же SID/subject обновляет credential существующей
привязки и сохраняет текущие streams/runs. Другой SID или subject отзывает
предыдущую привязку. Logout закрывает её активные ответы; истечение proof
ограничивает продолжение долгоживущего ответа. Ошибки `401`, `403`, `429` и
недоступность owner (`503`) обрабатываются раздельно.

Preview использует существующий узкий capability проекта с привязкой к исходной
проверенной сессии. Run tool tokens сохраняют прежние ограничения endpoint,
operation и project; server-only authority не входит в публичный grant и
не передаёт агенту общий access token. Отзыв исходной сессии прекращает такой доступ.
Plugin preview/assets допускают точный host origin в `frame-ancestors`;
остальные sandbox directives, включая `connect-src 'none'`, сохраняются.

Общий выход сначала скрывает studio state и отзывает локальную привязку, затем
передаёт выход Central Auth через существующий SSO flow. Сбой локального HTTP
не блокирует центральный logout. Другие документы получают только invalidation,
без токенов/профилей; получатель не публикует событие повторно. Смена subject
перезагружает документ, чтобы отбросить module caches upstream.

В платформенном режиме process-wide Cloud identity не выдаётся за текущего
пользователя: `/api/workspace/context` возвращает `context: null`, directory —
пустой список без active Workspace. Это отсутствие Cloud identity, а не отказ
платформенного входа; локальные deep links не уходят обратно в onboarding.
Cloud workspace mutations,
wallet/login и AMR endpoints отвечают явным отказом. Локальные CLI и BYOK остаются
предметными настройками студии. Подключение личного Cloud требует отдельного
серверного identity binding; текущая интеграция его не имитирует.
Платформенный onboarding показывает Local CLI/BYOK без повторного Cloud login
и предложений Cloud credits. Standalone onboarding сохраняется.

## Проверки разработчика

Быстрый HTTP gate без сборки всего CLI:

```sh
pnpm --filter @open-design/daemon exec vitest run -c vitest.pdlc.config.ts
pnpm --filter @open-design/web exec vitest run tests/pdlc-app.test.tsx tests/router.test.ts tests/router.navigate.test.tsx tests/state/appearance.test.ts --maxWorkers=1
```

HTTP tests используют собственные listeners, подписанные fixture JWT и тестовый
owner; component tests подменяют SSO exchange и редактор. Они проверяют контракты,
но не заменяют полный build, настоящий daemon, Central Auth и браузерную приёмку.
Native Node дополнительно должен загружать `@pdlc/ui/application-access` без
TypeScript loader. В Base для этого публикуется проверяемый generated JS из
канонического TypeScript source, общий с React provider.

Excalidraw 0.18.1 объявляет поддержку React 19, но закрепляет старый Radix Tabs
1.0.2 с peers только до React 18. Scoped dependency override обновляет именно
его до совместимого 1.2.1; это замена runtime-зависимости, а не подавление peer
diagnostics. Canvas/диалоги проверяются отдельно на интегрированном candidate.

## Состояние

Первоначальная интеграция — [PR #1](https://github.com/FerrPOINT/open-design/pull/1),
текущая доработка — [PR #2](https://github.com/FerrPOINT/open-design/pull/2).
[Исторический протокол](pdlc-acceptance.md) относится к отдельному QA-контуру.
[Приёмка установленной студии](pdlc-installed-acceptance.md) фиксируется отдельно;
source PR не заменяет её.

## Авторизованный CLI и MCP

Существующий `od` и его `--daemon-url` сохраняются. Для установленной студии
оператор передаёт личный Central Auth PAT через `PDLC_API_TOKEN`, без собственного
login или credential store. Не записывать значение токена в команды, историю
или документы. Пример вызова с уже установленной переменной окружения:

```sh
corepack pnpm exec od status --json --daemon-url http://127.0.0.3:8193
corepack pnpm exec od project list --json --daemon-url http://127.0.0.3:8193
corepack pnpm exec od project list --tracker-project none --json --daemon-url http://127.0.0.3:8193
```

Команды выполняются из корня checkout нашего форка после штатной сборки daemon.
Адрес выше относится только к локальной установке PDLC3; для другой установки
используют её адрес через `--daemon-url` либо `OD_DAEMON_URL`.
Глобальная установка и изменение PATH не требуются. Запуск `od` без подкоманды
запускает локальную студию, поэтому для управления общей установкой используют
явные подкоманды. `od` управляет содержимым студии; OpenCode выполняет генерацию
на сервере, а существующий оператор PDLC управляет установкой и backup/restore.

Фильтр `--tracker-project` принимает UUID или `none` («Без проекта»); отсутствие
флага сохраняет полный доступный список. MCP `list_projects` принимает такой же
необязательный `trackerProjectId`, а `create_project` — UUID для назначения
привязки через metadata. Без него новая работа остаётся «Без проекта».
При назначении нужен также текущий доступ к проекту и право чтения Tracker;
токен другого сервиса не подставляется. Фильтр не создаёт ACL.

Для CLI create существующий `--metadata-json <файл|->` принимает JSON-объект,
например `{"kind":"prototype","trackerProjectId":"<Tracker-UUID>"}`.
Ошибка чтения, JSON, null или массив дают `CLI_USAGE`, exit 2 до создания работы.
При `--json` HTTP-ошибки возвращаются в stderr как JSON; stdout предназначен для
успешного результата. Ошибки не требуют отдельного login или хранилища токенов.

PAT проверяется через `/auth/tokens/introspect?include_lifetime=true`: текущий
допуск `open-design`, срок действия и scopes. Чтение требует `open-design:read`,
изменение — `open-design:write`. MCP использует те же защищённые HTTP операции;
локальные `initialize` и перечисление инструментов сами по себе не дают доступа.
Успех CLI возвращает exit 0; отказ авторизации — structured JSON error и exit 1.
Существующие специальные exit codes upstream сохраняются.
Узкий server-issued tool token имеет приоритет над PAT и не расширяет свои права.

HTTP транспорт передаёт PAT только явно выбранному daemon target. Перенаправление
credentials запрещено; ошибки сети не воспроизводят URL или секрет. Timeout до
получения заголовков — 30 секунд; открытые потоки контролируются серверным сроком
owner proof. Авторизация пересматривается на каждом запросе и до deadline во
время потока/фоновой генерации. Жёсткий deadline продолжает действовать, пока
ответ Auth ожидается; поздний ответ не возобновляет закрытую операцию.
Отзыв прекращает дальнейшую работу; завершённые
файлы общей студии сохраняются. `401`, `403`, `429` и `503` различаются.

## Общий интерфейс

`PlatformProvider` получает published branding Admin. Отсутствие опубликованной
ревизии сохраняет штатный Base fallback. Выбранная тема применяется существующим
prepaint-механизмом до React. Язык шапки следует языку OpenDesign, с fallback
Base для остальных локалей. По уточнению пользователя от 2026-10-27 интеграция
ограничена палитрой, переключением приложений, общей авторизацией и выбором
проекта Task Tracker в верхней панели. Кнопки, поля, селекты, диалоги, уведомления,
настройки и предметная компоновка остаются исходными OpenDesign в обоих режимах.
Массовая замена продуктовых controls на Base отменена.

Каталог проектов поступает только из `GET Task Tracker /api/v1/projects` через
защищённый same-origin `GET /api/pdlc/projects`. Daemon передаёт browser bearer
текущего пользователя по явному installation transport, без service credential,
перенаправлений и собственного каталога. Tracker применяет свои права. Ошибка
или пустой каталог не подменяется проектами студии. Выбор хранится в текущей
вкладке отдельно для subject. Новая работа получает необязательный
`metadata.trackerProjectId`, проверенный по каталогу Tracker от текущего
пользователя. Это классификация общей студии, не grant и не ACL. Обычный
metadata patch сохраняет привязку; перенос между проектами не поддержан.
Копия работы наследует привязку, импорт и создание из шаблона получают выбранную.
Пути импорта/шаблона передают её заголовком `X-PDLC-Tracker-Project`;
обычный create и CLI используют metadata (`od project create --metadata-json`).
PAT для назначения должен иметь также требуемый Tracker доступ; сервисного
токена и расширения browser-only каталога для PAT не вводится.

`GET /api/projects?trackerProjectId=<UUID>` фильтрует по привязке;
`trackerProjectId=none` возвращает работы без неё. Без параметра API сохраняет
прежнее поведение. Web использует один контекст для списка, недавних работ
и поиска. Старые работы остаются «Без проекта», где разрешено создание и при
пустом каталоге. Deep link синхронизирует шапку с работой, смена выбора открывает
другой список после штатной проверки несохранённых изменений. Недоступность
Tracker не удаляет файлы. Legacy Tracker v1 не объявляется ProjectAccessV2.

## Поставка и восстановление

Штатная поставка использует один образ форка с OCI source/revision и immutable
image ID, отдельный постоянный том, существующую сеть и loopback-порт установки.
Правила daemon data root определены только в [AGENTS.md](../AGENTS.md#daemon-data-directory-contract).

Порядок: квалифицировать Base operator → собрать и проверить форк → подготовить
закрытый installation request → добавить OIDC/application catalogs с сохранением
существующих записей → установить optional service → одобрить декларацию Admin
с `health.read` и `ui.render` → проверить CLI и IAB. QA peer не устанавливается.

Использовать существующий `pdlc_operator` с явными `--root` и `--installed`.
Команды `Start`, `Stop`, `Status`, `Logs` направляются только в выбранный сервис.
`BackupData --output` останавливает только OpenDesign, архивирует согласованные
файлы и возвращает сервис. `RestoreData --archive --target-volume` восстанавливает
только в новый изолированный том и сравнивает содержимое, права и владельцев.
Архив содержит проекты и может содержать секреты upstream; хранить его приватно.
Полный legacy backup не заменяет эту явную файловую копию optional-приложения.

Обновлять только OpenDesign через operator image/CAS plan, сохраняя прежний image,
точную конфигурацию и совместимую копию данных. Неудачный первый запуск возвращает
исходный sealed bundle; неудачное обновление возвращает предыдущую конфигурацию
и image pointer, оставляя сервис остановленным. После проверки journal и
совместимости данных оператор выполняет scoped `Start`. До остановки operator
удерживает старый и новый образы content-addressed тегами; сборочный revision tag
не переиспользуется для следующей версии. Данные автоматически не удаляются
и не перезаписываются.
Для несовместимой миграции требуется отдельное восстановление в новый том.
Source checks, image build, установка и пользовательская приёмка фиксируются
отдельно в [installed acceptance](pdlc-installed-acceptance.md).
