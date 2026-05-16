# Download Manager Specification

Last verified against implementation: 2026-05-17

This document specifies the current Download List and local video file management behavior.

## Scope

- The feature is a download and file-management workflow, not an in-app video player.
- Downloads are started explicitly by the user from Local Data video cards.
- Downloaded files are opened with the operating system default player.
- Download state is independent from Favourites and Watch Later membership.
- Removing a video from a local collection does not delete a downloaded file.
- Collection JSON import/export does not include download records or downloaded media files.

## FFmpeg Dependency

- Downloads require a locally installed FFmpeg binary.
- Packaged app builds do not bundle FFmpeg.
- Main process detects FFmpeg by running `ffmpeg -version` or by validating a manually selected binary path.
- The FFmpeg status model includes:
  - `detected`
  - `missing`
  - `invalid_path`
  - `unsupported`
- Settings > Downloads shows FFmpeg status, source, path, version, validation error text when relevant, Check Again, Choose FFmpeg, and Use PATH actions.
- Manual FFmpeg paths are persisted through app settings.
- Download start and retry actions call the main-process FFmpeg readiness check before queueing work.
- If FFmpeg is missing or invalid, the download action fails with localized setup guidance and Download List shows a setup-required state.

## Download Root

- The default download root is `<userData>/downloads`.
- Users can choose a custom download root from Settings > Downloads.
- The selected root is persisted through app settings.
- Settings can open the current download root in the OS file manager.
- Download start and retry actions create the selected root if needed, then verify it is a writable directory before queueing work.
- Download output paths are created by main process only; the renderer never submits local file paths for download, open, reveal, or delete operations.
- Current generated MP4 paths use:

```text
<downloadRoot>/<collectionKey>/<sanitized-title>-<url-sha1-prefix>.mp4
```

- Persisted `localPath` values store only the managed-root-relative path:

```text
<collectionKey>/<sanitized-title>-<url-sha1-prefix>.mp4
```

- The data engine rejects absolute, drive-root, traversal, empty-component, and colon-containing persisted file paths.
- Main process resolves persisted relative paths against the current download root before filesystem or shell operations.
- A `.part` sibling file is used while FFmpeg is writing the output. On success it is renamed to the final `.mp4` path.
- Deleting a download verifies that the managed path is inside the current download root before unlinking.

## Persisted Store

- Download records are persisted in the Rust data engine `download_assets` table.
- Main process accesses the store through `app/data-engine.ts`.
- Records are keyed by video URL.
- Local Data rows are already canonicalized by the data engine before normal card downloads are started.
- The store keeps enough metadata for Download List rendering even if the row later disappears from a collection:
  - `videoUrl`
  - `collectionKey`
  - `title`
  - `img`
  - `localPath` as a managed-root-relative file path
  - `state`
  - `progress`
  - `fileSizeBytes`
  - `error`
  - `createdAt`
  - `updatedAt`
  - `completedAt`
- Supported states are:
  - `queued`
  - `downloading`
  - `failed`
  - `ready`
  - `missing`
- `progress` is currently coarse-grained. It is `null` for queued/downloading records and `1` for completed records.
- Startup/listing reconciliation infers runtime-safe state:
  - ready records become `missing` when the file is no longer present.
  - missing records become `ready` again when the file exists.
  - queued/downloading records not present in the active queue or active worker become `failed` with an interrupted-download message.

## Local Data Cards

- Favourites and Watch Later video cards show a compact download action.
- Pending Sync cards do not expose download actions.
- Source cards show a single button state instead of full progress, error text, delete controls, or detailed retry controls.
- Button labels reflect current state:
  - no record: Download
  - `queued`: Queued
  - `downloading`: Downloading
  - `ready`: Downloaded
  - `failed` or `missing`: Retry
- `queued`, `downloading`, and `ready` buttons are disabled on source cards.
- `failed` and `missing` source-card clicks call the retry IPC path.
- Download state is loaded from the global download record list, so the same video URL shows the same state across Favourites and Watch Later.

## Download List

- Local Data includes a global Download List tab.
- The tab is not a Jable collection and is not scoped to the active collection.
- Download List shows persisted records in all supported states:
  - `queued`
  - `downloading`
  - `failed`
  - `ready`
  - `missing`
- Download List supports local search and sorting in the renderer.
- Sort keys are:
  - updated time
  - title
  - state
  - file size
- Rows show:
  - thumbnail
  - title
  - source URL
  - collection label when known
  - state
  - compact progress label
  - file size when known
  - completed timestamp for ready records
  - updated timestamp for other states
  - localized error text when present
- Ready rows expose Open, Reveal, Open Page, and Delete actions.
- Failed and missing rows expose Retry, Open Page, and Delete actions.
- Queued and downloading rows expose Cancel and Open Page actions.
- Delete removes the managed local file when present and removes the persisted download record. It does not modify collection membership or Jable remote state.

## Download Pipeline

- The main process owns all download work.
- The FFmpeg runner is main-owned for MVP and separate from the persisted asset model.
- Future work may move the runner behind a Rust/native boundary if process supervision or queue control needs justify it, but FFmpeg remains the external HLS pipeline.
- Queue concurrency is one active video download at a time.
- Starting a download creates or updates a persisted record as `queued`.
- The active worker marks the record `downloading`.
- The worker fetches the Jable video page using the isolated Jable session cookies.
- HLS playlist extraction is implemented in `app/download-helpers.ts`.
- The extractor supports escaped absolute `.m3u8` URLs and quoted relative `.m3u8` URLs resolved against the video page URL.
- FFmpeg is spawned by main process with:
  - `-headers` containing Referer, User-Agent, and Cookie when available
  - protocol whitelist for HLS over local/http/https/tcp/tls/crypto
  - playlist URL as input
  - `-c copy`
  - `-movflags +faststart`
- FFmpeg is responsible for HLS playlist reading, segment fetching, supported HLS decryption, and MP4 remuxing.
- On success the `.part` file is renamed to the final MP4, file size is recorded, and state becomes `ready`.
- On failure the partial file is removed where possible and state becomes `failed`.
- Download errors are classified into localized messages for:
  - video page HTTP failures
  - missing playlist
  - FFmpeg failure
  - filesystem failure
  - network failure
  - unknown failure
- Active cancel kills the FFmpeg process and marks the record failed with the localized canceled message.
- Queued cancel removes the record from the queue and marks it failed with the localized canceled message.

## Opening Local Files

- The renderer passes only a video URL to main process.
- Main resolves the persisted record and local path from the data engine.
- Open and reveal actions require the record to be `ready` and the file to exist.
- Open uses Electron `shell.openPath(filePath)`.
- Reveal uses Electron `shell.showItemInFolder(filePath)`.
- If open or reveal discovers an unavailable file, main persists `missing` state and notifies the renderer.
- Download completion and failure are surfaced with localized renderer toast messages.
- User-initiated cancellation is suppressed from the generic download-failed toast path.

## Security And Privacy

- Downloads are user initiated.
- The feature uses the existing isolated Jable session partition.
- Download IPC accepts only trusted Jable video page URLs from `https://jable.tv` or `https://fs1.app`, canonicalized to the primary origin before queueing.
- The renderer does not receive unrestricted filesystem browsing rights.
- Renderer-provided paths are not accepted for opening, revealing, deleting, or writing downloads.
- Download error sanitization masks managed download root paths and Jable cookie values before showing messages.
- User-facing download errors should not expose cookies, HLS keys, signed HLS URLs, or full managed local paths.

## Related Files

- `app/download-helpers.ts`
- `app/main.ts`
- `app/preload.ts`
- `app/types/jable.ts`
- `app/settings.ts`
- `app/renderer-src/App.vue`
- `app/renderer-src/components/CollectionTabs.vue`
- `app/renderer-src/components/DownloadRecordCard.vue`
- `app/renderer-src/components/LibraryPanel.vue`
- `app/renderer-src/components/SettingsPanel.vue`
- `app/renderer-src/components/VideoCard.vue`
- `app/renderer-src/composables/useLibraryState.ts`
- `test/node/download-helpers.test.js`
- `test/electron/app-smoke.test.js`
- `test/renderer/components/LibraryPanel.test.ts`
- `test/renderer/components/VideoCard.test.ts`
- `test/renderer/composables/useLibraryState.test.ts`
