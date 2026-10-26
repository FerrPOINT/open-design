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

HTTPS обязателен, кроме loopback для локальной проверки. Частичная конфигурация
отклоняется при старте; отсутствие или пустые значения всех полей сохраняют
standalone upstream mode. Собственный origin добавляется к существующей проверке
Origin daemon. HTML оболочки разрешает embedding только `self` и точному host origin.
Frontend получает только публичную конфигурацию; ключи подписания Central Auth
и пароли ему не передаются. Daemon-managed data и тестовое хранение следуют
[Daemon data directory contract](../AGENTS.md#daemon-data-directory-contract).

Разработка ведётся в отдельной ветке текущего workspace. AI Hub, production,
общие установленные stacks, их данные и конфигурация не изменяются.

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
| Base host | Добавить service key `open-design`, собственный origin и свободный публичный path в существующую topology configuration |
| OpenDesign | Задать пять runtime-переменных выше; для полного переключения указать host и catalog выбранного окружения |

[Пример публичных записей](../deploy/pdlc-registration.example.json) показывает
форму owner-контрактов, а не готовую конфигурацию установки. Заменить example
origins, проверить свободный path и объединить записи с существующими списками.
`runtime_catalog_service` — ожидаемая публичная проекция Admin; её регистрация
выполняется штатным механизмом Admin, а не записью JSON в обход владельца.
Пример не заменяет release manifest и не применяется к работающему стеку.
`ui.render` нужен для появления `ui_url` в каталоге Admin. `health.read`
использует его фиксированный `GET /health`; daemon публикует этот probe тем
же обработчиком, что и прежний `/api/health`, без SPA fallback.

Регистрация метаданных в каталоге Auth не подтверждает поддержку PAT самим
OpenDesign: этот режим принимает браузерный JWT с проверенным SID. Machine
delegation не выдаётся автоматически из факта существования service key.

Нужен совместимый Central Auth с browser SID, `/auth/access` и CORS для
зарегистрированного callback origin. Наличие `/health` и JWKS у старой версии
Auth не доказывает этот контракт. Отсутствующий owner endpoint закрывает доступ
с `503`; legacy shared token не становится обходом. Обновление установленного
Auth выполняется отдельной согласованной поставкой, не этой задачей исходников.

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

Интеграция в разработке. Файл не подтверждает runtime acceptance. Проверки,
точные revisions, порядок подключения и оставшиеся ограничения записываются
по фактической реализации перед публикацией PR.
