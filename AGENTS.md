# Repository Guidelines

## Project Structure & Module Organization

This repository contains an Electron desktop app for syncing, browsing, importing, exporting, and downloading Jable favourites and watch-later entries.

- `app/main.ts`: Electron main-process entrypoint and composition root. Keep window lifecycle, app startup/shutdown wiring, shared Electron services, and manager registration here; move domain behavior into the folders below.
- `app/main-process/`: Electron main-process domain modules. `browser/` owns the embedded browser runtime boundary: `runtime.ts` wires controllers, `tab-manager.ts` owns Browser tab/window orchestration, `shortcut-manager.ts` owns keyboard shortcut registration, `session-controller.ts` plus `session-store.ts` own browser startup session save/restore, `preload-requests.ts` owns preload request/response bookkeeping, and `origin-controller.ts` owns active Jable origin fallback policy. Native app menu and update dialogs live in `app-menu-manager.ts`, app-level local/export/documentation actions in `app-actions.ts`, app-level download quit/close gating in `download-app-shutdown.ts`, context menus in `context-menu-manager.ts`, `download/` owns download orchestration/controllers/HLS/FFmpeg/runtime state by subdomain, `hls-playback/` owns playback-triggered HLS proxy/probe/capture modules, `local-playback/` owns local video range/server/preview helpers, sync worker orchestration lives in `sync-worker-manager.ts`, IPC registration in `ipc-handlers.ts`, IPC payload normalizers in `ipc-normalizers.ts`, settings persistence in `settings.ts`, and release update fetching in `update-checker.ts`.
- `app/preload.ts`: context-isolated bridge that exposes the only renderer-to-main API as `window.jableApp`.
- `app/webview-preload.ts`: composition root and scraper/pager DOM runtime injected into embedded Jable `WebContentsView` instances.
- `app/browser/`: browser/runtime policy modules used by main, renderer, and webview preload. `browser-tab-policy.ts` owns pure tab policy helpers, `url-policy.ts` owns trusted URL rules, `webview-enhancement.ts` owns optional WebView loading rules, `webview-content-policy.ts` owns matching page cleanup rules, `webview-preload-helpers.ts` owns pure scraper/pager/AJAX helpers, and `webview-preload/` owns focused preload runtime concerns such as browser sync, collection actions, video metadata, local playback, theater mode, and HLS playback proxy observers.
- `app/sync/`: shared pagination helper logic for sync flows.
- `app/data/`: local data boundary. `collections.ts` owns app-level collection metadata shared by Electron runtime code and must stay aligned with Rust `collections()` metadata in `native/local-data-engine/src/collections.rs`; `data-engine.ts` is the Rust-backed local data engine boundary; `native-data-engine.ts` loads the built native addon.
- `app/download/`: download helper and native addon boundary for HLS playlist parsing and Rust HLS segment/key downloads.
- `native/local-data-engine/`: Rust SQLite data engine. `src/lib.rs` owns the N-API bridge and method dispatch, `src/collections.rs` owns collection metadata, `src/schema.rs` owns migrations and FTS setup, `src/search.rs` owns search tokenization, `src/store.rs` owns local list queries/upserts, `src/sync.rs` owns sync/outbox state transitions, `src/resource.rs` owns JSON import/export, and `src/rows.rs` owns row mapping structs/helpers.
- `native/download-engine/`: Rust HLS download engine. It owns sampled adaptive concurrency, bounded parallel key/segment HTTP fetching, retry, cancellation flags, temporary segment writes, and local playlist generation for main-process FFmpeg remuxing.
- `app/types/`: renderer-facing TypeScript wire types for IPC payloads and app state.
- `app/i18n/`: desktop locale dictionaries and helpers for Electron main-process and renderer UI copy.
- `app/runtime-dist/`: TypeScript-compiled Electron runtime loaded by Electron and packaged for release.
- `app/renderer-src/`: Vue 3 + TailwindCSS + TypeScript renderer source. `components/BrowserTabRail.vue` owns the reusable browser tab rail shared by Browser and Local Data modes, while `App.vue` decides whether new browser tabs opened from Local Data remain in the background.
- `app/renderer-dist/`: Vite-built renderer loaded by Electron and packaged for release.
- `test/node/`: Node test files for database behavior, import/export, sync utilities, download helpers/manager behavior, i18n, update checks, and browser tab policy.
- `test/renderer/`: Vitest renderer, component, composable, and renderer i18n tests.
- `test/electron/`: Playwright Electron startup smoke test for the real packaged-runtime boot path, the context-isolated preload bridge, and basic settings/tab IPC reachability. Keep this suite intentionally thin; behavior coverage belongs in Node, Rust, or renderer tests.
- `scripts/update-release-changelog.js`: release automation helper that updates `CHANGELOG.md` for a completed version tag.
- `docs/`: user guides, implementation-backed specs, development notes, shortcuts, and screenshots. `README.md` is only the short project entrypoint.
- `docs/refactor-opportunities.md`: no-spec-change optimization backlog and completed refactor batches. Use it as the starting point when continuing maintainability work.
- `docs/specs/`: current feature specifications backed by implementation and tests. English `*.md` specs are authoritative; matching `*.local.md` files may exist as ignored local reading copies for other languages.
- `.agents/skills/`: repo-scoped Codex skills intended for all contributors. `jable-desktop-maintenance` captures the repeatable maintenance workflow for no-spec-change refactors, architecture placement decisions, module moves, and validation selection. Keep repo skills portable: no personal paths, credentials, local-only aliases, or machine-specific assumptions. Prefer skills for judgment-heavy workflows; add repo hooks only when the behavior is deterministic, low-noise, and safe for every contributor.
- `CHANGELOG.md`: generated release history for version tags. Do not edit it during normal feature or bug-fix work.
- `AGENTS.md`: contributor guidance for future maintenance.

Put desktop runtime code under `app/`, Node tests under `test/node/`, and renderer tests under `test/renderer/`.

## Refactor Backlog and No-Spec-Change Optimization

For no-spec-change optimization candidates and completed refactor batches, start from `docs/refactor-opportunities.md`.

When asked to continue optimization or refactor work:

- Use the `jable-desktop-maintenance` skill for the repeatable placement, validation, and no-spec-change workflow.
- Do not re-analyze the full project structure first unless the user explicitly asks for a fresh audit.
- Read `docs/refactor-opportunities.md`, verify the relevant current code and tests, then implement the next selected item.
- Preserve documented behavior, IPC contracts, sync semantics, JSON shapes, and renderer UI behavior.
- If the backlog appears stale, update it as part of the same change instead of duplicating completed work.

## Build, Test, and Development Commands

Use Node.js 24. The repository enforces this through `.node-version`, `.npmrc`, `scripts/check-node-version.js`, and `package.json` engines. If your shell is not already on Node 24, run local npm commands through `fnm exec --using 24 ...`.

- `ll`: inspect repository files.
- `npm install`: install Electron and renderer development dependencies.
- `fnm exec --using 24 npm run lint`: run ESLint across Electron, renderer, and tests.
- `fnm exec --using 24 npm run lint:fix`: apply safe ESLint fixes.
- `fnm exec --using 24 npm run typecheck`: run `vue-tsc` checks for renderer TypeScript/Vue files and `tsc` checks for the Electron runtime.
- `fnm exec --using 24 npm run format`: format the repository with Prettier.
- `fnm exec --using 24 npm run format:check`: verify Prettier formatting without changing files.
- `fnm exec --using 24 npm run rust:ci`: run Rust formatting, check, clippy, and native data-engine tests.
- `fnm exec --using 24 npm run rust:test`: run the Rust native data-engine unit tests.
- `fnm exec --using 24 npm run check`: run Rust CI checks, lint, typecheck, Node tests, renderer tests, and renderer build.
- `fnm exec --using 24 npm run build:electron`: compile the Electron runtime into `app/runtime-dist/`.
- `fnm exec --using 24 npm run build:renderer`: build the Vue renderer into `app/renderer-dist/`.
- `fnm exec --using 24 npm run dev:renderer`: run the Vite renderer dev server.
- `fnm exec --using 24 npm start`: build the Electron runtime and renderer, then run the desktop app.
- `fnm exec --using 24 npm run start:dev`: run Electron against the Vite dev server.
- `fnm exec --using 24 npm test`: run Node tests.
- `fnm exec --using 24 npm run test:electron`: build the app and run the minimal Playwright Electron startup smoke test with isolated test user data.
- `git diff`: review local changes before committing.

## Coding Style & Architecture

ESLint and Prettier are conservative guardrails, not a rewrite mandate. Keep the existing style unless there is a clear reason to change it: CommonJS in Electron main/preload modules and Vue SFCs plus TypeScript in the renderer. Do not introduce broad style-only refactors outside a deliberate formatting baseline.

Avoid dependencies, bundlers, or broad abstractions unless the desktop app grows enough to justify them. Comment only non-obvious browser, pagination, DOM, sync, or data-migration behavior.

Before implementing new behavior, first make a placement decision: existing file, new file, nearest domain folder, or new subdirectory. Use the `jable-desktop-maintenance` skill for the detailed workflow around placement, no-spec-change refactors, module moves, validation selection, and architecture-doc alignment.

If a single source file would exceed 1000 lines, pause and seriously review why it is reaching that size. Confirm whether the file truly owns one cohesive responsibility or whether code is being added mechanically without respecting existing module boundaries. Prefer extracting clear domain/runtime concerns into nearby modules when that reduces cognitive load without changing behavior; do not create trivial wrappers just to satisfy a line-count target.

When several files in the same broad folder share one obvious prefix or domain, review the folder structure before adding more same-prefix siblings. Prefer a dedicated subdirectory when the grouping has its own composition root, internal helpers, and stable public entrypoint. Do not reintroduce thin root adapter files unless there is a concrete external import/API boundary that cannot be migrated; do not flatten a growing subsystem into a parent folder just because each individual file is under the line-count threshold.

After completing an implementation, perform one self-review pass before finalizing. Preserve the agreed behavior and documented specs. Use this pass only for low-risk maintainability improvements such as clearer ownership boundaries, better test placement or naming, removing accidental duplication, and aligning docs with the implemented behavior. Do not expand scope, introduce speculative abstractions, or change product logic during this pass; if a cleanup would alter behavior, document it separately instead of folding it into the implementation.

For desktop main/preload code, use TypeScript source compiled to CommonJS runtime output, two-space indentation, and direct IPC handlers. Keep `app/main.ts` as the composition root for lifecycle and top-level wiring; place browser runtime wiring, tab orchestration, session persistence, preload request bookkeeping, and active-origin fallback under `app/main-process/browser/`; place app side-effect actions and download shutdown gates under `app/main-process/` by their app-level boundary instead of growing `main.ts`. Keep HLS playback loopback proxy/probe/capture internals under `app/main-process/hls-playback/`, and keep local playback range/server/preview internals under `app/main-process/local-playback/`; production code should import those domain paths directly. Keep scraper selectors in `app/webview-preload.ts`, browser sync orchestration and deferred replay in `app/browser/webview-preload/browser-sync.ts`, collection add/remove interception in `app/browser/webview-preload/collection-actions.ts`, and current video metadata readers/refresh in `app/browser/webview-preload/video-metadata.ts`. Keep app-level collection metadata centralized in `app/data/collections.ts` and aligned with Rust `collections()` metadata in `native/local-data-engine/src/collections.rs`. Keep local data API shape centralized in `app/data/data-engine.ts`, and keep database behavior in the Rust module that owns that concern under `native/local-data-engine/src/`.

For diagnostics and logging, use `app/main-process/diagnostics/logger.ts` instead of direct `console.*` calls in production main-process code. Main-process domain modules should receive a logger or `reportError` callback and emit sanitized `event` / `errorEvent` records; webview preload handled failures should use the diagnostics reporting bridge wired from `app/webview-preload.ts`; renderer handled workflow failures should use `window.jableApp.reportRendererError`. Direct console output is acceptable only inside the diagnostics logger fallback itself or behind explicit short-lived development debug gates. Logging must be best-effort: never let a diagnostics callback, file append, IPC send, or cleanup log failure throw out of a catch/finally path or turn an already-recoverable workflow into an app crash.

Treat Windows filesystem behavior as a first-class production constraint, especially for installed builds that cannot be reproduced from macOS. Files and directories may remain locked by Chromium media playback, FFmpeg, antivirus/indexers, Explorer previews, or OS timing even after app state says the operation is complete. Download, preview, segment, and cleanup code must handle `EPERM`, `EACCES`, and `EBUSY` without crashing, preserve records when the primary managed media file cannot be deleted, quarantine removable working directories through rename-and-background cleanup when appropriate, and retry quarantined cleanup on startup or download-root changes. Keep path handling Windows-safe: reject absolute or drive-root persisted relative paths, traversal, empty components, colon-containing components, reserved device names, trailing dot/space names, and case-only containment mistakes.

For renderer code, use Vue single-file components under `app/renderer-src/`, TypeScript where the renderer already uses it, Tailwind utilities for layout/state styling, and `window.jableApp` as the only renderer-to-main boundary. Treat `app/types/jable.ts` as the IPC contract.

For user-facing app settings, keep the shared contract aligned across `app/types/jable.ts`, `app/main-process/settings.ts`, `app/main.ts`, `app/preload.ts`, renderer settings UI, and tests. Settings belong in the Electron `userData` JSON store unless they are data-engine state or backup data.

For embedded browsing, the app uses multi-tab `WebContentsView` instances. Keep embedded browser geometry, visibility, tab state, navigation state, and resize scheduling in `app/renderer-src/composables/useBrowserBounds.ts`. Keep reusable tab rail UI in `app/renderer-src/components/BrowserTabRail.vue`; top-level view switching and Local Data background-tab decisions belong in `app/renderer-src/App.vue`. When changing tab behavior, keep `app/browser/browser-tab-policy.ts`, main-process serialization, renderer state, and tests aligned.

## Data, Sync, and JSON Rules

Local lists are loaded through paginated `listVideos` calls plus matching `countVideos` queries. When adding filters, search options, sort options, or pagination behavior, keep both query paths in sync.

Local search uses SQLite FTS5. Changes to search tokenization, migrations, filters, sort behavior, or visibility rules should be covered in `test/node/database.test.js` and `test/node/data-engine-contract.test.js`.

Rust native data-engine behavior must also be covered directly in `native/local-data-engine/src/tests.rs` when the change affects Rust-owned invariants such as migrations, FTS/search tokenization, sync visibility, sync operation reduction, outbox state transitions, pending remote grouping, resolved/superseded handling, or JSON import/export. Do not rely only on Node contract tests for Rust-owned state machines.

Desktop JSON export uses `site_order` as the official backup ordering field. Import reads the desktop paged JSON backup shape produced by the app. Do not rename this public field without updating import/export code, tests, README user guides, `docs/specs/data-sync.md`, and `docs/development.md`.

Desktop JSON import UI must require an explicit target collection. It may preselect favourites or watch-later from JSON `meta.source_path`, `meta.source_url`, or filename hints, but the final `collectionKey` passed to the data engine must come from the confirmed UI target.

Quick sync starts at page 1 and stops after a page where every row is already known. Full sync rebuilds `site_order`, marks missing rows invisible only after a completed full run, and supports batch continuation. Keep partial-run behavior conservative so failed or paused syncs do not hide old local rows.

Automatic post-sync outbox replay is a user setting and defaults off. Deferred remote operations must never alter the normal local list until Jable AJAX success marks the operation applied. Pending Sync must not infer a final intended state from operation order; manual handling is explicit `Add`, explicit `Remove`, or local-only `Resolved`. When changing sync replay behavior, preserve the original-order replay guardrails for the enabled case.

## Localization and Documentation

Desktop UI supports `zh-TW`, `en-US`, and `ja-JP`. User-facing renderer copy, aria labels, placeholders, toast messages, select labels, native menu labels, context menu labels, and dialog labels belong in `app/i18n/locales/*.json`.

When adding or changing user-facing messages, update all desktop locale JSON files and adjust `test/node/i18n.test.js` when key parity or fallback behavior changes.

Keep documentation split by audience:

- `README.md`: short project entrypoint.
- `docs/README.zh-TW.md`: Traditional Chinese user guide.
- `docs/README.en-US.md`: English user guide.
- `docs/README.ja-JP.md`: Japanese user guide.
- `docs/specs/*.md`: implementation-backed feature behavior and maintenance rules.
- `docs/development.md`: architecture, validation, packaging, and release details.
- `docs/shortcuts.md`: keyboard, mouse, and context-menu behavior.

When behavior changes, update the relevant spec in `docs/specs/` in the same pull request as the implementation or test change. Keep public user guidance in `docs/README.*.md`, and use matching `docs/specs/*.local.md` only for ignored local reading copies in other languages.

## Licensing and Attribution

The project is licensed under Apache License 2.0. Keep the root `LICENSE` file, `package.json`, root package entry in `package-lock.json`, `README.md`, and `docs/README.*.md` aligned when changing license metadata. Do not rewrite dependency license entries in `package-lock.json`.

The root `LICENSE` file should remain the canonical Apache License 2.0 text so license scanners can recognize it. Put project-specific copyright, disclaimers, and acknowledgements in README/user documentation rather than editing the license text itself.

If code, assets, or substantial implementation text are copied or adapted from another project, verify that project's license first and preserve any required copyright, attribution, and NOTICE material. Do not add a root `NOTICE` file unless there is a concrete notice obligation or project-level attribution that downstream redistributors must preserve.

## Testing Guidelines

Run `fnm exec --using 24 npm run check` before opening a pull request. Run `fnm exec --using 24 npm test` for SQLite/import/export/search/sync changes, shared settings persistence, and Download Manager helpers/orchestration. Run `fnm exec --using 24 npm run rust:test` or `fnm exec --using 24 npm run rust:ci` for Rust native data-engine or download-engine changes, especially migrations, search, sync reducers, outbox state, segment planning, retry behavior, and local playlist generation. Run `fnm exec --using 24 npm run typecheck`, `fnm exec --using 24 npm run test:renderer`, and `fnm exec --using 24 npm run build:renderer` for renderer changes. Run `fnm exec --using 24 npm run test:electron` only when touching Electron startup, BrowserWindow/WebContentsView bootstrapping, preload bridge exposure, protocol/session setup, or main/preload IPC registration wiring. Do not use Electron smoke as routine validation for renderer UI, database/import/export behavior, or download logic when narrower Node, Rust, or renderer tests cover the change. Run `fnm exec --using 24 npm run format:check` when touching Markdown, YAML, CSS, Vue, TypeScript, or JavaScript formatting.

GitHub Actions run formatting checks, linting, typechecking, tests, and renderer builds on pushes and pull requests. Release workflows also run formatting checks and the same full quality gate before packaging unsigned artifacts.

Verify relevant behavior after changes:

- Desktop JSON backups preserve `site_order`.
- The desktop app can open Jable, preserve login after restart when the server-side session remains valid, sync both collections, search local data, persist settings, and import/export JSON from the settings page.
- Browser tabs, context menus, keyboard shortcuts, fullscreen video, tab rail display modes, and `WebContentsView` bounds still behave as documented in `docs/shortcuts.md` and `docs/development.md`.

## Commit & Pull Request Guidelines

Recent commits use short, imperative summaries, for example `Add download queue controls`.

Do not update `CHANGELOG.md` for normal feature, fix, documentation, or test commits. Release notes are generated by `.github/workflows/release.yml` after a draft release is created, using `scripts/update-release-changelog.js`; when `Unreleased` is empty, the script builds the release section from first-parent commit subjects between version tags. Keep commit subjects concise and release-readable because they feed the generated changelog.

Only edit `CHANGELOG.md` when explicitly working on release automation, repairing generated release history, or following an explicit user request to update the changelog. If the release workflow cannot push the generated changelog update, use `RELEASE_TAG=vX.Y.Z fnm exec --using 24 node scripts/update-release-changelog.js`, commit only the generated `CHANGELOG.md` change, and push that repair branch manually. The post-release changelog push uses the `RELEASE_BYPASS_PAT` repository secret, which must have `Contents: Read and write` and belong to an actor allowed to bypass the `main` ruleset.

Pull requests should include:

- A concise description of the behavior changed.
- Manual test notes with browser, OS, and desktop app details when relevant.
- Screenshots or exported sample shape when UI or output format changes.
- Any known limitations caused by Jable DOM changes, Electron behavior, packaging constraints, or unsigned release artifacts.

## Security & Configuration Tips

Keep URL trust rules centralized in `app/browser/url-policy.ts`. The supported Jable origins are `https://jable.tv` and `https://fs1.app`; fallback-origin video URLs should canonicalize to the primary origin before storage so local rows do not duplicate across domains.

The app stores Jable cookies in an isolated Electron persistent session partition and synced data in local SQLite. Do not collect, persist, or log credentials. Keep import/export local-first and avoid hidden remote services.
