# Синхронизация форка с upstream

Источник: `nexu-io/open-design`, ветка `main`.
Синхронизация от 2026-10-28: `6bf7fa79`.
Предыдущая общая база: `1eaa2381`.
До merge рабочая ветка PDLC: `d55aa004`.

Включены все 42 новых upstream commits. История наших доработок сохраняется
обычным merge, без rebase и force push. Рабочая ветка —
`feat/pdlc-product-completion`, существующий PR #2 в `FerrPOINT/open-design`.

## Разрешение конфликтов

- CLI сохраняет PDLC bearer transport и безопасный выход на Windows,
  одновременно принимает upstream BYOK flags и редактирование секретов в выводе.
- Сервер использует один preview-scope registry для Auth и preview routes;
  новая upstream проверка размера JSON-body сохранена.
- Router сохраняет историю Base, query/fragment и подтверждение выхода из
  редактора; callbacks отмены и новая upstream observability также сохранены.
- Cloud sign-in остаётся выключенным в PDLC, включая новый ShareSignInButton;
  поведение standalone проверяется отдельно.
- React 19 и vendor Base UI сохранены. Lockfile пересогласован с merged manifests,
  включая upstream TypeScript 7. Docker сохраняет verified OpenCode runtime
  и экспорт daemon по shared lockfile, принимает новый порядок сборки приложений.

## Границы поставки

Это синхронизация исходников. Установленный OpenDesign остаётся на проверенном
`9d976d21`; новые upstream изменения в runtime не устанавливаются. Настройки,
контейнеры и данные AI Hub не меняются. Публикация `main-dev` в Hub остаётся
отдельным незакрытым этапом из [приёмки](pdlc-native-ui-acceptance.md).

Проверки слияния: адресные тесты PDLC Auth, Hub transport, router и Cloud gates;
общие guard/typecheck; новая сборка daemon перед тестом CLI. Полные daemon/web
test suites не запускать; результат этих проверок не является runtime-приёмкой.

Итог проверки: 46 web tests, 73 Auth/transport tests, 13 daemon discovery tests,
31 CLI tests — всего 163, все прошли. Общие `pnpm guard`, `pnpm typecheck`
и сборка daemon также прошли. Унаследованные пустые строки в конце трёх upstream
файлов сохранены без постороннего форматирования; собственный diff к upstream
проходит `git diff --check`.
