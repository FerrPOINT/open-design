# Локальная приёмка установленного OpenDesign

Дата: 2026-10-27. Окружение: `pdlc3`, существующая установка PDLC3.
URL: `http://127.0.0.3:8193/`. Production не изменялся.

Это протокол штатной установки, отдельный от [раннего QA-контура](pdlc-acceptance.md).
Устройство и команды описаны в [integration guide](pdlc-integration.md) и
[Base runbook](https://github.com/FerrPOINT/services-base/blob/feat/opendesign-installed/docs/platform/OPENDESIGN_OPERATIONS.md).

## Версии поставки

| Компонент | Проверенная версия |
| --- | --- |
| OpenDesign app code / OCI revision | `f670c702c0bc8139cd742b15bb6df414d9219040` |
| OpenDesign immutable image | `sha256:f02e0517aa0ec6ee2d139999b91ab019cbf0720c58426b282e2dd646e0c59a36` |
| Base UI source pin | `de34459b2fcbb1a340c2d7379c401b6912f755b3` |
| Base UI archive / fingerprint | [vendor metadata](../vendor/base-ui.json) |
| Дополнение operator | `50d4d257858a475f965d2e48db7440a008090dcc` |
| Pinned установленный owner | `6f39deee223c4b6c885c0b2c1dc0b84c79c7c44c` |
| Legacy Auth maintenance source | `04d066fc6f086c3a5222c7e1d1a6c3d164c003d6` |
| Legacy Auth SDK overlay | `19a7a381ae6dbea61a643bb96189e483fa64df5c` |
| Auth immutable image | `sha256:f60d995d248aa9897b1a6fcf7774c9d876d4cd8faf532625544c0cebf6e2c82b` |

Документирующие commits после app revision не меняют байты проверенного образа.
Source PR: [OpenDesign #2](https://github.com/FerrPOINT/open-design/pull/2),
[Base #367](https://github.com/FerrPOINT/services-base/pull/367).
Maintenance Auth опубликован отдельной веткой старой установленной версии;
его нельзя целиком переносить в современный `base-auth` без адаптации layout.

## Source и сборка

На интегрированной вехе прошли root guard, workspace typecheck, сборка CLI,
web export и Linux daemon image. После последних изменений авторизации повторены
затронутые границы: 34 auth-теста, daemon TypeScript compilation и финальная
сборка образа из чистого `f670c70`. Последний guard также прошёл на `f670c70`.
Полные daemon/web suites локально не запускались согласно AGENTS.md.

Проверены CLI transport/exit, URL loopback, operation scopes, MCP forwarding,
Base controls/Settings/theme и переводы общего switcher. В Base прошли 27 UI-тестов,
UI typecheck и проверка regenerated reference; последние operator checks —
26 image/CAS/retention и 11 optional installation/registration/archive тестов.

Legacy Auth собран с прежними pinned SDK/toolchain: fmt, clippy с запретом warnings,
12 unit tests и release build. Отдельный lifecycle test выполнен на настоящем
PostgreSQL после восстановления scoped backup: PAT expiry/revoke/no fake SID,
старый introspection response и `prompt=none` с разрешённым/запрещённым callback.
Тест действительно выполнялся, а не был пропущен из-за отсутствия БД.

Hosted checks у PR на момент readback отсутствуют; это не успешный hosted CI.

## Установка и сохранность владельцев

Установлен один optional daemon/web service с отдельным постоянным томом,
readonly root, непривилегированным UID и loopback listener. Новый Base host
не создавался. Платный модельный backend не подключался.

OIDC client, token service, CORS origin и approved Admin declaration добавлены
штатным оператором. Существующие clients, девять прежних записей каталога,
пользователи и signing keys сохранены. Новый элемент содержит `health.read` и
`ui.render`; QA peer отсутствует. После обновления Auth прежняя сессия и JWKS
проверены повторно. `prompt=none` без сессии возвращает корректный `login_required`,
а не скрытую страницу ввода пароля.

Существующий legacy Auth публикует общий каталог доверенным активным людям с
`enforced: false`. Персональные ACL не вводились. Scoped tests проверяют отказ
при отсутствии admission; установленный legacy owner не объявляется системой
персональных разрешений.

## Данные и откат

Проверено согласованное BackupData с остановкой только OpenDesign и возвратом
сервиса. RestoreData восстановил архив в новый изолированный том: совпали файлы,
mode, UID/GID; рабочий том не изменялся. Контрольный HTML сохранился после restart.

| Доказательство | SHA-256 |
| --- | --- |
| Архив данных | `59fa6c4b03a42f676b3b0e2a539b18aa963e25cd2ee8ad4e198cd5339b27736a` |
| Нормализованное дерево восстановления | `189bf0271ba48d486a1179e18bc7b008c64c7ae22cfb8ad392bc7196aca5bb20` |
| Restore receipt | `94ea811bc1dbe272ac0e02d749e0812fd2714d04854866dd7420720f91ff31ad` |
| Контрольный HTML | `8bd1646ac7fcefeedc328957d6d72ebca6527858fcf9358eb2fc9ff03d7da2c0` |
| Полный OCI archive первого квалифицированного образа | `63caddb3999ea1623072aa5422c3f898ffe9cbedb838769c0e68f00b64e6f3f5` |

Полный image archive — 608016896 bytes, проверены hash/size всех 24 OCI blobs.
Архивы, планы, credentials и rollback journals хранятся приватно вне Git.
Daemon data paths определены только в [корневом контракте](../AGENTS.md#daemon-data-directory-contract).

Реальный отрицательный update временно заменил private Auth transport только у
OpenDesign недоступным адресом. API вернул 503, native Windows CLI — JSON/exit 1
без аварии, MCP отклонил инструмент. После намеренного отказа acceptance callback
operator восстановил точные исходные bundle bytes, затем scoped Start вернул
здоровую студию на `f670c70` с прежним HTML. Это проверка **конфигурационного отката
первой квалифицированной поставки**, без миграции или отката данных.

При ранней попытке откатиться на промежуточный `d968d68` обнаружены отсутствующие
слои после переиспользования build tag. Проверки SQLite на уже имевшемся snapshot
оказалось недостаточно. Этот промежуточный образ исключён из rollback baseline;
восстановление выполнено по приватному журналу только для OpenDesign. Operator
теперь удерживает старый и новый image manifest до остановки сервиса, сборки имеют
отдельные revision tags, а квалифицированный образ дополнительно архивирован
с полной проверкой слоёв. Частичный архив metadata не считается образом для отката.

## Границы приёмки

Published branding в этом Admin отсутствует (`BRANDING_NOT_PUBLISHED`); в runtime
используются штатные Base defaults и выбранная тема. Загрузка опубликованного
branding проверена на компонентной границе; глобальный branding ради теста
не публиковался. Настройка реального модельного провайдера остаётся операторской
настройкой общей студии, без маршрутизации через AI Hub.

Финальные CLI/MCP, IAB и runtime readback дополняются после выполнения.
