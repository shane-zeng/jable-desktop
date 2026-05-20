# Development Notes

> Developer-oriented notes for building, testing, packaging, and releasing Jable Desktop.

The short project entrypoint lives in [README.md](../README.md). Full user-facing guides live in [docs/README.zh-TW.md](README.zh-TW.md), [docs/README.en-US.md](README.en-US.md), and [docs/README.ja-JP.md](README.ja-JP.md). Current implementation-backed feature specifications live in [docs/specs/README.md](specs/README.md).

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
- Desktop app includes Download List and local video file management.
- Embedded browser uses multi-tab `WebContentsView` tabs with a persistent Jable session partition.
- Optional WebView enhancement mode can apply a small, Jable-specific loading and page cleanup ruleset in the shared session. It is off by default.
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

Log in inside the tabbed embedded browser, choose **影片收藏** or **稍後觀看** in the local data view, then click **快速同步** or **完整同步**. The browser has standard, compact, and shared tab rail modes, a persisted draggable-width left tab rail, native tab context actions, and a web-content context menu for links, media URLs, selection copy, Google search in the system default browser, and navigation. In shared mode, Local Data can show the browser tab rail while keeping new tabs opened from Local Data in the background. If `https://jable.tv` fails to load, the app automatically falls back to `https://fs1.app` for the current session. Jable cookies are kept in the isolated `persist:jable-session` Electron partition, but Jable can still expire or revoke the server-side session. The SQLite database path is shown in the local data view.

`npm start` builds the Rust native addons into `app/native-dist/`, compiles the Electron runtime into `app/runtime-dist/`, and builds the Vue renderer into `app/renderer-dist/` before Electron starts. For renderer development, run Vite in one terminal and Electron in another:

```sh
npm run dev:renderer
npm run start:dev
```

For HLS playback diagnostics, start Electron with `JABLE_HLS_PROBE=1`. The probe observes Jable-session HLS playlist and segment requests from the main process, prints `webContentsId`, Browser tab id, resource type, host, a short path hash, response status, cache state, and the canonical Jable video URL when available. It does not intercept, redirect, download, or log full HLS URLs. Segment logs are capped by default; set `JABLE_HLS_PROBE_VERBOSE=1` during short manual sessions when every segment request is needed. The formal playback-triggered download implementation lives under `app/main-process/hls-playback/`: `capture.ts` is the composition entrypoint, `proxy-server.ts` owns loopback token routing and playlist rewriting, `ipc.ts` owns renderer IPC channel registration and payload parsing, `capture-writes.ts` owns segment file writes and background prefetch, `proxy-headers.ts` owns proxy request/response headers, `probe.ts` owns debug request observation, `helpers.ts` owns pure URL/rewrite helpers, and `shared.ts` owns shared types and environment gates. `research.ts` is a legacy research entrypoint that delegates to the production capture installation so old imports do not keep a second proxy implementation alive. The Settings option **Auto-download while playing** is off by default; when enabled, the app rewrites page `fetch`/`XMLHttpRequest` `.m3u8` calls to short loopback token URLs, fetches the original playlist in main, rewrites segment, key, and nested playlist URIs to short loopback token URLs, and uses one managed segment cache for both playback and background completion. Playlist preload may be proxied before playback starts, but download records and managed segment writes begin only after webview preload observes a real page `<video>` play/playing event. Player requests and background prefetch share the same in-flight segment fetch, so media segments are not fetched twice for the same video. Pause, cancel, and delete stop playback-capture writes; delete also suppresses the still-open token from recreating a record. After all media segments are cached, the normal resume/remux path assembles the MP4 from local segment files. For manual diagnostics, `JABLE_HLS_PROXY=1` enables proxying without persisted setting state and `JABLE_HLS_CAPTURE=1` enables capture regardless of the persisted setting. The proxy intentionally avoids `webRequest` redirects because Chromium rejects CORS XHR external redirects to loopback.

Desktop sync behavior:

- **快速同步** navigates to page 1, updates scanned rows, and stops after a page where every row is already known. Its completion status reports rows scanned in the current run, not the final local collection count, because unscanned existing rows remain visible. It is intended for routine incremental updates after an initial full sync.
- **完整同步** navigates to page 1, updates all visible site rows, rebuilds `site_order`, and hides local rows not seen in a completed full run. Its completion status reports the final visible local row count after sync finalization.
- Full sync writes page 1 first, then can fetch remaining pages through a conservative `get_block` AJAX prefetch path with bounded concurrency. The AJAX path uses the user-configured Settings acceleration level, per-page jitter, retry/backoff for soft-rate-limit symptoms such as 403/429/5xx/timeouts/empty responses, validates active page number, last-page stability, first-page stability, expected page size, and duplicate URLs before writing prefetched rows, and reports the fallback reason when it switches to sequential paging.
- Sync runs in a dedicated background browser worker. Failed full runs are marked incomplete; scanned rows remain saved, but missing-row hiding is skipped until a completed full run.
- The webview scraper saves each page through `db:save-sync-page` and emits `sync-page` messages while it paginates. The renderer displays progress and calls `finishSync` after the worker returns.
- Jable collection add/remove button clicks are observed in `app/browser/webview-preload/collection-actions.ts`; during active sync they are deferred into the ordered `sync_operations` outbox. Outside active sync, successful site-side toggles are mirrored into local SQLite visibility state through `db:apply-collection-toggle`.
- The Rust data engine owns persisted outbox state. Deferred rows move through `pending`, `applied`, `failed`, `blocked`, `resolved`, and `superseded`; the webview only performs Jable AJAX with the current cookie/session. Deferred remote operations never alter normal local list visibility until Jable AJAX succeeds. Automatic replay is controlled by Settings and is off by default. When enabled, replay runs in original operation order and stops after the first failed operation, marking later pending rows as blocked. The main process replays the outbox one operation at a time so it can emit `sync-queue-progress` updates and keep the renderer progress bar accurate.
- The renderer's global Pending Sync tab is backed by `listPendingRemoteOperationGroups()`, which groups unresolved outbox rows by `collectionKey + videoUrl` without exposing a final-intent guess. Manual handling offers explicit `Add` and `Remove` actions, which send a single Jable AJAX operation and apply local visibility only after success, plus `Resolved`, which only clears local pending state. A later clean full sync marks older pending/failed/blocked rows from previous sync runs `superseded`; rows created during the current sync run remain pending when automatic replay is off.
- JSON export includes `site_order` as the desktop backup order field. Import accepts `site_order`, accepts `sort_order` as an alias, and falls back to JSON row order for older userscript exports. Renderer import UX lives in Settings > Data, preselects a collection from `meta.source_path`, `meta.source_url`, or filename when possible, and still requires a final target collection before calling `importJson({ collectionKey, resource })`.

Desktop data and search behavior:

- Local lists are loaded through paginated `listVideos` calls plus a matching `countVideos` query. Keep those query options in sync when adding filters: `collectionKey`, `search`, `searchMode`, `sort`, `direction`, `limit`, and `offset`.
- Video URLs from the fallback origin are canonicalized to `https://jable.tv` before local storage, so syncing through `https://fs1.app` does not duplicate existing rows.
- The local data engine is the Rust native addon under `native/local-data-engine`. It opens `jable-favourites.sqlite` and preserves the IPC return shapes exposed through `app/data/data-engine.ts`.
- The download engine is the Rust native addon under `native/download-engine`. Electron main passes request headers, HLS segment metadata, adaptive concurrency bounds, retry limit, and a managed temporary directory; the addon downloads HLS keys/segments and writes a local playlist for main-owned FFmpeg remuxing.
- Download Manager responsibilities are split by side-effect boundary under `app/main-process/download/`. `app/main-process/download/manager.ts` is the download composition root: it wires controllers, owns in-memory queue/active-task maps, pumps queued work, forwards the manager API, and broadcasts download notifications. `app/main-process/download-app-shutdown.ts` owns application-level quit/window-close gating around active downloads; the download manager's own `download/shutdown.ts` owns queued/active persistence and native/FFmpeg stop signals. `app/main-process/download/queue-actions.ts` owns queue-facing user actions: enqueue, retry, resume, pause, cancel, bulk variants, and playback auto-download disabling behavior. `app/main-process/download/file-actions.ts` owns local file action workflows: delete confirmation, managed file deletion, record removal, preview cleanup, open file, and reveal file. `app/main-process/download/active-runner.ts` owns one active download pipeline: mark started, create output directories, resolve source/segments, run FFmpeg remux, persist ready/failed/paused status, schedule preview generation, and clean runtime flags. `app/main-process/download/record-state.ts` owns persisted/runtime record projection: ready/missing file checks, paused-after-restart detection, playback-capture progress, and runtime byte/speed fields. `app/main-process/download/runtime-progress.ts` owns runtime byte/speed sampling and throttled progress notifications. `app/main-process/download/shutdown.ts` owns close-time download pausing, queued/active shutdown state persistence, native/FFmpeg stop signals, and the pause-before-close confirmation dialog. `app/main-process/download/playback-capture.ts` owns playback-triggered download capture state: page-load suppression, user-initiated playback gating, playback auto-resume guards, capture progress, and background completion queueing. `app/main-process/download/hls-source.ts` owns Jable cookie headers, source page fetches, source-page subtitle notice extraction, HLS playlist URL extraction, and variant playlist selection. `app/main-process/download/hls-segments.ts` owns Rust native HLS segment download calls, sampled concurrency options, segment progress polling, refresh-and-retry compatibility checks, and native segment error mapping. `app/main-process/download/ffmpeg-remux.ts` owns the FFmpeg child process, progress-pipe parsing, `.mp4.part` output, remux arguments, cancellation checks, and final rename. `app/main-process/download/environment.ts` owns external environment checks and user-configured paths: FFmpeg detection/path selection, download-root selection/readiness validation, and shell open/reveal behavior. `app/main-process/download/request-boundary.ts` owns renderer download payload normalization, trusted video URL enforcement, source-page subtitle notice parsing, collision-safe relative output filenames, and managed-path containment checks. `app/main-process/download/segment-workspace.ts` owns `.segments` directory naming, segment file names, resume-manifest identity, reusable segment counting, and segment-directory byte totals. Local playback internals live under `app/main-process/local-playback/`: `range.ts` owns HTTP range parsing, `server.ts` owns custom-protocol token/source/request handling, and `preview.ts` owns preview metadata/VTT/image generation and cleanup.
- App-level collection metadata lives in `app/data/collections.ts`; Rust data-engine collection metadata lives in `native/local-data-engine/src/collections.rs`. Keep both definitions aligned when changing supported collections, names, or source paths.
- Local search uses SQLite FTS5 through `video_search`. `videos.search_text` is generated from title and URL with normalized tokens/ngrams so CJK, punctuation-normalized phrases, and URL fragments can be searched locally.
- The search modes are `any`, `all`, and `phrase`. `any` joins term queries with `OR`, `all` joins them with `AND`, and `phrase` compacts punctuation/spacing before matching phrase ngrams.
- Database migration creates `videos`, `collections`, `collection_items`, and `sync_states`; adds `site_order`, `is_visible`, `missing_at`, `last_sync_run_id`, `videos.search_text`, and outbox state columns such as `remote_apply_state`, `remote_failed_at`, `remote_blocked_by`, `remote_resolved_at`, and `remote_superseded_at`; verifies the FTS table columns; recreates triggers when needed; and rebuilds the index if search text changed or FTS objects are missing.
- Rust-owned data-engine invariants are covered directly in `native/local-data-engine/src/tests.rs`. Any change to migrations, FTS/search tokenization, sync visibility, sync operation reduction, outbox state transitions, pending remote grouping, resolved/superseded handling, or JSON import/export should add or update Rust tests there in addition to the shared Node data-engine contract tests.
- Direct collection adds from Jable page actions use a negative `site_order` fallback until the next full sync rebuilds site ordering.
- Desktop JSON file export streams pages to a temporary file, yields between batches, and atomically renames the file when complete. Keep cleanup paths covered when changing export behavior.

Browser and tab behavior:

- User-facing app settings are stored in `settings.json` under Electron `userData` through `app/main-process/settings.ts`. Shared limits and defaults live in `app/app-contract.ts`. Keep `app/types/jable.ts`, `app/app-contract.ts`, `app/main-process/settings.ts`, `app/preload.ts`, main IPC handlers, `SettingsPanel.vue`, and `test/node/settings.test.js` aligned when adding or changing settings.
- Browser runtime wiring lives under `app/main-process/browser/`. `runtime.ts` composes tab management, shortcuts, session restore/save, preload request bookkeeping, and theater-mode state so `app/main.ts` stays focused on application lifecycle and top-level manager registration.
- Browser startup tab restore is controlled by app settings but stores its runtime snapshot separately as `browser-session.json` under Electron `userData`. `app/main-process/browser/session-controller.ts` owns restore/save timing and delegates file persistence to `app/main-process/browser/session-store.ts`. It restores only normal tab URLs, active tab, locked state, and muted state.
- Browser preload request/response IPC bookkeeping lives in `app/main-process/browser/preload-requests.ts`; it owns request ids, sender matching, timeout cleanup, and failed renderer rejection. Main-process callers should go through `app/main-process/browser/runtime.ts` instead of keeping per-call request maps.
- Active Jable origin fallback state lives in `app/main-process/browser/origin-controller.ts`; trusted URL rules remain in `app/browser/url-policy.ts`.
- Browser tab state includes navigation flags plus media fields: `muted`, `audible`, `mediaPlaying`, `pictureInPicture`, and `discarded`. Keep `app/browser/browser-tab-policy.ts`, `app/main-process/browser/runtime.ts`, main-process serialization, renderer state, and tests aligned.
- `app/browser/browser-tab-policy.ts` centralizes background throttling, tab media serialization, close selection, keyboard tab switching detection, and visual-order tab cycling. Update `test/node/browser-tab-policy.test.js` when changing any of those rules.
- Closing the active tab prefers the next tab to the right; if closing the last tab, it falls back to the previous tab. Closing an inactive tab must not change the active tab.
- Keyboard previous/next tab switching follows tab rail visual order and wraps at both ends. After active-tab changes, `app/main.ts` focuses the new active `BrowserView.webContents` so repeated shortcuts keep working.
- `window.open` and `target=_blank` create app browser tabs. Background-tab dispositions remain background tabs; other dispositions activate the new tab.
- `app/browser/webview-enhancement.ts` centralizes the optional Jable-specific WebView loading rules for the `persist:jable-session` Electron session. It keeps Jable `mainFrame` navigations and `blob:` media URLs untouched. `app/browser/webview-content-policy.ts` is used by the webview preload to apply matching page cleanup rules. The Settings value `webViewEnhancementMode` defaults to `false`; when enabled, the main process forwards `settings-changed` to active BrowserView tabs so the preload can apply the mode without restarting.
- `app/browser/url-policy.ts` centralizes trusted Jable origins (`https://jable.tv`, `https://fs1.app`), safe browser-tab protocols, GitHub release external URL checks, collection URL checks, and fallback-origin rewrites.
- Sync tabs use `kind: 'sync'`, stay locked while syncing, and keep background throttling disabled through `browserTabWebPreferences`.
- Main-process browser sync and diagnosis requests are sent to `app/webview-preload.ts` through request/response IPC channels managed by `app/main-process/browser/preload-requests.ts` and exposed through `app/main-process/browser/runtime.ts`. Browser-side sync orchestration and deferred remote replay live in `app/browser/webview-preload/browser-sync.ts`. Pure webview preload helper behavior for pager/AJAX URL parsing, retry/backoff, metric parsing, page numbers, and video path keys lives in `app/browser/webview-preload-helpers.ts`; focused preload runtime concerns live under `app/browser/webview-preload/`. Do not call embedded page functions through injected JavaScript strings.
- HTML fullscreen from embedded pages only expands within the current `WebContentsView` bounds. `app/main.ts` handles `enter-html-full-screen` and `leave-html-full-screen` by temporarily stretching the active BrowserView over the app chrome, then restoring the renderer-provided bounds when fullscreen exits.
- Theater mode is tab-scoped runtime state for trusted Jable video pages. It is toggled through the embedded page context menu, requested by `app/main-process/browser/runtime.ts`, applied by `app/browser/webview-preload/theater-mode.ts` with page CSS inside the current `WebContentsView`, preserved across tab switches/reloads/Jable video-to-video navigation, and not included in startup session restore.
- Application-specific keyboard shortcuts and mouse shortcuts are inventoried in [`docs/shortcuts.md`](shortcuts.md). Settings > Shortcuts renders the user-facing list from `app/renderer-src/shortcut-catalog.ts`. When changing shortcut behavior, update the implementation, shortcut catalog, docs, and focused tests together; keep them aligned with `app/browser/browser-tab-policy.ts`, `app/main-process/browser/shortcut-manager.ts`, `app/webview-preload.ts`, and renderer link handlers.

WebView preload responsibility boundaries:

- `app/webview-preload.ts` is the embedded-page composition root. It may own live DOM glue that must run inside the Jable page: controller construction, install order, current-page scraper callbacks, pager DOM replacement and click/fetch fallback, request/response IPC registration, page diagnosis, and tab gesture forwarding.
- `app/browser/webview-preload-helpers.ts` owns pure parsing and validation helpers that do not need live page state: row scraping from a supplied root, pager/AJAX URL derivation, retry/backoff details, metric parsing, page numbers, signatures, and video path keys.
- `app/browser/webview-preload/video-metadata.ts` owns current video URL detection, page title/meta/view/like/subtitle notice readers, clean title normalization, and `db:refresh-video-metadata` scheduling.
- `app/browser/webview-preload/browser-sync.ts` owns browser-side sync orchestration: quick/full pagination flow, bounded AJAX prefetch fallback decisions, sync progress messages, `db:collection-urls-known`, `db:save-sync-page`, and deferred remote operation replay order.
- `app/browser/webview-preload/collection-actions.ts` owns Jable collection button interception, active sync locks, deferred toggle queuing, successful toggle mirroring, and pending operation overlays.
- `app/browser/webview-preload/hls-playback.ts`, `local-playback.ts`, and `theater-mode.ts` own playback and view-mode runtime observers/controllers. `app/webview-preload.ts` should only provide their callbacks for current video URL/details, main video lookup, IPC, and install order.
- Do not move behavior into a new preload module only to reduce line count. Further extraction should have a real boundary, preserve IPC channel names and payload shapes, and keep DOM side effects explicit through injected callbacks instead of hidden globals.

`app/webview-preload.ts` can still be split further, but the remaining candidates should be handled one concern at a time:

- Pager DOM runtime (`waitForContainerChange`, pager link reading, DOM replacement, AJAX page materialization, and click/fetch fallback) could become a `pager-runtime.ts` module, but it is more tightly coupled to sync callbacks and should keep `browser-sync.ts` as the state-machine owner.
- Trackpad history and middle-click new-tab forwarding could become a small input/navigation module, but do this only when adding related behavior; today it is not large enough to justify another wrapper by itself.
- Request/response IPC registration should stay in `app/webview-preload.ts` unless it becomes repetitive enough that an IPC router clearly reduces cognitive load.

Renderer behavior:

- `app/preload.ts` exposes the only renderer-to-main boundary as `window.jableApp`; `app/types/jable.ts` is the contract for those IPC payloads and responses.
- `app/main-process/ipc-normalizers.ts` normalizes and validates IPC payloads at runtime before database or browser-tab handlers use them. Keep preload method shapes, `app/types/jable.ts`, and IPC normalizers aligned when adding IPC calls.
- `app/renderer-src/App.vue` owns top-level renderer wiring for Browser, Local Data, Settings, browser messages, import/export, layout, and whether Local Data new-tab actions activate Browser or stay in the background. Focused composables own BrowserView state, local library state, sync workflow, pending remote actions, and toast status.
- `useBrowserBounds` owns BrowserView geometry, visibility, tab state, navigation state, and resize scheduling. When leaving the browser view, it hides BrowserViews by sending `{ visible: false }`.
- `useLibraryState` owns collection/pending-tab selection, pagination, search mode, sorting, pending remote operation groups, refresh token cancellation, and the pending full-sync continuation label.
- `useSyncWorkflow` owns quick/full sync orchestration, queue progress status, AJAX retry/fallback status, finalization, and full-sync continuation updates.
- `usePendingRemoteActions` owns Pending Sync Add/Remove/Resolved renderer actions and their refresh/status side effects.
- `useToastStatus` owns toast filtering, tone inference, sticky state, and auto-hide timing.
- Browser tab rail display mode is stored in shared app settings. Tab rail width remains a renderer-local `localStorage` preference because it only affects layout.
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

Licensing and attribution:

- The project license is Apache License 2.0. Keep `LICENSE`, `package.json`, the root package entry in `package-lock.json`, `jable-favourites-exporter.user.js` metadata, `README.md`, and `docs/README.*.md` aligned when license metadata changes.
- The root `LICENSE` file should stay as the canonical Apache License 2.0 text for scanner compatibility. Project-specific copyright, disclaimers, and acknowledgements belong in README/user documentation.
- `package-lock.json` also records dependency licenses. Only the root package entry reflects this project's license; do not bulk-edit dependency license fields.
- Download workflow design is acknowledged in README as referencing `hcjohn463/JableDownload`. If future changes copy code, assets, or substantial implementation text from that or any other project, verify license compatibility and preserve required copyright, attribution, and NOTICE material.
- Do not add a root `NOTICE` file unless there is a concrete notice obligation or project-level attribution that downstream redistributors must preserve.

Desktop app files:

- `app/app-contract.ts`: shared user-facing contract constants such as page size, app settings defaults, and settings limit ranges.
- `app/main.ts`: Electron main-process entrypoint and composition root for app lifecycle, window creation, shared services, and manager registration.
- `app/main-process/`: main-process domain modules for browser runtime composition, BrowserView tabs, keyboard shortcuts, browser session restore/save, browser preload request bookkeeping, active-origin fallback, app/native menus and update dialogs, app local/export/documentation actions, context menus, app-level download shutdown gating, download orchestration, HLS playback proxy/probe/capture modules, local playback range/server/preview helpers, sync workers, IPC registration, IPC payload normalizers, settings persistence, and release update fetching.
- `app/preload.ts`: context-isolated renderer IPC bridge exposed as `window.jableApp`.
- `app/webview-preload.ts`: preload composition root and scraper/pager DOM runtime injected into each embedded Jable `WebContentsView`.
- `app/browser/`: browser/runtime policy modules: pure BrowserView tab policy, trusted URL policy, optional WebView loading and page cleanup rules, pure webview preload helper logic for AJAX/pager URL parsing, retry/backoff, metrics, page numbers, and video path keys, plus focused preload runtime modules under `app/browser/webview-preload/`.
- `app/sync/`: shared pager-selection helper for sync pagination.
- `app/data/`: app collection metadata, local data engine boundary backed by the Rust native addon, and native data addon loader.
- `app/download/`: HLS playlist parsing helpers and native download addon loader.
- `native/local-data-engine/`: Rust SQLite data engine. `src/lib.rs` owns the N-API bridge, engine lifecycle, transaction helper, and method dispatch. `src/schema.rs` owns migrations and FTS setup, `src/search.rs` owns search tokenization, `src/store.rs` owns local list queries/upserts/resequencing, `src/sync.rs` owns sync and outbox state transitions, `src/resource.rs` owns JSON import/export, `src/payload.rs` owns payload coercion and URL normalization, `src/collections.rs` owns collection metadata, and `src/rows.rs` owns row mapping structs/helpers.
- `native/download-engine/`: Rust HLS download engine. It owns sampled adaptive concurrency, bounded parallel key/segment HTTP fetching, retry, cancellation flags, temporary segment writes, and local playlist generation.
- `app/types/`: shared renderer-facing TypeScript wire types for IPC payloads and app state.
- `app/runtime-dist/`: TypeScript-compiled Electron runtime loaded by Electron and packaged for release.
- `app/native-dist/`: built native `.node` addons loaded by Electron and unpacked from packaged apps.
- `app/renderer-src/`: Vue 3 + TailwindCSS + TypeScript renderer source.
- `app/renderer-src/composables/`: renderer state modules for IPC access, BrowserView bounds/tabs/navigation, local library state, sync workflow, pending remote actions, and toast status.
- `app/renderer-src/components/`: presentational Vue components for top navigation, browser tabs, local data controls, pagination, and video cards.
- `app/renderer-dist/`: Vite-built renderer loaded by Electron and packaged for release.
- `test/node/`: Node tests for database behavior, sync utilities, i18n, update checks, and browser tab policy.
- `test/renderer/`: Vitest renderer/component/composable tests.
- `test/electron/`: Playwright Electron startup smoke test for the real app boot path, preload bridge exposure, and basic settings/tab IPC reachability. Keep this targeted and thin; broader behavior coverage belongs in Node, Rust, or renderer tests.
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
- `npm run build:rust`: build the Rust native data and download engines into `app/native-dist/`.
- `npm run build:electron`: compile Electron runtime TypeScript into `app/runtime-dist/`.
- `npm run format`: format the repository with Prettier.
- `npm run format:check`: verify formatting without changing files.
- `npm run check`: run lint, typecheck, Node tests, renderer tests, and renderer build.
- `npm run test:electron`: build the Electron runtime and renderer, then run the minimal Playwright Electron startup smoke test with isolated test user data and a local HTTP page. This is a targeted Electron boot/preload check, not part of `npm run check`.

TypeScript covers the renderer, shared IPC/wire types, and Electron runtime source. The Tampermonkey userscript remains JavaScript to preserve its no-build, self-contained runtime shape.

Test coverage map:

- `test/node/database.test.js`: SQLite schema migrations, sync visibility, search, import/export, streamed file export, and collection toggle persistence.
- `test/node/webview-enhancement.test.js`: optional WebView loading rule matching, navigation suppression, environment switches, and Electron listener installation.
- `test/node/webview-content-policy.test.js`: DOM container removal for configured WebView content cleanup rules.
- `test/node/browser-tab-policy.test.js`: tab web preferences, media serialization, close target selection, tab cycling, and shortcut detection.
- `test/node/download-helpers.test.js`: HLS playlist extraction, playlist parsing, request header handling, resume manifest compatibility, and error sanitization helpers.
- `test/node/download-manager.test.js`: Download Manager orchestration helpers, speed mode mapping, local playback serving/preview behavior, failure classification, bulk result shapes, refresh retry compatibility, and sanitizer behavior.
- `test/node/ipc-normalizers.test.js`: renderer IPC payload validation and normalization.
- `test/node/webview-preload-helpers.test.js`: pure webview preload helper behavior for constants, metrics, page parsing, AJAX URLs, and retry details.
- `test/node/settings.test.js`: app settings defaults, persistence, and user-facing limit clamping.
- `test/node/sync-utils.test.js`: numeric pager selection.
- `test/node/i18n.test.js` and `test/node/userscript-i18n.test.js`: locale normalization, dictionary key parity, missing-key behavior, and userscript locale UI guardrails.
- `native/local-data-engine/src/tests.rs`: Rust-native data-engine invariants that should not depend only on addon contract coverage, including URL normalization, site-order import aliases, search token matching, outbox grouping, resolved groups, full-sync superseded state, and download asset metadata persistence.
- `native/download-engine/src/planning.rs` and `native/download-engine/src/playlist.rs`: Rust-native download engine concurrency planning, CDN rejection handling, and local HLS playlist generation.
- `test/renderer/components/*.test.ts`: component rendering and emitted UI actions.
- `test/renderer/composables/*.test.ts`: BrowserView geometry/tab state, library pagination/filter state, sync workflow status, pending remote actions, and toast status.
- `test/electron/app-smoke.test.js`: desktop app startup through Electron, `window.jableApp` preload bridge exposure, `app:info`, settings IPC reachability, and initial browser tab state.

GitHub Actions read Node.js from `.node-version`, then run `npm run format:check` and `npm run check` for pushes and pull requests. Release packaging runs the same formatting and quality checks before building unsigned macOS and Windows artifacts.

### Desktop Validation

Run the full local quality gate before opening a pull request:

```sh
npm run check
```

For targeted checks, use `npm test` for SQLite/import/export/search behavior, `npm run rust:test` for Rust-native data-engine unit tests, `npm run rust:ci` for Rust formatting/check/clippy/test coverage, `npm run typecheck` for renderer and Electron runtime typing, `npm run test:renderer` for renderer unit tests, `npm run test:electron` only for Electron startup, BrowserWindow/WebContentsView bootstrapping, preload bridge exposure, protocol/session setup, or main/preload IPC registration wiring, `npm run build:electron` for Electron runtime output, and `npm run build:renderer` for renderer build validation.

Manual checks:

- Restart the app and confirm the embedded browser keeps local Jable cookies when the server-side session is still valid.
- Open, switch, close, right-click, toggle tab rail display modes from settings and shortcuts, hover to reveal close buttons, and drag-resize browser tabs. In shared mode, confirm Local Data shows the same tab rail and its new-tab actions create background tabs without switching away from Local Data. Confirm Jable `target=_blank` links open a new app tab.
- Enter and leave fullscreen from a Jable video player. Confirm fullscreen covers the tab rail and top bar, then restores the normal browser layout after exit.
- Toggle theater mode from a Jable video page context menu and with plain `T`. Confirm it fills only the browser content area, preserves the top bar and tab rail, exits with `Esc` and the in-content `x` button, leaves `Command+T` / `Ctrl+T` as new-tab shortcuts, survives tab switches/reload/video-to-video navigation, and is absent from non-video pages.
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

Packaging scripts build the Rust native addons, Electron runtime, and Vue renderer before running `electron-builder`. The native `.node` files are included from `app/native-dist/` and unpacked through `asarUnpack`, because Electron cannot load native addons directly from inside `app.asar`.

macOS release packaging targets Apple Silicon only. Windows release packaging runs on a Windows x64 runner so `npm run build:rust` produces the `jable_data_engine.win32-x64.node` and `jable_download_engine.win32-x64.node` addons before `electron-builder` packages the app.

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
