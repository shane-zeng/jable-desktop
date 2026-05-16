# Current Feature Specifications

Last verified against implementation: 2026-05-17

This directory contains implementation-backed feature specifications for Jable Desktop and the bundled Tampermonkey userscript. These files describe the current behavior of the repository as implemented, not future product intent.

The English files in this directory are the version-controlled source of truth. When a reading copy in another language is useful, create the matching `*.local.md` file beside the English spec, such as `data-sync.local.md` for `data-sync.md`. Those local files are intentionally ignored by Git and must not be treated as authoritative.

## Specification Index

- [Userscript](userscript.md): Tampermonkey exporter behavior, supported pages, export format, localization, and cache rules.
- [Desktop App](desktop-app.md): user-facing Electron/Vue desktop behavior, including Browser, Local Data, Settings, video cards, and Pending Sync.
- [Browser Runtime](browser-runtime.md): embedded `WebContentsView` browser runtime, tab policy, navigation, fallback origin handling, ad blocking, fullscreen, context menus, and update checks.
- [Data And Sync](data-sync.md): collections, local storage, search, quick/full sync, AJAX acceleration, outbox handling, pending remote operations, and JSON import/export.
- [Download Manager](download-manager.md): Download List, FFmpeg detection, managed local MP4 files, source-card download states, and OS default-player handoff.
- [IPC Contract](ipc-contract.md): renderer-to-main `window.jableApp` boundary, IPC groups, preload event flow, and validation rules.
- [Testing And Validation](testing-validation.md): automated test coverage map, quality gates, and manual validation checklist.

## Source Of Truth

Use source code and tests as the final source of truth when a user guide, changelog, or specification appears stale. The most important implementation references are:

- `jable-favourites-exporter.user.js`
- `app/app-contract.ts`
- `app/types/jable.ts`
- `app/ipc-normalizers.ts`
- `app/main.ts`
- `app/preload.ts`
- `app/webview-preload.ts`
- `app/webview-preload-helpers.ts`
- `app/data-engine.ts`
- `app/database.ts`
- `app/downloads.ts`
- `app/download-helpers.ts`
- `app/renderer-src/App.vue`
- `app/renderer-src/composables/useBrowserBounds.ts`
- `app/renderer-src/composables/useLibraryState.ts`
- `app/renderer-src/composables/usePendingRemoteActions.ts`
- `app/renderer-src/composables/useSyncWorkflow.ts`
- `app/renderer-src/composables/useToastStatus.ts`
- `native/local-data-engine/src/*.rs`
- `docs/development.md`
- `docs/shortcuts.md`
- `test/**`

## Documentation Rules

- Keep public user guidance in `docs/README.*.md`.
- Keep implementation-backed feature behavior in `docs/specs/*.md`.
- Keep local reading copies for other languages in matching `docs/specs/*.local.md` files.
- Do not update `CHANGELOG.md` for normal specification maintenance.
- When behavior changes, update the relevant spec in the same pull request as the implementation or test change.
- When an IPC payload shape changes, update [IPC Contract](ipc-contract.md) and `app/types/jable.ts` together.
- When sync, search, migration, or import/export behavior changes, update [Data And Sync](data-sync.md) and the matching Node/Rust tests together.
