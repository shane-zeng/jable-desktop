# Download Manager Specification

Last verified against implementation: 2026-05-19

This document specifies the current Download List and local video file management behavior.

## Scope

- The feature is a download, file-management, and managed-file playback workflow. It does not download media implicitly from playback unless the user enables Settings > Downloads > Auto-download while playing.
- Downloads are started explicitly by the user from Local Data video cards, either one card at a time or by selecting specific visible collection cards and downloading the selected set.
- Playback-triggered download is opt-in and defaults off. When enabled, Jable HLS playback is proxied through the app, playback and background completion share one managed segment cache, and the video is added to the Download List only after the page video actually starts playing. The app avoids launching a second media-segment download for the same playback; after all media segments are cached, the normal resume/remux path assembles the MP4 from local segment files.
- When a Jable browser tab opens a video URL with an existing ready managed download, the app may replace the page's video element source with the local managed MP4.
- Downloaded files are opened with the operating system default player.
- Download state is independent from Favourites and Watch Later membership.
- Removing a video from a local collection does not delete a downloaded file.
- Collection JSON import/export does not include download records or downloaded media files.

## Local Playback In Browser Tabs

- Local playback applies only to managed MP4 files represented by `ready` download records.
- Browser pages request playback through a video URL only. Main process canonicalizes the video URL, verifies the download record is still `ready`, verifies the file still exists, and verifies the resolved path remains inside the current download root.
- Browser pages also send the current page's Chinese-subtitle-update notice state. Local playback is exposed only when that state matches the notice state stored on the ready download record; a mismatch silently leaves the official page media in place.
- Ready records whose files are missing are reconciled to `missing` and are not exposed for local playback.
- The browser page receives a short-lived `jable-local-video://` source URL, never a local filesystem path.
- The custom local playback protocol streams the managed MP4 with `Accept-Ranges: bytes` support so the page video element can seek.
- The webview preload automatically replaces the current Jable video page's primary `<video>` source when local playback is available. If this happens after remote playback has already started, the preload preserves the current time and resumes playback only when the video was already playing. If replacement fails or no local playback source is available, the original Jable page playback remains available. If the active local playback file is deleted while the video page is open, the preload reloads the page instead of trying to partially restore the Jable player runtime.
- When a ready managed MP4 has a generated local timeline preview cache, the same local playback protocol also serves a short-lived thumbnail VTT and JPEG thumbnails to the browser page.
- Local timeline preview thumbnails are sampled from the managed MP4 at 60-second intervals, using 213x120 JPEG frames to match Jable's observed preview density.
- Timeline preview generation runs as a background follow-up after the MP4 becomes ready, and local playback remains available when preview generation is pending, missing, or failed.
- Deleting a download removes its generated local timeline preview cache together with the managed media file and working files.

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
- Generated filenames use the video title after removing the Jable page SEO suffix such as `- Jable.TV ...`; the renderer-provided title is cleaned again in main before `videos` or `download_assets` writes.
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
  - `sourcePageChineseSubtitleNotice`
  - `sourcePageSubtitleNoticeText`
  - `downloadSource`, either `normal` for user-formalized downloads or `playback_auto` for playback-triggered records not yet explicitly resumed, retried, or enqueued by the user
  - `localPath` as a managed-root-relative file path
  - `state`
  - `progress`
  - `playbackAutoResumeBlocked` as an internal persisted guard for manual normal-downloader pauses after playback capture handoff
  - `fileSizeBytes`
  - `error`
  - `failurePhase`
  - `failureCode`
  - `attemptCount`
  - `lastStartedAt`
  - `lastErrorAt`
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
- Persisted `progress` is coarse-grained. It is normally `null` for queued/downloading/paused records and `1` for completed records. Playback-triggered foreground capture also keeps persisted progress `null`; active capture/background completion progress is runtime-only so segment progress does not continually rewrite the download row timestamp.
- While a download is active, the main process may add runtime-only `downloadedBytes` and `downloadSpeedBytesPerSecond` fields to `downloads-changed` payloads. These values are not persisted and are cleared when the active worker finishes.
- Runtime speed is sampled at most once per second from completed downloaded segment bytes. It is a smoothed recent-throughput indicator, not a per-segment instantaneous peak.
- Runtime downloaded bytes count only complete segment files that can be reused by resume. Partial `.part` files, local playlists, resume manifests, and key/control files are excluded from the user-facing downloaded-size number.
- When a worker enters `downloading`, `attemptCount` is incremented, `lastStartedAt` is updated, and stale failure fields are cleared.
- When a worker fails, main persists stable failure metadata: `failurePhase`, `failureCode`, and `lastErrorAt`.
- Ready and paused records do not retain stale failure metadata.
- Startup/listing reconciliation infers runtime-safe state:
  - ready records become `missing` when the file is no longer present.
  - missing records become `ready` again when the file exists.
  - queued/downloading records not present in the active queue or active worker become `paused` so crash/force-quit recovery can resume instead of failing the download.

## Playback-Triggered Download

- Settings > Downloads > Auto-download while playing is off by default.
- Turning the setting off stops automatic playback ownership only. Existing `playback_auto` records are kept, but queued playback-background jobs, active playback-background workers, and foreground capture writes are paused without setting `playbackAutoResumeBlocked`; already saved reusable segments are preserved. Existing `normal` downloads are not affected by this setting change.
- After the setting is turned off, stale playback-background queue entries must not start later when a download slot opens. Re-enabling the setting does not automatically resume old `playback_auto` cards; they resume only after a fresh user-initiated video-page playback trigger, or after the user explicitly starts the formal Resume, Retry, or Download path.
- With the setting on, the webview preload may proxy Jable page `.m3u8` requests through app-owned loopback token URLs. The proxy is allowed to serve page preload traffic before playback starts, but it must not create a download record or write segment files until the preload observes a real `<video>` `play` or `playing` event for the current trusted Jable video URL after a recent user gesture in that page load. Restored tabs, page reloads, and site/script autoplay must not start or resume playback-triggered downloads by themselves.
- When playback starts, main prepares a managed capture plan from the playlist, writes or refreshes the `videos` row first, then writes the `download_assets` row with `downloadSource = playback_auto`. The capture metadata includes the current page title, thumbnail/preview URLs, views, likes, and source-page Chinese subtitle notice when the preload can read them.
- With auto-download enabled, playback capture creates the Download List record as `queued`. Foreground player segment requests may save reusable segment files while the record is queued, but they do not persist per-segment progress. Background completion is queued behind the same maximum active video download setting as normal downloads.
- When a video download slot opens, the active playback-background worker marks the record `downloading`, resolves the current source page, records the source-page Chinese subtitle notice, runs the existing Node HLS proxy prefetch to fill missing media segment files, then continues through Rust resume/download and FFmpeg remux under the same active slot. Player segment requests and background prefetch share the same in-flight fetch/file; the same media segment must not be fetched twice by playback capture and background completion.
- Pause stops queued or active playback-capture background completion and stops future capture writes for the current page load. It keeps already captured reusable segments and leaves the record `paused`; in-flight segment streams are allowed to settle without crashing the main process. Continued page playback may still use Jable remote media without being saved. Reloading the video page starts a new page-load token, but a fresh capture is created only after the user explicitly starts playback again in that reloaded page. This playback-background pause does not set `playbackAutoResumeBlocked`; only pausing the normal downloader after an explicit resume/retry/enqueue handoff sets that guard. Resume moves the record through the normal queued resume/remux path and clears the internal playback auto-resume block guard.
- If a playback-triggered record is paused, then resumed/retried/enqueued from the Download List or a video card, ownership moves to the normal queued downloader and `downloadSource` becomes `normal`. A later video-page refresh and playback does not create another playback-capture job while that record is `queued`, `downloading`, or `ready`; the page may continue normal Jable playback while the app-owned downloader finishes in the background. If the user pauses that normal queued or active downloader, the record stays `paused` with playback auto-resume blocked across app restarts, so refreshed playback uses normal Jable HLS until the user explicitly resumes, retries, or enqueues the download again.
- Any existing `normal` download record is treated as user-formalized ownership. Playback-triggered capture must not retry, replace, or restart it while it is `paused`, `failed`, `missing`, or canceled; the user must use Resume, Retry, or Download actions to start that formal download path again.
- Cancel stops playback-capture background completion, stops future capture writes for the current page load, removes working segment files where possible, and leaves the record `failed` with the localized canceled message. Reloading the video page starts a new page-load token, so playback can create a fresh capture again. Retry clears suppression and uses the normal queued download path.
- Delete stops playback-capture background completion, stops future capture writes for the current page load, removes managed media/working files and the download record, and suppresses recreating that record from the still-open playback token. Reloading the video page starts a new page-load token, so playback can create a fresh capture again.
- After playback-background prefetch or foreground playback has filled reusable media segment files, the same active worker reuses compatible local segments and produces the final MP4 without re-fetching those media segments. Rust may still fetch missing keys or missing/incompatible segments before writing the local playlist used by FFmpeg.

## Local Data Cards

- Favourites and Watch Later video cards show a compact download action.
- Favourites and Watch Later video cards also expose a checkbox for selected batch download.
- Batch download is based on explicit user selection, not the whole current page or the Download List contents.
- The Select All action applies only to visible source cards that can start, resume, or retry a download.
- Select All excludes `queued`, `downloading`, and `ready` source cards.
- Collection tabs can filter to not downloaded rows. This filter includes rows with no download record, `paused`, `failed`, and `missing` records, and excludes `queued`, `downloading`, and `ready` records.
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
- Download List supports local search, multi-select state filtering, and sorting in the renderer.
- The selected state filters are persisted in app settings and survive app restart.
- Supported state filters are:
  - all states
  - ready
  - downloading
  - queued
  - paused
  - failed
  - missing
- `all states` is exclusive. Selecting any specific filter removes `all states`; clearing every specific filter falls back to `all states`.
- Multiple specific filters use OR semantics. For example, `downloading` plus `failed` shows downloading and failed records.
- Legacy persisted single-filter values are upgraded into the new filter array. Legacy `active` maps to `downloading` plus `queued`; legacy values `ready_downloading` and `needs_attention` normalize to `all states` so app upgrades do not hide records.
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
  - a `中文字幕` badge below the collection labels when `sourcePageChineseSubtitleNotice` is true
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
- The Download List toolbar exposes Retry Failed, Queue Actions, and Delete Selected.
- Queue Actions contains Pause All, Resume All, and Cancel Queued with per-action counts and disabled states.
- Retry Failed is global to all download records and queues only `failed` and `missing` records. It does not duplicate `ready`, `queued`, or `downloading` records.
- Pause All is global to `queued` and `downloading` records and moves them to `paused` through the segment-preserving pause path.
- Resume All is global to `paused` records and reuses the same segment-level resume path as single-card Resume.
- Cancel Queued is global to `queued` records and uses the same semantics as single queued cancel: the record becomes `failed` with the localized canceled message and ready MP4 files are not deleted.
- Download List cards show selection checkboxes only for `ready`, `paused`, `failed`, and `missing` records.
- Download List cards may render `playback_auto` records with a distinct border treatment. When a user action changes a card from `playback_auto` to `normal`, the card plays a short transition animation and then returns to the normal card treatment.
- Delete Selected applies only to the currently visible selected eligible records. It asks for confirmation once, deletes managed files when present, removes records, and cleans safe working files. It does not modify Favourites, Watch Later, or Jable remote state.
- Error Log is a hidden diagnostics modal for `failed` and `missing` records. It is intentionally not shown as a toolbar button; it opens only from the Download List with `Ctrl/Cmd+Shift+E` or the `D`, `L`, `E` key sequence within 2 seconds.
- Error Log defaults to the most recent 100 records sorted by `lastErrorAt`, then `updatedAt`, then `createdAt`, with an explicit Show All control when more records exist.
- Error Log shows title, video URL, state, short reason, failure phase/code, attempt count, last started time, and last error time.
- Error Log detail follows the same sanitization rules as download errors: signed remote URLs and the managed download root are masked; cookies, HLS keys, signed segment URLs, and full local paths are not stored or shown.

## Download Pipeline

- The main process owns queue orchestration, Jable cookie/header collection, cancellation, and FFmpeg remux orchestration.
- The Rust native download engine under `native/download-engine` owns HLS key and segment HTTP fetching.
- The FFmpeg runner remains main-owned and separate from the persisted asset model.
- Future work may move more process supervision behind a Rust/native boundary if queue control or crash isolation needs justify it, but FFmpeg remains the external remux pipeline.
- Video download queue concurrency is controlled by Settings > Downloads.
- The default maximum active video downloads is 1.
- The user-facing maximum active video downloads value is clamped from 1 to 3.
- Download speed mode is also controlled by Settings > Downloads and is persisted as `downloadSpeedMode`.
- Speed mode controls segment-level concurrency per active video download:
  - Stable: 4 minimum workers, 8 maximum workers
  - Balanced: 8 minimum workers, 32 maximum workers
  - Fast: 16 minimum workers, 32 maximum workers
- Balanced is the default and preserves the previous 8/32 segment concurrency envelope.
- Maximum active video downloads remains a separate setting for how many videos can run at once. It is not mixed with segment speed mode.
- Each active video download still uses Rust segment-level adaptive concurrency within the selected speed-mode envelope, so increasing active video downloads multiplies network and CPU usage.
- Starting a download creates or updates a persisted record as `queued`.
- The active worker marks the record `downloading`.
- Playback-triggered background completion uses the same video queue and active slot limit as normal downloads; after the source page and subtitle notice are resolved, it gates the existing Node HLS proxy prefetch before the Rust resume/remux phase so playback capture and background completion can share already fetched media segment files.
- The worker fetches the Jable video page using the isolated Jable session cookies.
- The worker records whether the source page contains `<h5 class="desc h6-md">` text with `中文字幕版`; this is stored as `sourcePageChineseSubtitleNotice` plus the exact normalized notice text.
- HLS playlist extraction is implemented in `app/download/download-helpers.ts`.
- The extractor supports escaped absolute `.m3u8` URLs and quoted relative `.m3u8` URLs resolved against the video page URL.
- The HLS parser supports master playlist variant selection, media playlist segments, `#EXTINF` durations, `#EXT-X-TARGETDURATION`, and AES-128 key metadata.
- The active worker delegates HLS key and segment download to the Rust native download engine before FFmpeg remuxing:
  - Rust samples up to 3 segment downloads before the parallel phase
  - segment request concurrency is selected inside the current speed-mode min/max envelope based on sampled single-worker throughput
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
- If segment download fails with HTTP 403, 428, 429, 503, 504, or a compatible CDN rejection pattern, main refreshes the video page and playlist once before final failure.
- Refreshed playlist retry is allowed only when the existing resume manifest matches or the segment structure can be safely reused. If refresh fails or the refreshed playlist is incompatible, the original segment failure remains the final failure metadata.
- Pause or cancel requests are honored before and after the refresh retry attempt.
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
- `app/download/native-download-engine.ts`
- `app/main.ts`
- `app/main-process/download-manager.ts`
- `app/main-process/ipc-handlers.ts`
- `app/preload.ts`
- `app/types/jable.ts`
- `app/main-process/settings.ts`
- `native/download-engine/`
- `native/local-data-engine/src/downloads.rs`
- `native/local-data-engine/src/schema.rs`
- `app/renderer-src/App.vue`
- `app/renderer-src/components/CollectionTabs.vue`
- `app/renderer-src/components/DownloadRecordCard.vue`
- `app/renderer-src/components/LibraryPanel.vue`
- `app/renderer-src/components/SettingsPanel.vue`
- `app/renderer-src/components/VideoCard.vue`
- `app/renderer-src/composables/useLibraryState.ts`
- `test/node/data-engine-contract.test.js`
- `test/node/download-manager.test.js`
- `test/node/download-helpers.test.js`
- `test/node/ipc-guardrails.test.js`
- `native/download-engine/src/planning.rs`
- `native/download-engine/src/playlist.rs`
- `native/local-data-engine/src/tests.rs`
- `test/renderer/components/LibraryPanel.test.ts`
- `test/renderer/components/SettingsPanel.test.ts`
- `test/renderer/components/VideoCard.test.ts`
- `test/renderer/composables/useLibraryState.test.ts`
