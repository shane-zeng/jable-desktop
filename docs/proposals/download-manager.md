# Download Manager Proposal

Status: proposed, not implemented

Created: 2026-05-16

This document defines the planned Download Manager feature. It is intentionally a proposal, not an implementation-backed specification.

## Summary

The app should support user-initiated local downloads for videos that already exist in Local Data. Favourites and Watch Later video cards get a download action. A separate Download List shows videos with managed local files. Clicking a downloaded item opens the local video file with the user's operating-system default player.

This feature is a download and file-management feature, not an in-app offline player.

## Goals

- Add manual download actions to Local Data rows from both supported collections:
  - `favourites`
  - `watch_later`
- Store downloaded media under an app-managed local download root.
- Keep download state independent from collection membership.
- Allow the same downloaded asset to be reused when a video appears in both collections.
- Show completed local downloads in a Download List tab inside Local Data.
- Open ready downloaded files through the OS default player.
- Allow deleting a local downloaded file without removing the video from Favourites, Watch Later, or Jable.
- Persist download state across app restarts.
- Keep all downloader work in the Electron main process or a main-owned worker, not in the Vue renderer.

## Non-Goals

- No in-app video player in the first implementation.
- No automatic bulk download of an entire collection in the first implementation.
- No pause-and-resume support in the first implementation. Failed or interrupted downloads may be retried from the beginning.
- No scheduling, speed-limit, or active-download concurrency settings UI in the first implementation. The downloader should use conservative fixed defaults.
- No subtitle, chapter, transcoding, or quality-selection UI in the first implementation.
- No cloud sync of downloaded files.
- No changes to JSON import/export backup format for Favourites or Watch Later.

## Product Language

- UI feature name: Download List.
- User action: Download.
- Persisted media concept: download asset.
- Do not call this feature Offline Playback unless an in-app player is added later.

## Resolved Product Decisions

- Users should be able to choose the managed download root. The default may stay under Electron `userData`, but Settings should allow selecting a different root before or after downloads exist.
- Downloaded files must remain until the user explicitly deletes them through Download List actions. Removing a video from local collection data must not delete the downloaded local file.
- MVP Download List does not need independent search or sort controls, but the data model and APIs should not block adding Download List search/sort later.

## User Experience

### Local Data Cards

- Video cards in Favourites and Watch Later show a download action.
- The action is available only for normal local video rows, not Pending Sync cards.
- Source collection cards should keep download UI compact. They should show a single icon/button state, not full progress details, error text, retry controls, and delete controls.
- The action reflects the current download state for that video:
  - `not_downloaded`
  - `queued`
  - `downloading`
  - `ready`
  - `failed`
  - `missing`
- Starting a download is always explicit per video.
- If the same video is visible in both collections, both cards show the same download state.
- A ready state offers an open action instead of starting a duplicate download.
- A failed state offers retry.
- A missing state means the database has a ready asset record but the file is no longer present on disk.
- Detailed queue, progress, retry, and delete interactions belong in Download List to avoid making Favourites and Watch Later visually noisy.

### Download List Tab

- Local Data adds a Download List tab.
- The tab is a global local-assets view, not a third Jable collection.
- The tab is the central download-manager surface and should show all persisted download asset states:
  - `queued`
  - `downloading`
  - `failed`
  - `ready`
  - `missing`
- If a previously ready file is missing, the row remains visible with `missing` state until the user deletes the record or retries.
- The empty state says that no videos have been added to the Download List.
- Download List rows show:
  - thumbnail
  - title
  - source URL
  - downloaded file size when known
  - downloaded-at timestamp
  - local file state
- Queued and downloading rows show compact progress state.
- Failed rows expose retry and delete actions.
- Ready rows expose open, reveal, and delete actions.
- Missing rows expose retry and delete actions.
- Clicking a ready Download List row opens the local file with the OS default player.
- Context actions should include:
  - Open Local File
  - Open Jable Page
  - Reveal In Folder
  - Delete Local File

### Opening A Downloaded File

- The renderer never opens arbitrary paths directly.
- The renderer sends an asset identifier or canonical video URL to main.
- Main resolves the managed file path from persisted state.
- Main verifies that the resolved path is inside the app-managed download root.
- Main verifies that the file exists.
- Main calls Electron `shell.openPath(filePath)`.
- If the OS returns an error, the app shows a localized error message.
- If the file is missing, main marks the asset `missing` and notifies the renderer.

## Storage

### Download Root

- The default download root is under Electron `userData`, for example:

```text
<userData>/downloads/videos/<video-path-key>/<safe-filename>.mp4
```

- Users should be able to choose a different managed download root from Settings.
- The selected root is owned by the app for download-manager files.
- When a custom root is selected, the app should create and use an app-specific child folder inside that root unless the user explicitly selects an existing app-managed download folder.
- The selected root must be persisted in app settings.
- The selected root must be created if needed, then checked for write access and path safety before queueing downloads.
- The renderer never receives unrestricted filesystem browsing rights.
- Persisted file references should be relative to the managed download root.
- Absolute paths may be derived at runtime only inside main-process code.

### File Naming

- The canonical video URL is the stable asset key.
- The folder name should be derived from the canonical video path key, not only from title text.
- The display filename may include a sanitized title or video code for user readability.
- Filename generation must avoid path traversal, reserved names, and platform-invalid characters.
- URL fallback origins must canonicalize to the primary Jable origin before asset lookup.

## Data Model

Add a persisted download asset model to the local data engine.

Suggested table:

```sql
CREATE TABLE download_assets (
  video_url TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  file_relative_path TEXT,
  format TEXT,
  title TEXT,
  img TEXT,
  preview TEXT,
  size_bytes INTEGER,
  duration_seconds REAL,
  error TEXT,
  downloaded_at TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Status values:

| Status        | Meaning                                                        |
| ------------- | -------------------------------------------------------------- |
| `queued`      | The user requested a download and it is waiting for a worker.  |
| `downloading` | A worker is actively downloading or remuxing the asset.        |
| `ready`       | A local file exists and can be opened.                         |
| `failed`      | The last download attempt failed.                              |
| `missing`     | The asset was ready before, but the file is no longer present. |
| `deleting`    | A delete operation is in progress.                             |

Notes:

- `download_assets` is independent of `collection_items`.
- `download_assets` should keep enough title and thumbnail metadata to render Download List rows even if the corresponding `videos` row is later removed from local collection data.
- `file_relative_path` must reject absolute paths, drive-root paths, traversal components, empty path components, and colon-containing components.
- Deleting a download asset must not alter collection visibility or remote Jable state.
- Deleting local collection data or a canonical video row must not delete the local downloaded file. Local file deletion requires an explicit Download List delete action.
- Import/export of collection JSON remains unchanged.
- MVP Download List can omit independent search/sort controls. Future Download List search can reuse `videos.search_text` when a matching `videos` row exists and fall back to stored asset metadata when it does not. No separate FTS table is required for MVP.
- The Rust data engine exposes download asset APIs through the shared `app/data-engine.ts` boundary.

## IPC Contract

Exact TypeScript names can change during implementation, but the feature needs these renderer-facing capabilities:

- `getFfmpegStatus()`
  - Returns detected FFmpeg readiness, version text when available, source (`path` or `manual`), and any validation error.
- `refreshFfmpegStatus()`
  - Re-runs FFmpeg detection after the user installs or changes FFmpeg.
- `setFfmpegPath(filePath)`
  - Stores and validates a manually selected FFmpeg binary path.
- `getDownloadStates(videoUrls)`
  - Returns current download state for each canonical video URL shown on the current Local Data page.
- `startVideoDownload(payload)`
  - Starts or queues a download for a canonical video URL.
  - Payload includes `videoUrl` and may include current row metadata for snapshotting title and thumbnail.
- `listDownloads(options)`
  - Lists Download List rows.
- `countDownloads(options)`
  - Counts Download List rows for pagination.
- `retryVideoDownload(videoUrl)`
  - Retries a failed or missing asset.
- `openDownloadedVideo(videoUrl)`
  - Opens a ready managed local file with the OS default player.
- `revealDownloadedVideo(videoUrl)`
  - Reveals a ready managed local file in Finder or File Explorer.
- `deleteDownloadedVideo(videoUrl)`
  - Deletes the managed file and clears or marks the asset record.

Main-to-renderer events:

- `download-state-changed`
- `download-progress`
- `download-error`

Validation requirements:

- Video URLs must pass existing trusted Jable video URL normalization.
- Unknown asset identifiers must fail with explicit errors.
- Renderer-provided paths are never accepted.
- Opening and deleting local files must verify path containment under the managed download root.

## Download Pipeline

The first full implementation should output a single local MP4 file because this best supports OS default-player opening.

Recommended pipeline:

1. User clicks Download from a Local Data video card.
2. Renderer calls main through the preload API.
3. Main creates or updates a `download_assets` row as `queued`.
4. A main-owned download worker loads the Jable video page using the isolated Jable session.
5. The worker extracts the HLS `.m3u8` URL from page HTML or observed media requests.
6. The worker invokes the validated external FFmpeg binary with the playlist URL, output path, and required request headers.
7. FFmpeg reads the playlist, fetches HLS segments, handles supported HLS decryption, and remuxes the stream into a single `.mp4`.
8. The worker writes to a `.part` file under the managed download root.
9. The worker atomically moves the completed file into the final managed location.
10. The asset row becomes `ready`.
11. Temporary files are cleaned up where possible.

Unsupported playlist conditions should fail clearly:

- unsupported encryption or DRM/key formats
- playlist reload loops that never produce VOD segments
- FFmpeg network, playlist, segment, decryption, or remux failures

## FFmpeg Strategy

Opening through the OS default player strongly favors producing MP4 files. That requires a remux step.

MVP decision:

- MVP requires user-installed FFmpeg.
- Packaged builds do not bundle FFmpeg in the first release.
- Use FFmpeg for HLS playlist reading, segment fetching, supported HLS decryption, and MP4 remuxing.
- Detect an installed `ffmpeg` binary at runtime.
- If FFmpeg is missing, block download start actions and show a clear dependency error.
- Do not silently fall back to storing raw HLS segments for default-player opening.

Runtime ownership decision:

- MVP invokes the external FFmpeg binary from the Electron main process or a main-owned worker.
- Rust owns download asset persistence through the local data engine.
- Rust should not reimplement HLS segment downloading, HLS decryption, or remuxing for MVP.
- Future work may move the FFmpeg process runner behind a Rust/native boundary if process supervision, queue control, or crash isolation needs justify it. That future runner would still invoke FFmpeg rather than replace FFmpeg.
- Keep the renderer IPC and `download_assets` model independent from the runner implementation so the runner can be swapped later without changing the product contract.

Because MVP relies on user-installed FFmpeg, the app must provide an explicit FFmpeg readiness UX:

- Settings shows FFmpeg status:
  - detected
  - missing
  - invalid path
  - unsupported or failed version check
- Download List shows a clear setup-required state when FFmpeg is missing.
- Source collection download buttons should not fail silently when FFmpeg is missing.
- The UI must provide a Check Again action so users can install FFmpeg and ask the app to re-detect it without restarting.
- The UI should provide a way to manually choose the `ffmpeg` binary path for users whose install is not on `PATH`.
- The selected manual binary path should be persisted in app settings.
- The app should validate the selected binary by running `ffmpeg -version` from main process and checking that the command exits successfully.
- If validation succeeds, subsequent downloads use the selected binary path instead of searching `PATH`.
- If validation fails, the UI keeps the download feature blocked and shows a localized error.
- Documentation must include separate Windows and macOS installation instructions.
- Documentation must explain what the user should do inside the app after installing FFmpeg: open Settings, use Check Again, or choose the binary path manually.

Future bundled FFmpeg enhancement:

- Bundling FFmpeg may be reconsidered after MVP, but it is not part of the first release.
- If bundling FFmpeg is pursued later, document binary source, license obligations, package size impact, macOS signing/notarization impact, and Windows packaging impact before implementation.

## Queue And Retry Rules

- MVP queue concurrency is one active video download at a time.
- Segment downloads may use bounded internal concurrency.
- Segment concurrency should default conservatively to reduce site load.
- Failed segment requests should retry with timeout and backoff.
- App shutdown during a download marks the active asset as `failed` or `queued` on next startup; exact behavior must be deterministic.
- A retry may clean the old temporary directory and restart the download from scratch.
- Pause/resume with partial segment reuse is a future enhancement.

## Future Batch Download Extension

The MVP intentionally excludes automatic whole-collection downloads, but the first implementation should not block that future path.

Future batch download support may add APIs such as `startCollectionDownload(collectionKey, options)` or `startVideoDownloads(videoUrls)`. Possible batch sources include:

- All visible rows in Favourites.
- All visible rows in Watch Later.
- Current search/filter results.
- User-selected videos from a local list.

Batch downloads must reuse the same `download_assets` model. They should not introduce a separate asset table or duplicate local files for the same canonical video URL.

Future batch behavior should follow these rules:

- Already `ready` assets are skipped.
- Existing `queued` or `downloading` assets are not duplicated.
- Failed or missing assets can be retried only when the batch request explicitly allows retries.
- Batch queue rows may be tracked separately from asset rows if the UI needs batch-level progress, cancellation, or history.
- Canceling a batch should stop pending or active jobs, but must not delete completed local files unless the user explicitly asks to delete them.
- Collection sync changes must not automatically delete downloaded assets.
- Active download concurrency may become configurable later, but the default should stay conservative.

## Future Playback Segment Reuse Extension

Playback segment reuse is a future research enhancement, not part of the MVP default behavior.

The user-facing idea is: if the embedded browser is already playing a Jable HLS video, the browser is already fetching playlist and segment requests. A future implementation may try to reuse those playback network responses to build the managed local MP4, instead of starting a second full download of the same video.

This is different from simply enqueueing a normal download when playback starts. The simple auto-enqueue approach is easier, but it still downloads video data a second time. Playback segment reuse should be considered only if the implementation can reliably capture or tee playback segment responses.

Important constraints:

- Chromium media playback does not expose already-buffered segment bytes to renderer JavaScript or Electron preload code in a stable public API.
- Electron `session.webRequest` can observe media request URLs and headers, but it does not expose response bodies that can be saved directly.
- Chromium's HTTP cache is not a reliable product surface for reconstructing complete videos. It may be partial, evicted, encrypted, compressed, or unavailable for some media requests.
- If the player uses native media loading instead of page-level `fetch`/XHR, monkey-patching `fetch` cannot capture the segment bytes.

Viable future implementation paths may include:

- A local proxy or custom request pipeline that the player uses for HLS requests, allowing the app to tee response bodies to disk while still feeding playback.
- A custom in-app player pipeline where the app owns HLS fetching and can write each fetched segment before passing it to playback.
- A page-level interception path only if Jable's player uses interceptable `fetch`/XHR for playlists and segments; this must be verified against the live player and treated as site-fragile.

If playback segment reuse is added later, Settings may expose a `Reuse playback downloads` or `Save while playing` option under Downloads. The option must default off.

Playback segment reuse should follow these rules:

- It only applies to trusted Jable video detail pages matching `/videos/.../`.
- It must not trigger from hover previews in Favourites, Watch Later, Download List, or Pending Sync cards.
- It should wait for a short playback threshold, such as 5-10 seconds, before starting capture to avoid accidental saves from brief clicks.
- It must reuse the same `download_assets` identity model as manual downloads.
- Existing `queued`, `downloading`, or `ready` assets must not be duplicated.
- Missing FFmpeg must block final MP4 assembly and surface the same setup-required message used by manual downloads.
- Captured segment state must be represented separately from the final asset row if partial capture can occur.
- The setting should be persisted with app settings, not with individual browser tabs.
- The implementation must avoid logging cookies, HLS URLs, signed tokens, HLS keys, segment URLs, or full local paths.

## Future Download Control Extension

The MVP may retry failed or interrupted downloads from the beginning, but the implementation should not prevent future pause/resume support.

Future pause/resume support may add segment-level progress tracking, including:

- playlist fingerprint or content hash
- total segment count
- downloaded segment indexes
- decrypted segment indexes
- key metadata needed to resume safely
- temporary directory state validation

The first implementation does not need a separate job table if it would add unnecessary complexity. However, naming, IPC payloads, and state transitions should avoid assuming that every download starts immediately and runs to completion in one uninterrupted process.

Future scheduling and download-control support may add queue/job fields such as:

- `scheduled_at`
- `priority`
- `max_bytes_per_second`
- `segment_concurrency`
- `paused_at`
- `started_at`
- `completed_at`
- `canceled_at`

These future controls must remain separate from the core asset identity. `download_assets` should continue to represent the local file state for a canonical video URL, while future queue/job records may represent one or more attempts to produce or repair that local file.

## Security And Privacy

- MVP downloads are user-initiated only.
- Any future playback auto download must be explicitly opt-in and triggered by user playback, never enabled by default.
- The feature must use the existing isolated Jable session and must not persist credentials.
- Do not log cookies, authorization headers, HLS keys, or full local paths in normal logs.
- Do not accept arbitrary remote URLs as download sources.
- Do not expose arbitrary local file paths to the renderer.
- Deleting a downloaded file must be constrained to the managed download root.
- The feature should surface that users are responsible for following site terms and applicable law.

## Localization

All visible copy must be added to:

- `app/i18n/locales/zh-TW.json`
- `app/i18n/locales/en-US.json`
- `app/i18n/locales/ja-JP.json`

Expected copy groups:

- Download action labels and aria labels.
- Download state labels.
- Download List tab label.
- Empty state.
- Open, reveal, retry, and delete actions.
- FFmpeg status, setup-required, check-again, and choose-binary labels.
- FFmpeg missing error.
- Download failure and file missing status messages.

## Testing Requirements

Data engine:

- Migration creates `download_assets`.
- Asset state transitions are deterministic.
- Download assets are keyed by canonical video URL.
- Persisted file paths are validated as managed-root-relative paths.
- Deleting a collection item or local video row does not delete the downloaded file or erase the asset record unless the user explicitly deletes the download asset.
- Rust native engine tests cover migration and state transitions.

IPC and main process:

- IPC normalizers reject invalid URLs and unknown payload shapes.
- FFmpeg detection handles missing binaries, invalid manual paths, and successful `ffmpeg -version` validation.
- `openDownloadedVideo` rejects missing, failed, and path-escaped assets.
- `deleteDownloadedVideo` cannot delete files outside the managed root.
- Download progress events serialize stable payloads.

Renderer:

- Favourites and Watch Later cards show the correct download action state.
- Download state is shared across collections for the same video URL.
- Download List renders queued, downloading, failed, ready, and missing assets.
- Clicking a ready Download List item calls the open IPC method.
- Failed and missing states expose retry/delete actions.

Electron smoke:

- Use a test userData directory.
- Seed a managed local file and asset row.
- Verify the open IPC handler reaches the shell boundary with the resolved managed path. The OS player itself can be mocked or guarded.

Manual validation:

- macOS default player open behavior.
- Windows default player open behavior.
- Missing FFmpeg behavior, including Settings status, Download List setup-required state, Check Again, and manual binary path selection.
- Failed download retry.
- Deleting local file from Download List.
- Re-syncing Favourites and Watch Later does not remove local download assets.

## Implementation Milestones

1. Add FFmpeg detection, Settings status, Check Again, manual binary path selection, and Windows/macOS install docs.
2. Add data model, IPC types, and runtime normalizers.
3. Add Download List UI and per-card download state using seeded/manual asset records.
4. Add OS default-player opening and reveal/delete actions.
5. Add HLS playlist extraction and FFmpeg HLS/remux runner.
6. Confirm FFmpeg headers against real Jable playback/download behavior and refine failure messages.
7. Add progress/status events and retry handling.
8. Add automated tests and update implementation-backed specs/user guides after the feature ships.
