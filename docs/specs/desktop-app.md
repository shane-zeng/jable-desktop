# Desktop App Specification

Last verified against implementation: 2026-05-18

This document specifies the current user-facing Electron desktop application behavior.

## Application Shell

- The app is an Electron desktop app with a Vue 3 renderer and a context-isolated preload bridge.
- The renderer exposes three top-level views:
  - Browser
  - Local Data
  - Settings
- The top bar provides browser back, forward, and reload controls when the Browser view is active.
- The top bar switches between Browser and Local Data through segmented controls.
- Settings is opened from a dedicated top-level button.
- The renderer UI is dark-mode-only.
- Desktop UI locales are `zh-TW`, `en-US`, and `ja-JP`.
- Locale selection affects renderer copy, native menus, context menus, dialogs, and toast messages.
- `app/renderer-src/App.vue` owns top-level wiring, while focused composables own browser bounds, library state, sync workflow, pending remote actions, and toast status.

## Browser View

- The Browser view hosts embedded Jable pages through main-process `WebContentsView` instances.
- Browser tabs are shown in a left tab rail.
- Users can open, activate, close, mute, and reload browser tabs.
- A new normal tab opens the configured Jable home URL, defaulting to `https://jable.tv/`.
- Newly created browser tabs follow opener-group behavior: repeated tabs opened from the same source tab are kept together below that source tab and before the next unrelated tab.
- Closing active opener-group child tabs walks through the remaining children first, then returns to the opener tab before moving to unrelated tabs.
- The tab rail supports persisted standard, compact, and shared display modes through app settings.
- Tab rail width is a renderer-local `localStorage` preference.
- Tab width can be reset from Settings.
- Compact mode reveals a floating tab rail when the pointer enters the compact trigger area.
- Shared mode shows the same tab rail in Browser and Local Data views; activating a browser tab from Local Data returns to Browser.
- Locked sync tabs cannot be closed from the tab UI.
- Browser tabs expose media state for muted, audible, media playing, picture-in-picture, and discarded state. The tab rail mute control appears only for muted or audible tabs, so silent hover preview playback does not show an audio control by itself.
- When a browser tab opens a Jable video page and that video has a ready managed download, the page video source is automatically replaced with the local MP4. Missing or unavailable downloads leave the original Jable player behavior unchanged.
- When a browser tab opens a Jable video page that already exists in synced local collection data, the app refreshes the local video's title, views, likes, thumbnail, preview, and search metadata without changing collection membership or ordering.

## Local Data View

- Local Data has collection tabs for `favourites` and `watch_later`.
- A global Pending Sync tab appears when unresolved pending remote operation groups exist.
- A global Download List tab shows managed local video downloads across both collections.
- Each collection tab supports:
  - Quick Sync
  - Full Sync
  - Selected batch download for explicitly checked visible video cards
  - Select All for visible downloadable video cards only
  - Search text
  - Search mode: `any`, `all`, `phrase`
  - Download state filter: all collection rows or not downloaded rows
  - Sort key: `site_order`, `title`, `views`, `likes`
  - Sort direction: `asc`, `desc`
  - Pagination
- Page size is 24 rows.
- Video cards show thumbnail, optional hover preview, title, views, likes, and last synced time.
- Video cards show a compact download button and a checkbox for selected batch download. Download controls reflect the global download state for that video URL and avoid showing detailed progress or error text on source collection cards.
- Select All does not select `queued`, `downloading`, or `ready` cards.
- The not downloaded collection filter shows rows with no download record plus `paused`, `failed`, or `missing` records. It excludes `queued`, `downloading`, and `ready` records.
- Clicking a local video opens it in the current browser tab.
- Middle-click or platform new-tab click opens a local video in a new browser tab.
- Right-clicking a local video opens a native context menu with open/copy actions.

## Pending Sync View

- Pending Sync groups unresolved remote operations by collection and video URL.
- A group shows collection, current remote apply state, error text when present, operation count, and operation sequence.
- The view does not infer a final intended state from the sequence.
- Manual actions are explicit:
  - Add
  - Remove
  - Resolved
- Add and Remove send a single Jable AJAX operation through a sync worker and update local visibility only after remote success.
- Resolved clears local pending state without changing normal local collection visibility.
- Pending cards support the same current-tab and new-tab video opening behavior as normal video cards.

## Download List View

- Download List is a global local-assets view under Local Data, not a third Jable collection.
- Download List is available for videos downloaded from either Favourites or Watch Later.
- Download records are independent from collection membership.
- The view renders queued, downloading, failed, ready, and missing records.
- Search, state filter, and sort controls filter records locally in the renderer.
- The Download List state filter is persisted in app settings and survives app restart.
- Ready records can be opened with the OS default player, revealed in the OS file manager, opened back on Jable, or deleted.
- Failed and missing records can be retried or deleted.
- Queued and downloading records can be canceled.
- Deleting a download removes the managed local file and download record, but does not alter Favourites, Watch Later, Pending Sync, or Jable remote state.
- Download completion and failure are surfaced through localized toast messages.

## Settings View

- General settings:
  - UI locale
  - Manual update check
- Browser settings:
  - Maximum browser tabs
  - Browser tab rail display mode
  - Reset tab rail width
- Sync settings:
  - Full sync acceleration: safe, standard, fast
  - Automatic post-sync replay of deferred sync operations
- Downloads settings:
  - FFmpeg status, version, source, and path
  - Check Again for FFmpeg detection
  - Choose FFmpeg for manual binary selection
  - Use PATH for clearing a manual FFmpeg path
  - Maximum active video downloads
  - Current download folder
  - Choose, reset, and open download folder actions
- Data settings:
  - Import JSON
  - Export JSON
  - Display local database path
  - Open the local data folder in the OS file manager
- Maximum browser tabs are clamped from 4 to 30.
- A warning is shown when the maximum browser tab count is above the warning threshold.
- Full sync AJAX prefetch concurrency is clamped from 1 to 5.
- A warning is shown for the fastest sync acceleration option.
- Automatic replay of deferred sync operations defaults to off.
- Maximum active video downloads is clamped from 1 to 3 and defaults to 1.

## Import And Export UX

- JSON import is initiated from Settings.
- The selected JSON file is parsed in the renderer before import confirmation.
- Import target detection uses JSON metadata first, then filename hints.
- The UI still requires a final target collection before calling the data engine.
- JSON export is initiated from Settings.
- The user chooses the collection before export.
- Native save dialog output uses the collection's default filename.
- Canceling the native save dialog returns a canceled result without writing a file.

## Status And Feedback

- The renderer shows toast-style status messages for sync, import, export, navigation, setting updates, errors, and queue replay progress.
- Sync queue replay progress is shown as a fixed progress indicator while outbox operations are being applied.
- AJAX retry and fallback reasons are surfaced through sync progress messages.
- Jable origin fallback is surfaced to the renderer when the app switches from the primary origin to the fallback origin.

## Related Files

- `app/renderer-src/App.vue`
- `app/renderer-src/components/TopBar.vue`
- `app/renderer-src/components/BrowserPanel.vue`
- `app/renderer-src/components/LibraryPanel.vue`
- `app/renderer-src/components/SettingsPanel.vue`
- `app/renderer-src/components/VideoCard.vue`
- `app/renderer-src/components/DownloadRecordCard.vue`
- `app/renderer-src/components/PendingRemoteOperationCard.vue`
- `app/renderer-src/composables/useBrowserBounds.ts`
- `app/renderer-src/composables/useLibraryState.ts`
- `app/renderer-src/composables/usePendingRemoteActions.ts`
- `app/renderer-src/composables/useSyncWorkflow.ts`
- `app/renderer-src/composables/useToastStatus.ts`
- `app/app-contract.ts`
