# Development Notes

> Developer-oriented notes for building, testing, packaging, and releasing Jable Desktop.

The user-facing guide lives in [README.md](../README.md).

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
- Renderer UI is dark-mode-only, with no system appearance selector.
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

2. Wait until all thumbnails are loaded.
3. Click the **「匯出全部」** button next to **設定**.
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

You can change export format by editing this line in the script:

```js
var EXPORT_FORMAT = 'json'; // or 'csv'
```

---

## Desktop App

The desktop app opens Jable in an embedded browser and stores synced data in SQLite.

```sh
npm install
npm start
```

Log in inside the tabbed embedded browser, choose **影片收藏** or **稍後觀看** in the local data view, then click **快速同步** or **完整同步**. The browser has a compact floating mode, a persisted draggable-width left tab rail, native tab context actions, and a web-content context menu for links, media URLs, selection copy, and navigation. Jable cookies are kept in the isolated `persist:jable-session` Electron partition, but Jable can still expire or revoke the server-side session. The SQLite database path is shown in the local data view.

`npm start` builds the Vue renderer into `app/renderer-dist/` before Electron starts. For renderer development, run Vite in one terminal and Electron in another:

```sh
npm run dev:renderer
npm run start:dev
```

Desktop sync behavior:

- **快速同步** navigates to page 1, updates scanned rows, and stops after a page where every row is already known.
- **完整同步** navigates to page 1, updates all visible site rows, rebuilds `site_order`, and hides local rows not seen in a completed full run.
- Sync runs in a dedicated browser tab. The sync tab is locked while running, and batch-limited full syncs keep that tab locked so continuation can resume from the same page.
- Full sync runs in batches of 100 pages. Batch-limited or failed runs are marked incomplete; scanned rows remain saved, but missing-row hiding is skipped until a completed full run.
- The webview scraper emits `sync-page` messages while it paginates. The renderer queues `saveSyncPage` calls and waits for all pending saves before calling `finishSync`.
- Jable collection add/remove button clicks are observed in `app/webview-preload.js`; successful site-side toggles are mirrored into local SQLite visibility state through `db:apply-collection-toggle`.
- JSON export includes `site_order` as the desktop backup order field. Import accepts `site_order`, accepts `sort_order` as an alias, and falls back to JSON row order for older userscript exports.

Desktop data and search behavior:

- Local lists are loaded through paginated `listVideos` calls plus a matching `countVideos` query. Keep those query options in sync when adding filters: `collectionKey`, `search`, `searchMode`, `sort`, `direction`, `limit`, and `offset`.
- Local search uses SQLite FTS5 through `video_search`. `videos.search_text` is generated from title and URL with normalized tokens/ngrams so CJK, punctuation-normalized phrases, and URL fragments can be searched locally.
- The search modes are `any`, `all`, and `phrase`. `any` joins term queries with `OR`, `all` joins them with `AND`, and `phrase` compacts punctuation/spacing before matching phrase ngrams.
- Database migration creates `videos`, `collections`, `collection_items`, and `sync_states`; adds `site_order`, `is_visible`, `missing_at`, `last_sync_run_id`, and `videos.search_text`; verifies the FTS table columns; recreates triggers when needed; and rebuilds the index if search text changed or FTS objects are missing.
- Direct collection adds from Jable page actions use a negative `site_order` fallback until the next full sync rebuilds site ordering.
- Desktop JSON file export streams pages to a temporary file, yields between batches, and atomically renames the file when complete. Keep cleanup paths covered when changing export behavior.

Browser and tab behavior:

- Browser tab state includes navigation flags plus media fields: `muted`, `audible`, `mediaPlaying`, `pictureInPicture`, and `discarded`. Keep `app/browser-tab-policy.js`, main-process serialization, renderer state, and tests aligned.
- `app/browser-tab-policy.js` centralizes background throttling, tab media serialization, close selection, keyboard tab switching detection, and visual-order tab cycling. Update `test/browser-tab-policy.test.js` when changing any of those rules.
- Closing the active tab prefers the next tab to the right; if closing the last tab, it falls back to the previous tab. Closing an inactive tab must not change the active tab.
- Keyboard previous/next tab switching follows tab rail visual order and wraps at both ends. After active-tab changes, `app/main.js` focuses the new active `BrowserView.webContents` so repeated shortcuts keep working.
- `window.open` and `target=_blank` create app browser tabs. Background-tab dispositions remain background tabs; other dispositions activate the new tab.
- Sync tabs use `kind: 'sync'`, stay locked while syncing, and keep background throttling disabled through `browserTabWebPreferences`.
- HTML fullscreen from embedded pages only expands within the current `WebContentsView` bounds. `app/main.js` handles `enter-html-full-screen` and `leave-html-full-screen` by temporarily stretching the active BrowserView over the app chrome, then restoring the renderer-provided bounds when fullscreen exits.
- Application-specific keyboard shortcuts and mouse shortcuts are inventoried in [`docs/shortcuts.md`](shortcuts.md). Keep it aligned with `app/browser-tab-policy.js`, `app/main.js`, `app/webview-preload.js`, and renderer link handlers.

Renderer behavior:

- `app/preload.js` exposes the only renderer-to-main boundary as `window.jableApp`; `app/types/jable.ts` is the contract for those IPC payloads and responses.
- `app/renderer-src/App.vue` coordinates the two top-level views, browser messages, sync orchestration, import/export, toast status, and full-sync continuation state.
- `useBrowserBounds` owns BrowserView geometry, visibility, tab state, navigation state, and resize scheduling. When leaving the browser view, it hides BrowserViews by sending `{ visible: false }`.
- `useLibraryState` owns collection selection, pagination, search mode, sorting, refresh token cancellation, and the pending full-sync continuation label.
- Browser compact-mode and tab rail width are stored in renderer `localStorage` using constants from `app/renderer-src/constants.ts`.
- The renderer stylesheet is intentionally dark-mode-only. If appearance modes are reintroduced, keep `styles.css`, persisted preferences, and any docs in sync.

Userscript cache behavior:

- The userscript remains self-contained and dependency-free, but large exports prefer an IndexedDB cache with localStorage fallback.
- IndexedDB cache methods cover open/read meta/load rows/known URL map/save progress/mark base rows/replace rows/migration. Preserve localStorage migration and progress feedback when changing long-running export flow.

Desktop app files:

- `app/main.js`: Electron main process and IPC handlers.
- `app/preload.js`: context-isolated renderer IPC bridge exposed as `window.jableApp`.
- `app/webview-preload.js`: scraper injected into each embedded Jable `WebContentsView`.
- `app/browser-tab-policy.js`: pure browser tab policies used by main-process behavior and Node tests.
- `app/sync-utils.js`: shared pager-selection helper for sync pagination.
- `app/database.js`: SQLite schema, migrations, upsert logic, search, sync state, JSON import/export.
- `app/types/`: shared renderer-facing TypeScript wire types for IPC payloads and app state.
- `app/renderer-src/`: Vue 3 + TailwindCSS + TypeScript renderer source.
- `app/renderer-src/composables/`: renderer state modules for IPC access, BrowserView bounds/tabs/navigation, and local library state.
- `app/renderer-src/components/`: presentational Vue components for top navigation, browser tabs, local data controls, pagination, and video cards.
- `app/renderer-dist/`: Vite-built renderer loaded by Electron and packaged for release.
- `test/`: Node tests for database behavior, sync utilities, and browser tab policy.
- `app/renderer-src/**/*.test.ts`: Vitest renderer/component/composable tests.
- `scripts/check-node-version.js`: local guard that enforces the supported Node.js version range before scripts run.

### Quality Checks

The project uses ESLint and Prettier as conservative guardrails. The config preserves the existing code style: `var` declarations, CommonJS in Electron main/preload/database modules, Vue single-file components in the renderer, and a self-contained Tampermonkey userscript.

Use Node.js 24, matching the repository `engines` field and GitHub Actions.

```sh
npm run lint
npm run typecheck
npm run format:check
npm run check
```

Useful commands:

- `npm run lint`: run ESLint across userscript, Electron, renderer, and tests.
- `npm run lint:fix`: apply safe ESLint fixes.
- `npm run typecheck`: run strict `vue-tsc` checks for shared types and renderer TypeScript/Vue files.
- `npm run format`: format the repository with Prettier.
- `npm run format:check`: verify formatting without changing files.
- `npm run check`: run lint, typecheck, Node tests, renderer tests, and renderer build.

TypeScript is intentionally scoped to the renderer and shared IPC/wire types. Electron main/preload/database modules and the Tampermonkey userscript remain JavaScript to preserve their current runtime shape.

Test coverage map:

- `test/database.test.js`: SQLite schema migrations, sync visibility, search, import/export, streamed file export, and collection toggle persistence.
- `test/browser-tab-policy.test.js`: tab web preferences, media serialization, close target selection, tab cycling, and shortcut detection.
- `test/sync-utils.test.js`: numeric pager selection.
- `app/renderer-src/components/*.test.ts`: component rendering and emitted UI actions.
- `app/renderer-src/composables/*.test.ts`: BrowserView geometry/tab state and library pagination/filter state.

GitHub Actions run `npm run format:check` and `npm run check` for pushes and pull requests. Release packaging runs formatting, linting, and tests before building unsigned macOS and Windows artifacts.

### Desktop Validation

Run the full local quality gate before opening a pull request:

```sh
npm run check
```

For targeted checks, use `npm test` for SQLite/import/export/search behavior, `npm run typecheck` for renderer typing, `npm run test:renderer` for renderer unit tests, and `npm run build:renderer` for renderer build validation.

Manual checks:

- Restart the app and confirm the embedded browser keeps local Jable cookies when the server-side session is still valid.
- Open, switch, close, right-click, toggle compact mode, hover to reveal close buttons, and drag-resize browser tabs. Confirm Jable `target=_blank` links open a new app tab.
- Enter and leave fullscreen from a Jable video player. Confirm fullscreen covers the tab rail and top bar, then restores the normal browser layout after exit.
- Verify keyboard tab switching shortcuts from [`docs/shortcuts.md`](shortcuts.md), including repeated previous/next switching without clicking the page between keystrokes.
- Right-click Jable page content and verify link, media, selection, navigation, and page URL menu actions appear in the expected contexts.
- Toggle Jable favourite/watch-later buttons in the embedded page and confirm the local list updates after the site-side action succeeds.
- Quick sync both favourites and watch-later lists.
- Full sync a list and confirm local ordering matches the Jable page order.
- For large lists, continue a paused full sync and confirm incomplete batches do not hide old rows or unlock the sync tab too early.
- Search with `any`, `all`, and `phrase` modes and confirm title/URL filtering still matches README examples.
- Import an existing userscript JSON export and verify rows appear in the matching tab.
- Export JSON and confirm the `{ data: [...], meta: {...} }` shape is preserved.

### Desktop Packaging

Install dependencies once:

```sh
npm install
```

Packaging scripts build the Vue renderer before running `electron-builder`.

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

The workflow checks formatting, runs linting and tests, builds unsigned macOS artifacts with `npm run dist:mac:unsigned`, builds unsigned Windows artifacts with `npm run dist:win:unsigned`, then creates a GitHub draft release. Review and smoke test the draft assets before publishing the release.

No GitHub Actions repository secrets or variables are required for the unsigned release workflow. GitHub provides `GITHUB_TOKEN` automatically, and the workflow sets `permissions: contents: write` so it can create the draft release.

Expected draft release artifacts:

- macOS `.dmg`
- macOS `.zip`
- Windows `.exe`
- Windows `.zip`

Because these artifacts are unsigned, macOS Gatekeeper and Windows SmartScreen may warn users when they open the app.
