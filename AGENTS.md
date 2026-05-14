# Repository Guidelines

## Project Structure & Module Organization

This repository contains a self-contained Tampermonkey userscript and an Electron desktop app for syncing, browsing, importing, and exporting Jable favourites and watch-later entries.

- `jable-favourites-exporter.user.js`: main userscript with metadata, configuration, scraping helpers, pagination, cache, download logic, and its own small i18n dictionary.
- `app/main.js`: Electron main process, window creation, persistent Jable session management, `WebContentsView` tab orchestration, native menus, dialogs, and IPC handlers.
- `app/preload.js`: context-isolated bridge that exposes the only renderer-to-main API as `window.jableApp`.
- `app/webview-preload.js`: scraper and collection action observer injected into embedded Jable `WebContentsView` instances.
- `app/browser-tab-policy.js`: pure tab policy helpers for web preferences, media state serialization, close target selection, shortcut detection, and visual-order tab cycling.
- `app/sync-utils.js`: shared pagination helper logic for sync flows.
- `app/database.js`: SQLite schema, migrations, FTS5 search, upsert logic, sync state, visibility state, and JSON import/export.
- `app/types/`: renderer-facing TypeScript wire types for IPC payloads and app state.
- `app/i18n/`: desktop locale dictionaries and helpers for Electron main-process and renderer UI copy.
- `app/renderer-src/`: Vue 3 + TailwindCSS + TypeScript renderer source.
- `app/renderer-dist/`: Vite-built renderer loaded by Electron and packaged for release.
- `test/node/`: Node test files for database behavior, import/export, sync utilities, i18n, userscript i18n, update checks, and browser tab policy.
- `test/renderer/`: Vitest renderer, component, composable, and renderer i18n tests.
- `scripts/update-release-changelog.js`: release helper that updates `CHANGELOG.md` for a completed version tag.
- `docs/`: user guides, development notes, shortcuts, and screenshots. `README.md` is only the short project entrypoint.
- `CHANGELOG.md`: tracked release history for every version tag.
- `AGENTS.md`: contributor guidance for future maintenance.

Keep the userscript self-contained. Put desktop-only code under `app/`, Node tests under `test/node/`, and renderer tests under `test/renderer/`.

## Build, Test, and Development Commands

Use Node.js 24. The repository enforces this through `.node-version`, `.npmrc`, `scripts/check-node-version.js`, and `package.json` engines. If your shell is not already on Node 24, run local npm commands through `fnm exec --using 24 ...`.

The userscript has no build step. Edit it directly and validate it in Tampermonkey.

- `ll`: inspect repository files.
- `cat jable-favourites-exporter.user.js`: review the userscript.
- `grep "EXPORT_FORMAT" jable-favourites-exporter.user.js`: find userscript configuration or implementation details.
- `npm install`: install Electron and renderer development dependencies.
- `fnm exec --using 24 npm run lint`: run ESLint across userscript, Electron, renderer, and tests.
- `fnm exec --using 24 npm run lint:fix`: apply safe ESLint fixes.
- `fnm exec --using 24 npm run typecheck`: run `vue-tsc` checks for shared types and renderer TypeScript/Vue files.
- `fnm exec --using 24 npm run format`: format the repository with Prettier.
- `fnm exec --using 24 npm run format:check`: verify Prettier formatting without changing files.
- `fnm exec --using 24 npm run check`: run lint, typecheck, Node tests, renderer tests, and renderer build.
- `fnm exec --using 24 npm run build:renderer`: build the Vue renderer into `app/renderer-dist/`.
- `fnm exec --using 24 npm run dev:renderer`: run the Vite renderer dev server.
- `fnm exec --using 24 npm start`: build the renderer, then run the desktop app.
- `fnm exec --using 24 npm run start:dev`: run Electron against the Vite dev server.
- `fnm exec --using 24 npm test`: run Node tests.
- `git diff`: review local changes before committing.

For userscript validation, install or update `jable-favourites-exporter.user.js` in Tampermonkey, then test:

- `https://jable.tv/my/favourites/videos/`
- `https://jable.tv/my/favourites/videos-watch-later/`

## Coding Style & Architecture

Use plain JavaScript compatible with modern browsers and Tampermonkey in the userscript:

- Two-space indentation.
- `var` declarations, matching the existing script.
- Small, direct functions with descriptive names such as `scrapeCurrentPage`, `readPagerLinks`, and `downloadJson`.
- Uppercase constants for selectors and IDs, for example `SEL_PAGER_LINKS` and `BTN_ID`.

ESLint and Prettier are conservative guardrails, not a rewrite mandate. Keep the existing style unless there is a clear reason to change it: CommonJS in Electron main/preload/database modules, Vue SFCs plus TypeScript in the renderer, and a self-contained browser userscript. Do not introduce broad style-only refactors outside a deliberate formatting baseline.

Avoid dependencies, bundlers, or broad abstractions unless the script or desktop app grows enough to justify them. Comment only non-obvious browser, pagination, DOM, sync, or data-migration behavior.

For desktop main/preload/database code, use CommonJS modules, two-space indentation, and direct IPC handlers. Keep scraper selectors and collection add/remove interception centralized in `app/webview-preload.js`. Keep database migrations, search behavior, sync visibility rules, and JSON import/export centralized in `app/database.js`.

For renderer code, use Vue single-file components under `app/renderer-src/`, TypeScript where the renderer already uses it, Tailwind utilities for layout/state styling, and `window.jableApp` as the only renderer-to-main boundary. Treat `app/types/jable.ts` as the IPC contract.

For embedded browsing, the app uses multi-tab `WebContentsView` instances. Keep embedded browser geometry, visibility, tab state, navigation state, and resize scheduling in `app/renderer-src/composables/useBrowserBounds.ts`. When changing tab behavior, keep `app/browser-tab-policy.js`, main-process serialization, renderer state, and tests aligned.

## Data, Sync, and JSON Rules

Local lists are loaded through paginated `listVideos` calls plus matching `countVideos` queries. When adding filters, search options, sort options, or pagination behavior, keep both query paths in sync.

Local search uses SQLite FTS5. Changes to search tokenization, migrations, filters, sort behavior, or visibility rules should be covered in `test/node/database.test.js`.

Desktop JSON export uses `site_order` as the official backup ordering field. Import accepts `site_order`, accepts `sort_order` as an alias, and falls back to JSON row order for older userscript exports. Do not rename this public field without updating import/export code, tests, README user guides, and `docs/development.md`.

Quick sync starts at page 1 and stops after a page where every row is already known. Full sync rebuilds `site_order`, marks missing rows invisible only after a completed full run, and supports batch continuation. Keep partial-run behavior conservative so failed or paused syncs do not hide old local rows.

## Localization and Documentation

Desktop UI supports `zh-TW`, `en-US`, and `ja-JP`. User-facing renderer copy, aria labels, placeholders, toast messages, select labels, native menu labels, context menu labels, and dialog labels belong in `app/i18n/locales/*.json`.

The userscript remains self-contained and keeps its own small i18n dictionary inside `jable-favourites-exporter.user.js`; do not import desktop locale helpers into the userscript.

When adding or changing user-facing messages, update all desktop locale JSON files, update the userscript dictionary when the message appears there, and adjust `test/node/i18n.test.js` or `test/node/userscript-i18n.test.js` when key parity or fallback behavior changes.

Keep documentation split by audience:

- `README.md`: short project entrypoint.
- `docs/README.zh-TW.md`: Traditional Chinese user guide.
- `docs/README.en-US.md`: English user guide.
- `docs/README.ja-JP.md`: Japanese user guide.
- `docs/development.md`: architecture, validation, packaging, and release details.
- `docs/shortcuts.md`: keyboard, mouse, and context-menu behavior.

## Testing Guidelines

Run `fnm exec --using 24 npm run check` before opening a pull request. Run `fnm exec --using 24 npm test` for SQLite/import/export/search/sync changes. Run `fnm exec --using 24 npm run typecheck`, `fnm exec --using 24 npm run test:renderer`, and `fnm exec --using 24 npm run build:renderer` for renderer changes. Run `fnm exec --using 24 npm run format:check` when touching Markdown, YAML, CSS, Vue, TypeScript, or JavaScript formatting. Test userscript changes manually in Tampermonkey before opening a pull request.

GitHub Actions run formatting checks, linting, typechecking, tests, and renderer builds on pushes and pull requests. Release workflows also run formatting, linting, and tests before packaging unsigned artifacts.

Verify relevant behavior after changes:

- The userscript floating export UI appears on favourites and watch-later pages, and language switching updates labels/progress text.
- Pagination is clicked through without duplicate exported URLs.
- JSON and CSV output still include `title`, `url`, `views`, and `likes`; desktop JSON backups also preserve `site_order`.
- Both favourites and watch-later pages produce the expected filenames.
- The desktop app can open Jable, preserve login after restart when the server-side session remains valid, sync both collections, search local data, and import/export JSON.
- Browser tabs, context menus, keyboard shortcuts, fullscreen video, compact tab mode, and `WebContentsView` bounds still behave as documented in `docs/shortcuts.md` and `docs/development.md`.

## Commit & Pull Request Guidelines

Recent commits use short, imperative summaries, for example `Add Jable Favourites Exporter user script`.

Version tags are released first, then `.github/workflows/release.yml` commits the matching `CHANGELOG.md` entry back to the default branch after the draft GitHub release is created. The post-release changelog push uses the `RELEASE_BYPASS_PAT` repository secret, which must have `Contents: Read and write` and belong to an actor allowed to bypass the `main` ruleset. Keep release-worthy notes under `Unreleased` when useful; the workflow moves them into the released version section. If the workflow cannot push the changelog update, run `RELEASE_TAG=vX.Y.Z fnm exec --using 24 node scripts/update-release-changelog.js`, commit `CHANGELOG.md`, and push the branch manually.

Pull requests should include:

- A concise description of the behavior changed.
- Manual test notes with browser, Tampermonkey, OS, and desktop app details when relevant.
- Screenshots or exported sample shape when UI or output format changes.
- Any known limitations caused by Jable DOM changes, Electron behavior, packaging constraints, or unsigned release artifacts.

## Security & Configuration Tips

Keep `@grant none` unless a Tampermonkey API is required. Do not add external network calls, credentials, analytics, or tracking. Treat Jable DOM selectors as fragile and update them narrowly when the site changes.

The app stores Jable cookies in an isolated Electron persistent session partition and synced data in local SQLite. Do not collect, persist, or log credentials. Keep import/export local-first and avoid hidden remote services.
