# Data And Sync Specification

Last verified against implementation: 2026-05-17

This document specifies local data, search, sync, outbox, and JSON import/export behavior.

## Collections

The app currently supports two collections:

| Key           | Display name | Source path                          |
| ------------- | ------------ | ------------------------------------ |
| `favourites`  | `影片收藏`   | `/my/favourites/videos/`             |
| `watch_later` | `稍後觀看`   | `/my/favourites/videos-watch-later/` |

Collection metadata exists in both TypeScript and Rust and must stay aligned:

- `app/collections.ts`
- `native/local-data-engine/src/collections.rs`

## Data Engine

- The default desktop data engine is the Rust native addon under `native/local-data-engine`.
- The data engine is loaded through `app/data-engine.ts`.
- The database file is named `jable-favourites.sqlite` under Electron `userData`.
- SQLite uses WAL mode.
- Rust data-engine runtime behavior is split by concern: `src/schema.rs` owns migrations and FTS setup, `src/search.rs` owns search tokenization, `src/store.rs` owns local list queries/upserts/resequencing, `src/sync.rs` owns sync and outbox state transitions, `src/resource.rs` owns JSON import/export, `src/payload.rs` owns payload coercion and URL normalization, and `src/lib.rs` keeps the N-API bridge and method dispatch.

## Core Data Model

The local store tracks:

- `videos`: canonical video rows keyed by URL.
- `collections`: supported collection definitions.
- `collection_items`: collection membership, visibility, ordering, and sync timestamps.
- `sync_states`: latest sync completion state per collection.
- `sync_operations`: local and deferred remote operations recorded during sync.
- `video_search`: SQLite FTS5 table for local search.

Important collection item fields:

- `site_order`: official local ordering copied from Jable page order or import order.
- `is_visible`: whether a row is currently visible in the local collection.
- `missing_at`: timestamp for rows hidden by full sync or explicit removal.
- `last_sync_run_id`: sync run that last touched the row.

Important outbox fields:

- `remote_deferred`
- `remote_video_id`
- `remote_fav_type`
- `remote_applied_at`
- `remote_apply_error`
- `remote_apply_state`
- `remote_failed_at`
- `remote_blocked_by`
- `remote_resolved_at`
- `remote_superseded_at`
- `remote_superseded_by_sync_run_id`

## URL Normalization

- Fallback-origin video URLs are canonicalized to `https://jable.tv` before storage.
- Canonicalization prevents duplicate rows when the same video is synced through `fs1.app`.
- Collection URL checks accept both trusted origins.
- Import and sync paths should normalize URLs before comparison.

## Listing And Pagination

- Local lists are loaded through `listVideos`.
- Counts are loaded through `countVideos`.
- Query options must stay aligned between list and count behavior:
  - `collectionKey`
  - `search`
  - `searchMode`
  - `sort`
  - `direction`
  - `includeHidden`
  - `limit`
  - `offset`
- Default renderer page size is 24.
- Default local sort is `site_order` ascending.
- Rows with no `site_order` sort after ordered rows for site-order sorting.

## Search

- Local search uses SQLite FTS5.
- Search text is generated from title and URL.
- Token generation supports CJK text, punctuation-normalized phrase matching, and URL fragments.
- Search modes:
  - `any`: term queries joined with `OR`
  - `all`: term queries joined with `AND`
  - `phrase`: punctuation and spacing are compacted before matching phrase ngrams
- Search index triggers update FTS rows when video title, URL, or generated search text changes.
- Migrations rebuild the FTS index when expected columns, triggers, or generated search text are missing or stale.

## Sync Page Save

- Sync page rows are saved through `saveSyncPage`.
- Each row is normalized before storage.
- A sync page upserts video metadata and collection membership.
- Page save updates `sync_states` as incomplete.
- During an active sync with recorded operations, existing `site_order` can be preserved so local operations do not get overwritten by stale page scans.
- Duplicate add operations discovered later in a full sync can use scraped `site_order`.

## Quick Sync

- Quick sync starts at page 1.
- Quick sync updates scanned rows and saves page progress.
- Quick sync stops after a page where every row is already known.
- Quick sync does not hide unscanned local rows.
- Quick sync is intended for routine incremental updates after an initial full sync.
- Quick sync completion status reports the number of rows scanned in the current sync run.
- Quick sync completion status must not use the final local collection count, because unscanned existing rows remain visible.

## Full Sync

- Full sync starts at page 1.
- Full sync scans through the last reachable page.
- A completed full sync rebuilds visible site order.
- A completed full sync hides currently visible rows not touched by the completed sync run.
- Completed full sync status reports the final visible local row count after sync finalization.
- An incomplete full sync does not hide rows missing from the sync run.
- Full sync can continue in batches through renderer continuation state.
- Sync tabs are locked while sync is active.

## AJAX Full-Sync Acceleration

- Full sync writes page 1 first.
- Remaining pages can be fetched with a bounded AJAX sliding window.
- The configured window size comes from Settings and is clamped from 1 to 5.
- AJAX fetches use timeout, jitter, retry, and backoff.
- Retryable symptoms include timeout, network error, 403, 429, 5xx, and empty responses.
- AJAX pages are validated before writing:
  - active page number matches expected page
  - last page stays stable
  - non-final pages have expected row count
  - no duplicate URLs across prefetched pages
  - first page signature remains stable
- On validation failure or unrecoverable fetch failure, full sync falls back to sequential paging.
- Fallback reasons and retry events are surfaced through sync progress.

## Collection Toggles

- Jable collection add/remove button clicks are observed in `app/webview-preload.ts`.
- Outside active sync, a successful site-side toggle is mirrored into local SQLite through `applyCollectionToggle`.
- During active sync, toggles are recorded as deferred remote operations.
- Deferred remote operations do not alter normal local list visibility until Jable AJAX succeeds.
- The webview overlays pending operation state onto the page so the user sees queued add/remove intent during the active sync.

## Deferred Remote Operation Outbox

- Deferred operations are stored in `sync_operations`.
- Outbox states include `pending`, `applied`, `failed`, `blocked`, `resolved`, and `superseded`.
- Automatic post-sync replay is controlled by `autoReplayDeferredSyncOperations`.
- Automatic replay defaults to off.
- When enabled, replay runs in original operation order.
- Replay stops after the first failed operation.
- Later pending operations are marked `blocked` after an earlier failure.
- Main process applies operations one at a time so queue progress can be reported accurately.
- Applied remote operations are reconciled into local visibility during sync finalization.

## Pending Remote Operation Groups

- Pending remote rows are grouped by `collectionKey + videoUrl`.
- Groups include unresolved `pending`, `failed`, and `blocked` operations.
- Groups do not expose or infer a final intended state.
- Manual Add and Remove prepare the latest operation in the group for retry, send one Jable AJAX operation, then apply local visibility only after success.
- Manual Resolved marks unresolved operations in the group as resolved without changing normal local list visibility.
- A later clean completed full sync supersedes older pending/failed/blocked operations from previous sync runs.
- Operations created during the current sync run remain pending when automatic replay is off.

## JSON Import

- Desktop JSON import requires an explicit target collection.
- Renderer import UX may preselect a target from:
  - `meta.source_path`
  - `meta.source_url`
  - filename hints
- The confirmed `collectionKey` passed to the data engine is the final import target.
- Import accepts desktop paged JSON resources.
- Import accepts legacy userscript paged JSON resources.
- Import accepts `site_order`.
- Import accepts `sort_order` as an alias.
- If no ordering field exists, import falls back to JSON row order.
- If imported metadata is marked completed, import finalizes sync state for that collection.

## JSON Export

- Desktop JSON export uses paged resources.
- Desktop backup ordering field is `site_order`.
- JSON export includes:
  - row data pages
  - source path
  - source URL
  - export timestamp
  - completion state
  - per-page count
  - page count
  - total count
  - last page
  - last scraped page
- File export streams rows to a temporary file in batches.
- File export yields between batches.
- File export atomically renames the temporary file after a complete write.
- Cleanup removes the temporary file after write failure where possible.

## Download Records

- Download records are stored in the Rust data engine `download_assets` table.
- Download records are keyed by video URL and remain independent from `collection_items`.
- `download_assets.file_relative_path` is exposed to the renderer as `localPath` and stores only the selected download-root-relative file path.
- Downloaded files are not included in collection JSON import/export backups.
- Deleting or hiding a collection item does not delete a download record or local downloaded file.
- Explicit Download List delete actions remove the managed download record and local file when present.
- Local Data rows synced through fallback origins are canonicalized before normal collection-card downloads are started, so source-card downloads use canonical local row URLs.

## Related Tests

- `test/node/database.test.js`
- `test/node/data-engine-contract.test.js`
- `native/local-data-engine/src/tests.rs`
- `test/node/sync-utils.test.js`
- `test/node/ipc-guardrails.test.js`
- `test/renderer/composables/useLibraryState.test.ts`
