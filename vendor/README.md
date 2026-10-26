# Base UI

`@pdlc/ui` поставляется локальным package archive, чтобы установка форка не
зависела от соседнего checkout или непубличного npm registry.

- Источник: [FerrPOINT/services-base](https://github.com/FerrPOINT/services-base).
- Ревизия: `.base-ui-revision` в корне форка.
- Контракт: [PR 353](https://github.com/FerrPOINT/services-base/pull/353).
- Версия пакета: `0.3.0`.
- Fingerprint UI/reference и SHA-256 archive: [base-ui.json](base-ui.json).

Guard сверяет source pin, fingerprint-имя и SHA-256 байтов archive. Обычные
`file:` зависимости остаются запрещены; проверенный Base archive разрешён
только этим двум потребителям в `dependencies`.

Оба потребителя (`apps/web` и `apps/daemon`) используют один archive через
`file:` dependency и lockfile. В нём присутствуют public JS entry points
`application-access` и `theme-preference`; daemon не требует TypeScript loader.

Для обновления: получить точную новую ревизию Base в отдельном checkout,
выполнить проверки UI и `pnpm --dir base-modules/ui pack --pack-destination <output>`,
поместить archive с новым fingerprint в эту директорию, обновить pin,
обе зависимости, lockfile и `base-ui.json`. Удалить прежний task-owned archive.
Затем выполнить `pnpm --dir apps/web exec pdlc-ui check` и интеграционные проверки.
SDK и skills pins это действие не изменяет.
