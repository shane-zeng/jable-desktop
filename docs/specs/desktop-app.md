# Desktop App Specification

Last verified against implementation: 2026-05-16

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
- The tab rail supports a persisted compact mode through app settings.
- Tab rail width is a renderer-local `localStorage` preference.
- Tab width can be reset from Settings.
- Compact mode reveals a floating tab rail when the pointer enters the compact trigger area.
- Locked sync tabs cannot be closed from the tab UI.
- Browser tabs expose media state indicators for muted, audible, media playing, picture-in-picture, and discarded state.

## Local Data View

- Local Data has collection tabs for `favourites` and `watch_later`.
- A global Pending Sync tab appears when unresolved pending remote operation groups exist.
- Each collection tab supports:
  - Quick Sync
  - Full Sync
  - Search text
  - Search mode: `any`, `all`, `phrase`
  - Sort key: `site_order`, `title`, `views`, `likes`
  - Sort direction: `asc`, `desc`
  - Pagination
- Page size is 24 rows.
- Video cards show thumbnail, optional hover preview, title, views, likes, and last synced time.
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

## Settings View

- General settings:
  - UI locale
- Browser settings:
  - Maximum browser tabs
  - Compact browser tabs
  - Reset tab rail width
- Sync settings:
  - Full sync acceleration: safe, standard, fast
  - Automatic post-sync replay of deferred sync operations
- Data settings:
  - Import JSON
  - Export JSON
  - Display local database path
- Maximum browser tabs are clamped from 4 to 30.
- A warning is shown when the maximum browser tab count is above the warning threshold.
- Full sync AJAX window size is clamped from 1 to 5.
- A warning is shown for the fastest sync acceleration option.
- Automatic replay of deferred sync operations defaults to off.

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
- `app/renderer-src/components/PendingRemoteOperationCard.vue`
- `app/renderer-src/composables/useBrowserBounds.ts`
- `app/renderer-src/composables/useLibraryState.ts`
- `app/renderer-src/composables/usePendingRemoteActions.ts`
- `app/renderer-src/composables/useSyncWorkflow.ts`
- `app/renderer-src/composables/useToastStatus.ts`
- `app/app-contract.ts`
