# IPC Contract Specification

Last verified against implementation: 2026-05-19

This document summarizes the current IPC boundary. `app/types/jable.ts` is the source of truth for exact TypeScript payload and response types.

## Boundary Rules

- The renderer must access main-process functionality only through `window.jableApp`.
- `window.jableApp` is exposed by `app/preload.ts` through Electron `contextBridge`.
- The renderer must not call `ipcRenderer` directly.
- Jable page automation runs in `app/webview-preload.ts`.
- Main process requests to webview preload use request/response IPC and timeouts.
- Runtime normalizers in `app/main-process/ipc-normalizers.ts` validate renderer IPC payloads before database or browser handlers use them.
- IPC method names and payload shapes must stay aligned across:
  - `app/types/jable.ts`
  - `app/preload.ts`
  - `app/main-process/ipc-normalizers.ts`
  - `app/main.ts`
  - renderer callers
  - tests

## App And Settings API

Renderer API group:

- `getAppInfo()`
- `getSettings()`
- `updateSettings(patch)`
- `setLocale(locale)`

Current behavior:

- `getAppInfo()` returns database path, current locale, and system locale.
- `getSettings()` returns normalized persisted app settings, including browser tab display mode and startup tab restore preference.
- `updateSettings()` normalizes and persists supported settings only.
- `restoreBrowserTabsOnStartup` defaults to `false`; when set to `true`, the main process stores and restores normal browser tab URLs, active tab, locked state, and muted state through an internal `browser-session.json` file. This does not add a renderer IPC method.
- `autoDownloadOnPlayback` defaults to `false`; when set to `true`, Jable browser-tab HLS playback may be proxied through app-owned loopback URLs so playback and background completion share one managed segment cache. The download record is created only after webview preload reports actual video playback, not merely when the page preloads a playlist.
- `setLocale()` normalizes locale, updates main-process locale, rebuilds native menus, and returns the normalized locale.

## Downloads And FFmpeg API

Renderer API group:

- `getFfmpegStatus()`
- `refreshFfmpegStatus()`
- `chooseFfmpegPath()`
- `setFfmpegPath(filePath)`
- `clearFfmpegPath()`
- `getDownloadRoot()`
- `chooseDownloadRoot()`
- `setDownloadRoot(filePath)`
- `clearDownloadRoot()`
- `openDownloadRoot()`
- `listDownloads()`
- `enqueueDownload(payload)`
- `retryDownload(videoUrl)`
- `pauseDownload(videoUrl)`
- `resumeDownload(videoUrl)`
- `cancelDownload(videoUrl)`
- `openDownloadFile(videoUrl)`
- `revealDownloadFile(videoUrl)`
- `deleteDownload(videoUrl)`
- `localPlaybackSource(videoUrl)`

Current behavior:

- FFmpeg status is detected and validated in main process by running `ffmpeg -version`.
- Manual FFmpeg paths are persisted in settings and used for later downloads when valid.
- Download root selection is persisted in settings and resolved in main process.
- Download records are listed from the Rust data engine download asset store.
- Download records include `collectionKeys` for current visible local collection membership. The original enqueue source collection does not control the stored file path.
- Enqueue, retry, and resume verify FFmpeg readiness before queueing work.
- The main-process download queue can run multiple active video downloads up to the persisted Settings > Downloads maximum.
- Pause marks queued or active records `paused`, aborts active Rust/FFmpeg work or playback-capture prefetch, removes unreliable `.mp4.part` output, and preserves resumable segment temp files.
- During App quit, pause-and-close waits for active download workers to settle before the native data engine is closed, so paused-state cleanup can still write safely.
- Resume moves a paused record back to `queued`; the active worker refreshes source metadata and reuses compatible completed segment files. Compatibility ignores signed CDN URL changes and uses reusable segment structure instead.
- HLS key and segment fetching is delegated to the Rust native download engine; the main process passes request headers, segment metadata, adaptive concurrency bounds, retry limit, and a temporary directory path.
- Open, reveal, retry, pause, resume, cancel, and delete calls use a video URL, not renderer-provided local paths.
- Delete verifies managed-root containment before unlinking a local file. If the deleted item is an active playback-triggered capture, main also suppresses further writes from the still-open playback token so continued page playback does not recreate the record.
- `localPlaybackSource()` returns a short-lived `jable-local-video://` source only for canonical trusted video URLs whose managed download record is `ready` and whose file still exists inside the current download root.
- The local playback protocol supports `GET`, `HEAD`, and single byte ranges for MP4 playback. It revalidates the download record and managed file path for every request.
- Browser-tab preload may invoke the internal `hls:playlist-proxy-url` IPC from a trusted Jable video page with the playlist URL and current page metadata. It also sends the internal `hls:playback-started` notification when the page `<video>` actually starts playing. Main returns unavailable while `autoDownloadOnPlayback` is off, unless a development HLS proxy/capture environment flag explicitly enables diagnostics.
- Main forwards `downloads-changed` browser messages with the current download list after download state changes, and also sends the same direct message to browser-tab preloads so open video pages can re-check local playback.
- Active `downloads-changed` records may include runtime-only `downloadedBytes`, `downloadSpeedBytesPerSecond`, or playback-capture `progress` fields while work is running. Download speed and active playback-capture progress are sampled from completed reusable segment bytes and are not persisted.
- Download records include the internal persisted `playbackAutoResumeBlocked` boolean. Renderer UI does not expose it, but main uses it to keep a user-paused normal downloader from being silently restarted by later playback-triggered capture.
- The renderer uses `downloads-changed` to refresh Download List/source-card state and to show completion/failure toasts.

## Local Data API

Renderer API group:

- `listVideos(options)`
- `countVideos(options)`
- `getCollectionUrls(collectionKey)`
- `saveSyncPage(payload)`
- `finishSync(payload)`
- `clearSyncState(collectionKey)`
- `importJson(payload)`
- `exportJson(collectionKey)`
- `exportJsonFile(collectionKey)`

Current behavior:

- `listVideos()` and `countVideos()` share the same filter and search options, including collection download filtering.
- `getCollectionUrls()` returns known URLs for a collection.
- `saveSyncPage()` persists scraped sync rows.
- `finishSync()` finalizes sync state and applies full-sync visibility rules.
- `clearSyncState()` removes stored sync state for a collection.
- `importJson()` imports an already parsed JSON resource into an explicit collection.
- `exportJson()` returns an in-memory export resource.
- `exportJsonFile()` opens a native save dialog and streams export JSON to disk when not canceled.
- WebView preload may call `db:refresh-video-metadata` directly for Jable video pages. This IPC is not exposed through `window.jableApp`; it canonicalizes trusted Jable video URLs and refreshes only existing local video metadata without changing collection membership.

## Pending Remote Operation API

Renderer API group:

- `listPendingRemoteOperationGroups()`
- `addPendingRemoteOperationGroup(groupId)`
- `removePendingRemoteOperationGroup(groupId)`
- `resolvePendingRemoteOperationGroup(groupId)`

Current behavior:

- Listing returns grouped unresolved deferred operations.
- Add and Remove use a sync worker to apply one explicit remote action through Jable AJAX.
- Add and Remove update local visibility only after remote success.
- Resolve clears local pending state without remote AJAX and without changing normal local list visibility.

## Browser Tab API

Renderer API group:

- `listBrowserTabs()`
- `showBrowserTabMenu(payload)`
- `showLibraryVideoMenu(payload)`
- `createBrowserTab(payload)`
- `activateBrowserTab(tabId)`
- `closeBrowserTab(tabId)`
- `setBrowserTabLocked(payload)`
- `setBrowserTabMuted(payload)`
- `setBrowserBounds(bounds)`

Current behavior:

- `listBrowserTabs()` returns active tab ID, max tab limit, and serialized tabs.
- `createBrowserTab()` normalizes safe URL, kind, activation, title, lock, mute, favicon, force-reload, and opener-tab fields.
- `activateBrowserTab()` attaches and focuses the selected tab.
- `closeBrowserTab()` respects locked tabs and close-selection policy.
- `setBrowserTabLocked()` toggles tab lock state.
- `setBrowserTabMuted()` toggles audio mute state through `webContents`.
- `setBrowserBounds()` stores renderer-provided BrowserView geometry and attaches the active BrowserView when visible.
- Native tab and library-video context menus return whether a menu was shown.

## Browser Navigation API

Renderer API group:

- `navigateBrowser(payload)`
- `reloadBrowser(payload)`
- `goBackBrowser(payload)`
- `goForwardBrowser(payload)`
- `getBrowserNavigationState(payload)`
- `getBrowserUrl(payload)`
- `diagnoseBrowser(payload)`

Current behavior:

- Navigation payloads target the active tab by default.
- Navigation accepts only safe browser URLs.
- Primary-origin load failures can trigger fallback-origin reload.
- Back and forward use Electron navigation history where available.
- Navigation state includes can-go-back, can-go-forward, lock state, and optional reload marker.
- Diagnosis returns current page layout metrics or an error string.

## Sync Browser API

Renderer API group:

- `syncBrowserCollection({ tabId, options })`
- `onBrowserMessage(callback)`

Current behavior:

- `syncBrowserCollection()` runs sync inside a dedicated sync worker tab unless an existing compatible worker can continue.
- Sync options include collection, mode, sync run ID, site-order offset, start page, stop-on-known-page flag, batch limit, and AJAX prefetch concurrency (`ajaxWindowSize`).
- The main process augments sync options with current settings.
- `onBrowserMessage()` receives forwarded browser events from main and webview preload.

Important browser message channels:

- `sync-page`
- `sync-progress`
- `sync-queue-progress`
- `collection-toggle`
- `library-video-menu-action`
- `browser-tabs-compact-mode`
- `jable-origin-fallback`
- `browser-error`
- `downloads-changed`

## Webview Preload Request Channels

Main process sends these request/response commands to `app/webview-preload.ts`:

- `browser:sync-collection-request`
- `browser:apply-deferred-sync-operations-request`
- `browser:diagnose-request`

Webview preload also receives state broadcasts:

- `browser:sync-lock-state`
- `browser:pending-collection-operations`
- `downloads-changed`

Webview preload emits:

- `browser:sync-page`
- `browser:sync-progress`
- `browser:trackpad-history`
- `browser:open-url-new-tab`
- `browser:preload-response`

## Validation Requirements

- Collection keys must be known collection keys.
- Search mode must be `any`, `all`, or `phrase`.
- Sort key must be `site_order`, `title`, `views`, or `likes`.
- Sort direction must be `asc` or `desc`.
- Sync mode must be `quick` or `full`.
- Browser tab kind must be `normal` or `sync`.
- Numeric fields are normalized before use.
- Unknown or invalid payload shapes throw explicit IPC payload errors.
- Download operations are resolved by video URL.
- Renderer-provided local file paths are not accepted for download open, reveal, delete, or write operations.

## Related Tests

- `test/electron/app-smoke.test.js`
- `test/node/ipc-guardrails.test.js`
- `test/node/ipc-normalizers.test.js`
- `test/node/settings.test.js`
- `test/node/download-helpers.test.js`
- `test/node/browser-tab-policy.test.js`
- `test/renderer/composables/useBrowserBounds.test.ts`
- `test/renderer/composables/useLibraryState.test.ts`
- `test/renderer/composables/usePendingRemoteActions.test.ts`
- `test/renderer/composables/useSyncWorkflow.test.ts`
- `test/renderer/composables/useToastStatus.test.ts`
