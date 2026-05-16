# Development Notes

> Developer-oriented notes for building, testing, packaging, and releasing Jable Desktop.

The short project entrypoint lives in [README.md](../README.md). Full user-facing guides live in [docs/README.zh-TW.md](README.zh-TW.md), [docs/README.en-US.md](README.en-US.md), and [docs/README.ja-JP.md](README.ja-JP.md).

---

# Jable Desktop

> A Tampermonkey user script and Electron desktop app to export, sync, and browse favourite or watch-later videos from [Jable.tv](https://jable.tv/) — even when pagination is loaded dynamically.

Jable Desktop is an unofficial desktop companion for Jable.

The original userscript remains available as `jable-favourites-exporter.user.js`. The desktop app adds an embedded browser with isolated persistent Jable cookies and SQLite storage.

---

## Features

- Export all items across multiple pages (auto-click pagination).
- Supports both **「影片收藏」** and **「稍後觀看」** pages.
- Works even when Jable uses AJAX to load content (no API access needed).
- Output format: **JSON** (default) or **CSV** (toggleable).
- Compatible with modern browsers (Chrome / Edge / Firefox).
- No external dependencies for the userscript.
- Desktop app stores synced data in SQLite and supports JSON import/export.
- Desktop sync preserves Jable site order and supports quick/full sync modes.
- Embedded browser uses multi-tab `WebContentsView` tabs with a persistent Jable session partition.
- Embedded browser blocks a small, Jable-specific set of known ad and popup requests in the shared session.
- Renderer UI is dark-mode-only, with no system appearance selector.
- Desktop and userscript UI support Traditional Chinese, English, and Japanese localization.
- Browser shortcuts and quick interactions are documented in [`docs/shortcuts.md`](shortcuts.md).

---

## Userscript Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Visit the script file: `jable-favourites-exporter.user.js`.
3. Tampermonkey will prompt to install the script. Click **Install**.

---

## Userscript Usage

1. Go to your Jable account:

- **影片收藏**: `https://jable.tv/my/favourites/videos/`
- **稍後觀看**: `https://jable.tv/my/favourites/videos-watch-later/`
- **備用站影片收藏**: `https://fs1.app/my/favourites/videos/`
- **備用站稍後觀看**: `https://fs1.app/my/favourites/videos-watch-later/`

2. Wait until all thumbnails are loaded.
3. Click the floating export button in the lower-right corner. Use the compact language selector beside it to choose **繁中**, **EN**, or **日本語** when needed.
4. The script will:

- Simulate clicking each pagination button.
- Collect video titles and URLs.
- Export a JSON or CSV file automatically.

---

## Output Files

| Page     | URL                                                  | Output filename                     |
| -------- | ---------------------------------------------------- | ----------------------------------- |
| 影片收藏 | `https://jable.tv/my/favourites/videos/`             | `favourites_list.json` (or `.csv`)  |
| 稍後觀看 | `https://jable.tv/my/favourites/videos-watch-later/` | `watch_later_list.json` (or `.csv`) |
| 影片收藏 | `https://fs1.app/my/favourites/videos/`              | `favourites_list.json` (or `.csv`)  |
| 稍後觀看 | `https://fs1.app/my/favourites/videos-watch-later/`  | `watch_later_list.json` (or `.csv`) |

You can change export format by editing this line in the script:

```js
const EXPORT_FORMAT = 'json'; // or 'csv'
```

---

## Desktop App

The desktop app opens Jable in an embedded browser and stores synced data in SQLite.

```sh
npm install
npm start
```

Log in inside the tabbed embedded browser, choose **影片收藏** or **稍後觀看** in the local data view, then click **快速同步** or **完整同步**. The browser has a compact floating mode, a persisted draggable-width left tab rail, native tab context actions, and a web-content context menu for links, media URLs, selection copy, and navigation. If `https://jable.tv` fails to load, the app automatically falls back to `https://fs1.app` for the current session. Jable cookies are kept in the isolated `persist:jable-session` Electron partition, but Jable can still expire or revoke the server-side session. The SQLite database path is shown in the local data view.

`npm start` builds the Rust native data engine into `app/native-dist/`, compiles the Electron runtime into `app/runtime-dist/`, and builds the Vue renderer into `app/renderer-dist/` before Electron starts. For renderer development, run Vite in one terminal and Electron in another:

```sh
npm run dev:renderer
npm run start:dev
```

Desktop sync behavior:

- **快速同步** navigates to page 1, updates scanned rows, and stops after a page where every row is already known. It is intended for routine incremental updates after an initial full sync.
- **完整同步** navigates to page 1, updates all visible site rows, rebuilds `site_order`, and hides local rows not seen in a completed full run.
- Full sync writes page 1 first, then can fetch remaining pages through a conservative `get_block` AJAX sliding window. The AJAX path uses the user-configured Settings acceleration level, per-page jitter, retry/backoff for soft-rate-limit symptoms such as 403/429/5xx/timeouts/empty responses, validates active page number, last-page stability, first-page stability, expected page size, and duplicate URLs before writing prefetched rows, and reports the fallback reason when it switches to sequential paging.
- Sync runs in a dedicated background browser worker. Failed full runs are marked incomplete; scanned rows remain saved, but missing-row hiding is skipped until a completed full run.
- The webview scraper saves each page through `db:save-sync-page` and emits `sync-page` messages while it paginates. The renderer displays progress and calls `finishSync` after the worker returns.
- Jable collection add/remove button clicks are observed in `app/webview-preload.ts`; during active sync they are deferred into the ordered `sync_operations` outbox. Outside active sync, successful site-side toggles are mirrored into local SQLite visibility state through `db:apply-collection-toggle`.
- The Rust data engine owns persisted outbox state. Deferred rows move through `pending`, `applied`, `failed`, `blocked`, `resolved`, and `superseded`; the webview only performs Jable AJAX with the current cookie/session. Deferred remote operations never alter normal local list visibility until Jable AJAX succeeds. Automatic replay is controlled by Settings and is off by default. When enabled, replay runs in original operation order and stops after the first failed operation, marking later pending rows as blocked. The main process replays the outbox one operation at a time so it can emit `sync-queue-progress` updates and keep the renderer progress bar accurate.
- The renderer's global Pending Sync tab is backed by `listPendingRemoteOperationGroups()`, which groups unresolved outbox rows by `collectionKey + videoUrl` without exposing a final-intent guess. Manual handling offers explicit `Add` and `Remove` actions, which send a single Jable AJAX operation and apply local visibility only after success, plus `Resolved`, which only clears local pending state. A later clean full sync marks older pending/failed/blocked rows from previous sync runs `superseded`; rows created during the current sync run remain pending when automatic replay is off.
- JSON export includes `site_order` as the desktop backup order field. Import accepts `site_order`, accepts `sort_order` as an alias, and falls back to JSON row order for older userscript exports. Renderer import UX lives in Settings > Data, preselects a collection from `meta.source_path`, `meta.source_url`, or filename when possible, and still requires a final target collection before calling `importJson({ collectionKey, resource })`.

Desktop data and search behavior:

- Local lists are loaded through paginated `listVideos` calls plus a matching `countVideos` query. Keep those query options in sync when adding filters: `collectionKey`, `search`, `searchMode`, `sort`, `direction`, `limit`, and `offset`.
- Video URLs from the fallback origin are canonicalized to `https://jable.tv` before local storage, so syncing through `https://fs1.app` does not duplicate existing rows.
- The default local data engine is the Rust native addon under `native/local-data-engine`. It opens the same `jable-favourites.sqlite` file and preserves the existing IPC return shapes. Set `JABLE_DATA_ENGINE=ts` only for regression comparison against the legacy TypeScript SQLite engine.
- App-level collection metadata lives in `app/collections.ts`; Rust data-engine collection metadata lives in `native/local-data-engine/src/lib.rs`. Keep both definitions aligned when changing supported collections, names, or source paths.
- Local search uses SQLite FTS5 through `video_search`. `videos.search_text` is generated from title and URL with normalized tokens/ngrams so CJK, punctuation-normalized phrases, and URL fragments can be searched locally.
- The search modes are `any`, `all`, and `phrase`. `any` joins term queries with `OR`, `all` joins them with `AND`, and `phrase` compacts punctuation/spacing before matching phrase ngrams.
- Database migration creates `videos`, `collections`, `collection_items`, and `sync_states`; adds `site_order`, `is_visible`, `missing_at`, `last_sync_run_id`, `videos.search_text`, and outbox state columns such as `remote_apply_state`, `remote_failed_at`, `remote_blocked_by`, `remote_resolved_at`, and `remote_superseded_at`; verifies the FTS table columns; recreates triggers when needed; and rebuilds the index if search text changed or FTS objects are missing.
- Rust-owned data-engine invariants are covered directly in `native/local-data-engine/src/tests.rs`. Any change to migrations, FTS/search tokenization, sync visibility, sync operation reduction, outbox state transitions, pending remote grouping, resolved/superseded handling, or JSON import/export should add or update Rust tests there in addition to the shared Node data-engine contract tests.
- Direct collection adds from Jable page actions use a negative `site_order` fallback until the next full sync rebuilds site ordering.
- Desktop JSON file export streams pages to a temporary file, yields between batches, and atomically renames the file when complete. Keep cleanup paths covered when changing export behavior.

Browser and tab behavior:

- User-facing app settings are stored in `settings.json` under Electron `userData` through `app/settings.ts`. Keep `app/types/jable.ts`, `app/preload.ts`, main IPC handlers, `SettingsPanel.vue`, and `test/node/settings.test.js` aligned when adding or changing settings.
- Browser tab state includes navigation flags plus media fields: `muted`, `audible`, `mediaPlaying`, `pictureInPicture`, and `discarded`. Keep `app/browser-tab-policy.ts`, main-process serialization, renderer state, and tests aligned.
- `app/browser-tab-policy.ts` centralizes background throttling, tab media serialization, close selection, keyboard tab switching detection, and visual-order tab cycling. Update `test/node/browser-tab-policy.test.js` when changing any of those rules.
- Closing the active tab prefers the next tab to the right; if closing the last tab, it falls back to the previous tab. Closing an inactive tab must not change the active tab.
- Keyboard previous/next tab switching follows tab rail visual order and wraps at both ends. After active-tab changes, `app/main.ts` focuses the new active `BrowserView.webContents` so repeated shortcuts keep working.
- `window.open` and `target=_blank` create app browser tabs. Background-tab dispositions remain background tabs; other dispositions activate the new tab.
- `app/ad-blocker.ts` centralizes Jable-specific ad request patterns for the `persist:jable-session` Electron session. It blocks known third-party ad subresources and suppresses known ad popup navigations, but keeps Jable `mainFrame` navigations and `blob:` media URLs untouched. `app/ad-cosmetic-policy.ts` is used by the webview preload to remove leftover ad card, sponsor, and modal containers whose URLs match those same rules. Set `JABLE_DESKTOP_AD_BLOCK=0` to disable both request blocking and cosmetic filtering while testing, or `JABLE_DESKTOP_AD_BLOCK_DEBUG=1` to log blocked requests, navigations, and removed containers.
- `app/url-policy.ts` centralizes trusted Jable origins (`https://jable.tv`, `https://fs1.app`), safe browser-tab protocols, GitHub release external URL checks, collection URL checks, and fallback-origin rewrites.
- Sync tabs use `kind: 'sync'`, stay locked while syncing, and keep background throttling disabled through `browserTabWebPreferences`.
- Main-process browser sync and diagnosis requests are sent to `app/webview-preload.ts` through request/response IPC channels. Do not call embedded page functions through injected JavaScript strings.
- HTML fullscreen from embedded pages only expands within the current `WebContentsView` bounds. `app/main.ts` handles `enter-html-full-screen` and `leave-html-full-screen` by temporarily stretching the active BrowserView over the app chrome, then restoring the renderer-provided bounds when fullscreen exits.
- Application-specific keyboard shortcuts and mouse shortcuts are inventoried in [`docs/shortcuts.md`](shortcuts.md). Keep it aligned with `app/browser-tab-policy.ts`, `app/main.ts`, `app/webview-preload.ts`, and renderer link handlers.

Renderer behavior:

- `app/preload.ts` exposes the only renderer-to-main boundary as `window.jableApp`; `app/types/jable.ts` is the contract for those IPC payloads and responses.
- `app/main.ts` normalizes and validates IPC payloads at runtime before database or browser-tab handlers use them. Keep preload method shapes, `app/types/jable.ts`, and main-process normalizers aligned when adding IPC calls.
- `app/renderer-src/App.vue` coordinates the browser view, local data view, settings page, browser messages, sync orchestration, import/export, toast status, and full-sync continuation state.
- `useBrowserBounds` owns BrowserView geometry, visibility, tab state, navigation state, and resize scheduling. When leaving the browser view, it hides BrowserViews by sending `{ visible: false }`.
- `useLibraryState` owns collection/pending-tab selection, pagination, search mode, sorting, pending remote operation groups, refresh token cancellation, and the pending full-sync continuation label.
- Browser compact-mode is stored in shared app settings. Tab rail width remains a renderer-local `localStorage` preference because it only affects layout.
- The renderer stylesheet is intentionally dark-mode-only. If appearance modes are reintroduced, keep `styles.css`, persisted preferences, and any docs in sync.

Localization behavior:

- The supported UI locales are `zh-TW`, `en-US`, and `ja-JP`.
- Shared desktop locale dictionaries live in `app/i18n/locales/`. `app/i18n/index.ts` is the Electron main-process locale helper, and `app/renderer-src/i18n/index.ts` is the renderer wrapper.
- Locale selection precedence is: user preference in renderer `localStorage` (`jable-desktop:locale`), then detected system/browser locale, then `zh-TW`.
- Renderer locale changes are sent through `window.jableApp.setLocale()`, so native application menus, context menus, dialog titles, and renderer copy stay aligned.
- Keep visible renderer copy, aria labels, placeholders, toast messages, select option labels, and menu/dialog labels in the locale dictionaries. Avoid putting user-facing fallback labels in `app/renderer-src/constants.ts`.
- Dictionary key parity between `zh-TW`, `en-US`, and `ja-JP` is covered by `test/node/i18n.test.js`. Missing keys are exposed as `[missing:key.path]` in development/test and fall back to the raw key in production.
- The userscript remains self-contained, so it has a small local i18n dictionary inside `jable-favourites-exporter.user.js` rather than importing the desktop dictionaries. Its language preference is stored in `localStorage` as `jable-favourites-exporter:locale`.
- When adding a new user-facing message, update all desktop locale JSON files, update the userscript dictionary separately if the message appears there, and add or adjust tests for any new translation behavior.

Userscript cache behavior:

- The userscript remains self-contained and dependency-free, but large exports prefer an IndexedDB cache with localStorage fallback.
- IndexedDB cache methods cover open/read meta/load rows/known URL map/save progress/mark base rows/replace rows/migration. Preserve localStorage migration and progress feedback when changing long-running export flow.

Desktop app files:

- `app/main.ts`: Electron main process and IPC handlers.
- `app/preload.ts`: context-isolated renderer IPC bridge exposed as `window.jableApp`.
- `app/webview-preload.ts`: scraper injected into each embedded Jable `WebContentsView`.
- `app/ad-blocker.ts`: session-level Jable ad and popup request filtering.
- `app/ad-cosmetic-policy.ts`: DOM-level removal rules for ad containers left behind after request blocking.
- `app/browser-tab-policy.ts`: pure browser tab policies used by main-process behavior and Node tests.
- `app/sync-utils.ts`: shared pager-selection helper for sync pagination.
- `app/url-policy.ts`: trusted URL origins, browser-tab protocol policy, release URL allowlist, fallback-origin rewriting, and collection URL checks.
- `app/collections.ts`: app-level collection metadata shared by Electron runtime code.
- `app/data-engine.ts`: local data engine boundary. It defaults to the Rust native addon and can use `app/database.ts` when `JABLE_DATA_ENGINE=ts`.
- `app/database.ts`: legacy TypeScript SQLite engine retained for regression comparison and contract tests.
- `native/local-data-engine/`: Rust SQLite data engine, migrations, sync operation reducer, search, and JSON import/export.
- `app/types/`: shared renderer-facing TypeScript wire types for IPC payloads and app state.
- `app/runtime-dist/`: TypeScript-compiled Electron runtime loaded by Electron and packaged for release.
- `app/native-dist/`: built native `.node` data engine addon loaded by Electron and unpacked from packaged apps.
- `app/renderer-src/`: Vue 3 + TailwindCSS + TypeScript renderer source.
- `app/renderer-src/composables/`: renderer state modules for IPC access, BrowserView bounds/tabs/navigation, and local library state.
- `app/renderer-src/components/`: presentational Vue components for top navigation, browser tabs, local data controls, pagination, and video cards.
- `app/renderer-dist/`: Vite-built renderer loaded by Electron and packaged for release.
- `test/node/`: Node tests for database behavior, sync utilities, i18n, update checks, and browser tab policy.
- `test/renderer/`: Vitest renderer/component/composable tests.
- `test/electron/`: Playwright Electron smoke tests for app startup, preload IPC, tab IPC, and import/export integration.
- `scripts/check-node-version.js`: local guard that enforces the supported Node.js version range before scripts run.

### Quality Checks

The project uses ESLint and Prettier as conservative guardrails. The config enforces `const` by default, `let` only for reassignment, no `var` declarations, no variable shadowing, block-scoped variable usage, strict equality, explicit boolean coercion, and consistent type imports. It still preserves the project shape: TypeScript source compiled to CommonJS for Electron runtime modules, Vue single-file components in the renderer, and a self-contained Tampermonkey userscript.

Use Node.js 24, matching `.node-version`, the repository `engines` field, and GitHub Actions. The package manager is locked through `packageManager` in `package.json`.

```sh
npm run lint
npm run typecheck
npm run format:check
npm run check
```

Useful commands:

- `npm run lint`: run ESLint across userscript, Electron, renderer, and tests.
- `npm run lint:fix`: apply safe ESLint fixes.
- `npm run typecheck`: run `vue-tsc` checks for renderer TypeScript/Vue files and `tsc` checks for the Electron runtime.
- `npm run build:rust`: build the Rust native data engine into `app/native-dist/`.
- `npm run build:electron`: compile Electron runtime TypeScript into `app/runtime-dist/`.
- `npm run format`: format the repository with Prettier.
- `npm run format:check`: verify formatting without changing files.
- `npm run check`: run lint, typecheck, Node tests, renderer tests, and renderer build.
- `npm run test:electron`: build the Electron runtime and renderer, then run the Playwright Electron smoke test with isolated test user data and a local HTTP page.

TypeScript covers the renderer, shared IPC/wire types, and Electron runtime source. The Tampermonkey userscript remains JavaScript to preserve its no-build, self-contained runtime shape.

Test coverage map:

- `test/node/database.test.js`: SQLite schema migrations, sync visibility, search, import/export, streamed file export, and collection toggle persistence.
- `test/node/ad-blocker.test.js`: Jable ad request matching, popup navigation suppression, environment switches, and Electron listener installation.
- `test/node/ad-cosmetic-policy.test.js`: DOM container removal for blocked ad cards, sponsor rows, and modal wrappers.
- `test/node/browser-tab-policy.test.js`: tab web preferences, media serialization, close target selection, tab cycling, and shortcut detection.
- `test/node/settings.test.js`: app settings defaults, persistence, and user-facing limit clamping.
- `test/node/sync-utils.test.js`: numeric pager selection.
- `test/node/i18n.test.js` and `test/node/userscript-i18n.test.js`: locale normalization, dictionary key parity, missing-key behavior, and userscript locale UI guardrails.
- `native/local-data-engine/src/tests.rs`: Rust-native data-engine invariants that should not depend only on addon contract coverage, including URL normalization, site-order import aliases, search token matching, outbox grouping, resolved groups, and full-sync superseded state.
- `test/renderer/components/*.test.ts`: component rendering and emitted UI actions.
- `test/renderer/composables/*.test.ts`: BrowserView geometry/tab state and library pagination/filter state.
- `test/electron/app-smoke.test.js`: desktop app startup, `window.jableApp` preload bridge, settings IPC, browser tab create/activate/close IPC, and import/export happy path.

GitHub Actions read Node.js from `.node-version`, then run `npm run format:check` and `npm run check` for pushes and pull requests. Release packaging runs the same formatting and quality checks before building unsigned macOS and Windows artifacts.

### Desktop Validation

Run the full local quality gate before opening a pull request:

```sh
npm run check
```

For targeted checks, use `npm test` for SQLite/import/export/search behavior, `npm run rust:test` for Rust-native data-engine unit tests, `npm run rust:ci` for Rust formatting/check/clippy/test coverage, `npm run typecheck` for renderer and Electron runtime typing, `npm run test:renderer` for renderer unit tests, `npm run test:electron` for Electron startup/preload/tab IPC smoke coverage, `npm run build:electron` for Electron runtime output, and `npm run build:renderer` for renderer build validation.

Manual checks:

- Restart the app and confirm the embedded browser keeps local Jable cookies when the server-side session is still valid.
- Open, switch, close, right-click, toggle compact mode, hover to reveal close buttons, and drag-resize browser tabs. Confirm Jable `target=_blank` links open a new app tab.
- Enter and leave fullscreen from a Jable video player. Confirm fullscreen covers the tab rail and top bar, then restores the normal browser layout after exit.
- Verify keyboard tab switching shortcuts from [`docs/shortcuts.md`](shortcuts.md), including repeated previous/next switching without clicking the page between keystrokes.
- Right-click Jable page content and verify link, media, selection, navigation, and page URL menu actions appear in the expected contexts.
- Toggle Jable favourite/watch-later buttons in the embedded page and confirm the local list updates after the site-side action succeeds.
- On an empty local database, full sync both favourites and watch-later lists first.
- Quick sync both favourites and watch-later lists after a completed full sync.
- Full sync a list and confirm local ordering matches the Jable page order.
- For large lists, confirm the bounded AJAX full-sync path completes or falls back to sequential paging without hiding old rows on incomplete runs.
- Change Settings > Sync acceleration and confirm full sync still completes or falls back cleanly; keep automatic post-sync replay off by default unless explicitly testing queue progress.
- Search with `any`, `all`, and `phrase` modes and confirm title/URL filtering still matches README examples.
- Switch desktop language between Traditional Chinese, English, and Japanese from Settings. Confirm the top bar, settings page, local data controls, pagination, video metadata labels, toast messages, application menu, page context menu, tab context menu, and export dialog title update.
- Restart the app after changing language and confirm the `jable-desktop:locale` preference is preserved.
- In Tampermonkey, verify the userscript floating export UI on favourites and watch-later pages. Switch between **繁中**, **EN**, and **日本語**, confirm the button label changes immediately, and confirm progress/error labels follow the selected language.
- Import an existing userscript JSON export from Settings > Data, confirm source detection or manual target selection, and verify rows appear in the selected collection.
- Export JSON from Settings > Data and confirm the `{ data: [...], meta: {...} }` shape is preserved.

### Desktop Packaging

Install dependencies once:

```sh
npm install
```

Packaging scripts build the Rust native data engine, Electron runtime, and Vue renderer before running `electron-builder`. The native `.node` file is included from `app/native-dist/` and unpacked through `asarUnpack`, because Electron cannot load native addons directly from inside `app.asar`.

macOS release packaging targets Apple Silicon only. Windows release packaging runs on a Windows x64 runner so `npm run build:rust` produces `jable_data_engine.win32-x64.node` before `electron-builder` packages the app.

Build unpacked apps for local smoke testing:

```sh
npm run pack:mac
npm run pack:win
```

Build unsigned distribution artifacts:

```sh
npm run dist:mac:unsigned
npm run dist:win:unsigned
```

Artifacts are written to `release/`. The packaged app still stores its SQLite database under the OS app data directory, so user data is not bundled inside the app.

Unsigned artifacts are currently the default release output. The desktop app uses `io.github.shane-zeng.jable-desktop` as its stable app ID.

#### Unsigned GitHub Draft Releases

Pushing a version tag runs `.github/workflows/release.yml`:

```sh
git tag v0.2.0
git push origin v0.2.0
```

The workflow checks formatting, runs `npm run check`, builds unsigned macOS arm64 artifacts with `npm run dist:mac:unsigned`, builds unsigned Windows x64 artifacts with `npm run dist:win:unsigned`, then creates a GitHub draft release. After the draft release is created, the workflow checks out the default branch with the `RELEASE_BYPASS_PAT` repository secret, verifies the released tag points at the current default-branch head, updates `CHANGELOG.md` for the released tag, and commits that changelog update back to the default branch. Review and smoke test the draft assets before publishing the release.

The macOS and Windows workflow artifacts uploaded between build jobs and the release job are retained for 1 day only. The draft GitHub release assets are the durable release downloads.

The post-release changelog step uses `scripts/update-release-changelog.js`. If `Unreleased` contains notes, the script moves them into the new version section. If `Unreleased` is empty, it creates a `Changed` section from first-parent commit subjects between the previous version tag and the released tag, excluding previous automated changelog commits. The script refreshes the compare links at the bottom of `CHANGELOG.md`, and the workflow runs Prettier on `CHANGELOG.md` before committing it.

Because this changelog commit happens after the tag-triggered release succeeds, the tag archive itself does not include that generated changelog entry. The default branch does. If the default branch advances before the release job reaches the changelog step, branch protection blocks the bot push, or a manual release needs the same update, run:

```sh
RELEASE_TAG=v0.2.0 fnm exec --using 24 node scripts/update-release-changelog.js
git add CHANGELOG.md
git commit -m "Update changelog for v0.2.0"
git push
```

GitHub provides `GITHUB_TOKEN` automatically, and the workflow sets `permissions: contents: write` so it can create the draft release. The post-release changelog commit requires a repository secret named `RELEASE_BYPASS_PAT`, because the `main` ruleset requires changes through pull requests and `GITHUB_TOKEN` cannot bypass that rule.

`RELEASE_BYPASS_PAT` should be a fine-grained personal access token with:

- Repository access limited to `shane-zeng/jable-desktop`.
- `Contents: Read and write`.
- The required `Metadata: Read-only` permission.
- An owner that can bypass the `main` ruleset, such as a repository admin listed in the ruleset bypass list.

The token is used only by the changelog checkout and push steps. Avoid granting unrelated permissions such as `Actions: Read and write` unless a future workflow explicitly needs them.

Expected draft release artifacts:

- macOS arm64 `.dmg`
- macOS arm64 `.zip`
- Windows `.exe`
- Windows `.zip`

Because these artifacts are unsigned, macOS Gatekeeper and Windows SmartScreen may warn users when they open the app.
