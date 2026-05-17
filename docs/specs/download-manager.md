# Download Manager Specification

Last verified against implementation: 2026-05-17

This document specifies the current Download List and local video file management behavior.

## Scope

- The feature is a download and file-management workflow, not an in-app video player.
- Downloads are started explicitly by the user from Local Data video cards, either one card at a time or by selecting specific visible collection cards and downloading the selected set.
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
- Current generated MP4 paths use a single shared download folder and do not create collection-specific subfolders:

```text
<downloadRoot>/<sanitized-title>.mp4
```

- When the generated path is already used by another download record or existing local file, main process appends a numeric suffix such as ` (2)` before `.mp4`.
- Persisted `localPath` values store only the managed-root-relative path:

```text
<sanitized-title>.mp4
```

- Legacy records with nested relative paths remain resolvable as long as they stay inside the current download root.
- The data engine rejects absolute, drive-root, traversal, empty-component, and colon-containing persisted file paths.
- Main process resolves persisted relative paths against the current download root before filesystem or shell operations.
- A `.part` sibling file is used while FFmpeg is writing the output. On success it is renamed to the final `.mp4` path.
- Deleting a download verifies that the managed path is inside the current download root before unlinking.

## Persisted Store

- Download records are persisted in the Rust data engine `download_assets` table.
- Main process accesses the store through `app/data/data-engine.ts`.
- Records are keyed by video URL.
- Local Data rows are already canonicalized by the data engine before normal card downloads are started.
- The store keeps enough metadata for Download List rendering even if the row later disappears from a collection:
  - `videoUrl`
  - `collectionKeys` as the current visible local collections containing the video
  - `title`
  - `img`
  - `preview`
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
  - `paused`
  - `failed`
  - `ready`
  - `missing`
- Persisted `progress` is coarse-grained. It is `null` for queued/downloading/paused records and `1` for completed records.
- While a download is active, the main process may add runtime-only `downloadedBytes` and `downloadSpeedBytesPerSecond` fields to `downloads-changed` payloads. These values are not persisted and are cleared when the active worker finishes.
- Runtime speed is sampled at most once per second from completed downloaded segment bytes. It is a smoothed recent-throughput indicator, not a per-segment instantaneous peak.
- Runtime downloaded bytes count only complete segment files that can be reused by resume. Partial `.part` files, local playlists, resume manifests, and key/control files are excluded from the user-facing downloaded-size number.
- Startup/listing reconciliation infers runtime-safe state:
  - ready records become `missing` when the file is no longer present.
  - missing records become `ready` again when the file exists.
  - queued/downloading records not present in the active queue or active worker become `paused` so crash/force-quit recovery can resume instead of failing the download.

## Local Data Cards

- Favourites and Watch Later video cards show a compact download action.
- Favourites and Watch Later video cards also expose a checkbox for selected batch download.
- Batch download is based on explicit user selection, not the whole current page or the Download List contents.
- The Select All action applies only to visible source cards that can start, resume, or retry a download.
- Select All excludes `queued`, `downloading`, and `ready` source cards.
- Selected batch download can enqueue normal downloads and retry selected failed or missing downloads.
- Selected batch download resumes selected paused downloads.
- Selection is cleared when the user changes collection, tab, page, search, sort, or search mode.
- Pending Sync cards do not expose download actions.
- Source cards show a single button state instead of full progress, error text, delete controls, or detailed retry controls.
- Button labels reflect current state:
  - no record: Download
  - `queued`: Queued
  - `downloading`: Downloading
  - `paused`: Resume
  - `ready`: Downloaded
  - `failed` or `missing`: Retry
- `queued`, `downloading`, and `ready` buttons are disabled on source cards.
- `paused` source-card clicks call the resume IPC path.
- `failed` and `missing` source-card clicks call the retry IPC path.
- Download state is loaded from the global download record list, so the same video URL shows the same state across Favourites and Watch Later.
- When the same video is visible in both Favourites and Watch Later, both source cards share the same download record.

## Download List

- Local Data includes a global Download List tab.
- The tab is not a Jable collection and is not scoped to the active collection.
- Download List shows persisted records in all supported states:
  - `queued`
  - `downloading`
  - `paused`
  - `failed`
  - `ready`
  - `missing`
- Download List supports local search, state filtering, and sorting in the renderer.
- The state filter is persisted in app settings and survives app restart.
- Supported state filters are:
  - all states
  - ready/downloading records
  - records needing attention (`failed` and `missing`)
- Sort keys are:
  - updated time
  - title
  - state
  - file size
- Rows are shown as media cards aligned with the Favourites and Watch Later card layout.
- Download records should fall back to the local video metadata table for title, thumbnail, and preview when persisted download metadata is missing.
- Rows show:
  - thumbnail and hover preview when available
  - title
  - current local collection labels when the video is visible in one or more collections; no collection label is shown when the video is not currently visible in Favourites or Watch Later
  - state
  - compact progress/status bar
  - active downloaded size and speed when available
  - file size when known
  - paused hint for paused records
  - concise user-readable error reason for failed or missing records
  - completed timestamp for ready records
  - updated timestamp for other states
- Raw technical error details are not shown on the card.
- Download List cards do not display the managed local filename or relative path directly.
- Ready rows open through thumbnail/title and expose Reveal, Open Page, and Delete actions.
- Failed and missing rows expose Retry, Open Page, and Delete actions.
- Queued and downloading rows expose Pause, Cancel, and Open Page actions.
- Paused rows expose Resume, Open Page, and Delete actions.
- Delete removes the managed local file when present and removes the persisted download record. It does not modify collection membership or Jable remote state.

## Download Pipeline

- The main process owns queue orchestration, Jable cookie/header collection, cancellation, and FFmpeg remux orchestration.
- The Rust native download engine under `native/download-engine` owns HLS key and segment HTTP fetching.
- The FFmpeg runner remains main-owned and separate from the persisted asset model.
- Future work may move more process supervision behind a Rust/native boundary if queue control or crash isolation needs justify it, but FFmpeg remains the external remux pipeline.
- Video download queue concurrency is controlled by Settings > Downloads.
- The default maximum active video downloads is 1.
- The user-facing maximum active video downloads value is clamped from 1 to 8.
- Each active video download still uses Rust segment-level adaptive concurrency internally, so increasing active video downloads multiplies network and CPU usage.
- Starting a download creates or updates a persisted record as `queued`.
- The active worker marks the record `downloading`.
- The worker fetches the Jable video page using the isolated Jable session cookies.
- HLS playlist extraction is implemented in `app/download/download-helpers.ts`.
- The extractor supports escaped absolute `.m3u8` URLs and quoted relative `.m3u8` URLs resolved against the video page URL.
- The HLS parser supports master playlist variant selection, media playlist segments, `#EXTINF` durations, `#EXT-X-TARGETDURATION`, and AES-128 key metadata.
- The active worker delegates HLS key and segment download to the Rust native download engine before FFmpeg remuxing:
  - Rust samples up to 3 segment downloads before the parallel phase
  - segment request concurrency is selected from 8 to 32 workers based on sampled single-worker throughput
  - if a parallel batch receives concurrency-sensitive CDN errors such as HTTP 403, 428, 429, 503, or 504, Rust backs off and retries unfinished segments with lower concurrency
  - the same `reqwest` client and connection pool are reused across sampled and parallel segment requests
  - 3 retries per key or segment request
  - User-Agent is always sent; Referer is the video page URL; Cookie is sent when the Electron Jable session has cookies for the origin
  - main process polls the temporary segment directory to update runtime `downloadedBytes` from completed segment files only
  - runtime `downloadSpeedBytesPerSecond` is sampled at most once per second from total downloaded bytes to avoid inflated spikes when multiple parallel segment requests finish together
- Downloaded segments and keys are written by Rust under a temporary `.segments` sibling directory inside the managed download root.
- Rust writes a local `playlist.m3u8` pointing at the downloaded segment and key files.
- FFmpeg is spawned by main process for local remuxing with:
  - `-progress pipe:1` so the app can parse runtime download byte updates without mixing them into FFmpeg error output
  - `-allowed_extensions ALL`
  - protocol whitelist for local files and HLS AES decryption: `file,crypto`
  - local temporary playlist path as input
  - `-c copy`
  - `-bsf:a aac_adtstoasc`
  - `-movflags +faststart`
  - `-f mp4` because the temporary output file uses a `.part` suffix
- FFmpeg is responsible for remuxing downloaded HLS media into MP4 and handling supported local HLS AES-128 decryption through the local playlist/key files.
- On success the `.part` file is renamed to the final MP4, file size is recorded, temporary segment files are removed, and state becomes `ready`.
- On failure the partial file and temporary segment files are removed where possible and state becomes `failed`.
- On pause the unreliable `.mp4.part` output is removed, the `.segments` working directory is preserved, and state becomes `paused`.
- When the user confirms pause-and-close during App quit, the App waits for active download workers to finish their paused-state cleanup before closing the native data engine.
- Resume is segment-level. It refreshes the video page and playlist, validates the refreshed playlist by reusable media structure rather than signed CDN URL path, reuses completed segment files, downloads missing segments, and remuxes a fresh `.mp4.part`.
- Resume compatibility is based on segment order/count, segment extension, duration, and key method/IV. Signed playlist, segment, and key URLs may change between pause and resume and are not used as stable identity.
- If preserved segments are incompatible with the refreshed playlist, the app discards the `.segments` working directory and restarts the segment phase instead of producing a corrupt MP4.
- Download errors are classified into localized messages for:
  - video page HTTP failures
  - missing playlist
  - unsupported playlist/key format
  - segment/key download failure
  - FFmpeg failure
  - filesystem failure
  - network failure
  - unknown failure
- Active cancel asks the Rust download engine to cancel in-flight segment requests, kills the FFmpeg process when it is running, and marks the record failed with the localized canceled message.
- Queued cancel removes the record from the queue and marks it failed with the localized canceled message.
- Cancel is destructive for in-progress work and removes preserved segment temp files where possible.
- Graceful app close or quit with active or queued downloads prompts the user to pause downloads before closing.
- Force quit, crash, or ungraceful exit is recovered on the next listing by converting orphaned queued/downloading records to `paused`.

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

- `app/download/download-helpers.ts`
- `app/main.ts`
- `app/preload.ts`
- `app/types/jable.ts`
- `app/main-process/settings.ts`
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
