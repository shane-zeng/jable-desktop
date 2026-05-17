# Download Manager V2 Proposal

Status: accepted, implementation in progress

Created: 2026-05-17

Baseline: `docs/specs/download-manager.md`, last verified against implementation on 2026-05-17.

This document proposes the second version of Download Manager after the MVP download pipeline has shipped. It focuses on product usability, clearer queue control, safer speed tuning, richer error recovery, and future extension points.

## Summary

Download Manager V1 proves the core workflow:

- users can download videos from Local Data cards
- records persist in SQLite `download_assets`
- files are managed under a chosen download root
- Rust downloads HLS keys and segments in parallel
- FFmpeg remuxes the downloaded local HLS media into MP4
- ready files open through the operating system default player
- cancel and retry work for the common path

V2 should keep that architecture and improve the surfaces around it. The priority is not to replace the downloader, add an in-app player, or bundle FFmpeg. The priority is to make the feature easier to understand, easier to recover from, and less visually noisy during real use.

## Goals

- Improve Download List and source-card interaction quality.
- Make queued, active, failed, ready, and missing states easier to scan.
- Add safer queue actions such as retry all failed, clear completed, and cancel queued items.
- Add user-facing download speed modes without exposing low-level downloader internals by default.
- Persist enough attempt metadata to explain failures and support better retry decisions.
- Improve automatic retry behavior for expired or rejected segment URLs.
- Keep the same SQLite-backed `download_assets` model.
- Keep the current Rust segment downloader plus external FFmpeg remux pipeline.
- Support selected-row batch downloads and configurable queue concurrency as established V2 foundations.
- Add true pause/resume for queued and active downloads using resumable segment temp files.
- Preserve the future path for playback-triggered download capture.

## Non-Goals

- No in-app video player in V2.
- No FFmpeg bundling in V2.
- No cloud sync of downloaded files.
- No change to Favourites or Watch Later JSON import/export backup format.
- No automatic whole-collection download by default.
- No attempt to resume partially written MP4 output files. Resume is segment-level: completed HLS segment files may be reused, but FFmpeg remux starts from scratch.
- No attempt to reuse Electron or Chromium HTTP cache as the canonical downloaded media store.

## Product Direction

V2 should treat Download Manager as a first-class local file manager inside Local Data.

Recommended priorities:

1. UI polish and interaction consistency.
2. Failure recovery and clearer error display.
3. Download settings for speed/stability.
4. Pause/resume with safe app-shutdown recovery.
5. Playback-triggered download as a research-backed enhancement, not an assumed cache reuse shortcut.

## User Experience

### Source Cards

Source cards in Favourites and Watch Later should remain compact.

V2 should refine the card download button so it is easy to recognize without making every video card visually busy:

- Use icon-first actions with localized tooltip text where practical.
- Keep detailed progress, error text, delete, and reveal actions out of source cards.
- Show only the minimum state signal:
  - not downloaded
  - queued
  - downloading
  - downloaded
  - paused
  - retry available
  - missing file
- For ready records, clicking the card download action may open the local file if that interaction is clearly labeled.
- For failed or missing records, clicking the card download action should retry.
- If a video belongs to both Favourites and Watch Later, both cards continue to reflect the same global download record.

### Download List

Download List should become the primary operation surface.

V2 should improve the list with:

- clearer state grouping or filters:
  - All
  - Active
  - Paused
  - Failed
  - Ready
  - Missing
- a compact active queue section when downloads are running
- clearer primary actions per state
- less intrusive toasts for routine transitions
- explicit retry, cancel, open, reveal, open page, and delete affordances
- explicit pause/resume for queued and active downloads
- bulk actions where safe:
  - Retry Failed
  - Cancel Queued
  - Clear Completed Records
  - Delete Selected Local Files

Bulk delete must remain explicit and destructive. It should require a confirmation dialog and must not remove videos from Favourites, Watch Later, or Jable.

### Error Details

Failed rows should show a concise localized message first, with expandable technical details only when useful.

The normal row should avoid exposing long FFmpeg output, signed URLs, local absolute paths, cookies, or HLS keys.

Suggested display:

- short reason:
  - FFmpeg not installed
  - Playlist not found
  - Segment request rejected
  - Segment download failed
  - FFmpeg remux failed
  - File system error
  - Download canceled
- retry hint:
  - Check FFmpeg
  - Retry after a moment
  - Try Stable speed mode
  - Check download folder access
- optional Details disclosure with sanitized technical text

### Settings

Settings > Downloads should keep the existing FFmpeg and download-root controls, then add a simple speed/stability setting.

Recommended first UI:

| Mode     | Behavior                                                                 |
| -------- | ------------------------------------------------------------------------ |
| Stable   | Lower max segment concurrency, fewer CDN rejection risks.                |
| Balanced | Current default behavior.                                                |
| Fast     | Higher max segment concurrency, may be less stable on some CDN sessions. |

Implementation can map these modes to Rust downloader options instead of exposing raw worker counts:

| Mode     | Suggested min | Suggested max |
| -------- | ------------- | ------------- |
| Stable   | 4             | 8             |
| Balanced | 8             | 32            |
| Fast     | 16            | 32            |

A future Advanced section may expose custom min/max concurrency, but V2 should not require it.

## Data Model

Keep the current SQLite `download_assets` table as the source of truth.

V2 may add attempt metadata if needed:

```sql
ALTER TABLE download_assets ADD COLUMN failure_phase TEXT;
ALTER TABLE download_assets ADD COLUMN failure_code TEXT;
ALTER TABLE download_assets ADD COLUMN attempt_count INTEGER;
ALTER TABLE download_assets ADD COLUMN last_started_at TEXT;
ALTER TABLE download_assets ADD COLUMN last_error_at TEXT;
```

Suggested meanings:

| Field             | Meaning                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `failure_phase`   | `ffmpeg_check`, `video_page`, `playlist`, `segments`, `remux`, `file`. |
| `failure_code`    | Stable app-owned code such as `segment_http_428` or `ffmpeg_exit`.     |
| `attempt_count`   | Number of started attempts for this asset.                             |
| `last_started_at` | Timestamp for the most recent attempt start.                           |
| `last_error_at`   | Timestamp for the most recent failure.                                 |

These fields should support UI and retry policy. They should not store secrets, signed URLs, cookies, HLS keys, or full absolute paths.

Download speed mode belongs in app settings, not in each asset record, unless future behavior needs per-download overrides.

## Download Pipeline

V2 should keep the current pipeline:

1. main process owns queue orchestration, Jable cookies/headers, cancellation, and FFmpeg process supervision
2. Rust native download engine owns HLS key and segment HTTP fetching
3. FFmpeg remains an external binary responsible for MP4 remuxing and supported local HLS AES-128 decryption

Recommended V2 pipeline improvements:

- Retry with lower concurrency on CDN-sensitive HTTP statuses remains required.
- If segment URLs appear expired or rejected after concurrency fallback, main should refresh the video page and playlist once, then retry unfinished work with the refreshed playlist when segment identity is compatible.
- Retry policy should distinguish:
  - transient HTTP errors
  - concurrency-sensitive rejection
  - playlist extraction failure
  - unsupported playlist/key format
  - remux failure
  - local filesystem failure
- Cancellation should stay responsive in both Rust segment download and FFmpeg remux phases.
- Runtime progress should stay runtime-only except for persisted download state transitions such as paused/resumed.
- Pausing an active download aborts the Rust segment downloader or kills the FFmpeg remux process, marks the record `paused`, removes the unreliable `.mp4.part` file, and preserves the `.segments` directory.
- Resuming a paused download refreshes the video page and playlist, validates the refreshed playlist against the preserved segment manifest when available, reuses already completed segment files, downloads missing segments, then runs FFmpeg remux from the local playlist.
- If preserved segments are incompatible with the refreshed playlist, the app may discard the preserved `.segments` directory and restart the segment phase rather than producing a corrupt MP4.
- Cancelling remains destructive for in-progress work: it discards resumable temp segments and marks the record canceled/failed.
- Graceful app quit with active or queued downloads prompts the user to pause downloads before closing. If the user confirms, active and queued records become `paused`.
- Ungraceful app exit or crash is recovered on next startup by converting persisted `queued` or `downloading` records that are no longer owned by an active runtime into `paused`.

## Pause And Resume

V2 includes true pause/resume for managed downloads.

The supported model is segment-level resume:

- Completed segment files are kept under the managed `.segments` working directory.
- Incomplete segment `.part` files are not trusted and may be overwritten on resume.
- MP4 `.part` files are not resumed. If pause happens during FFmpeg remux, the `.mp4.part` file is removed and remux restarts after resume.
- Resume requires the download record to keep its managed `localPath`; changing the download root may make old working files unavailable.
- Resume is user-initiated. The app should not automatically resume paused downloads on startup.

States:

- `queued`: waiting to start.
- `downloading`: active Rust segment download or FFmpeg remux.
- `paused`: stopped intentionally or recovered from app shutdown; resumable when the working files and source playlist are compatible.
- `failed`: terminal failed/canceled state unless the user retries from scratch.
- `ready`: final MP4 exists.
- `missing`: final MP4 was expected but is no longer present.

Close behavior:

- If the user tries to close or quit while downloads are queued or active, show a confirmation dialog.
- The primary action pauses downloads and closes the app.
- The secondary action returns to the app.
- After a confirmed graceful close, active/queued downloads are persisted as `paused`.
- After a crash/force quit, next startup reconciles orphaned `queued`/`downloading` records to `paused`.

## Batch Downloads

Selected-row batch download is part of the V2 foundation and should not automatically download an entire collection by default.

Recommended safe scope:

- Users can select visible Local Data rows and enqueue selected videos.
- Already ready, queued, or downloading videos are skipped.
- Failed and missing videos can be included as retries.
- Queue concurrency is controlled by the existing user setting for maximum active video downloads.
- The UI clearly shows how many videos will be enqueued.

Whole-collection download remains a later enhancement because it needs stronger guardrails around storage usage, accidental queue size, CDN load, and cancellation.

## Playback-Triggered Download

The idea: when the user is already playing a video in the embedded browser, the app may know the active playlist URL and request headers. V2 should investigate whether that can reduce duplicate setup work for downloads.

Important constraint:

- Browser playback already downloads media segments into Chromium internals, but those cached bytes are not a stable, app-managed MP4 file.
- V2 should not assume the app can safely reuse Chromium cache as the final downloaded asset.

Recommended direction:

- Add an optional setting later, such as "Offer download for currently playing video".
- Detect the currently playing trusted Jable video page and observed HLS playlist URL.
- Use the observed playlist URL and headers to enqueue a normal managed download.
- If future research proves safe segment cache reuse, add it as a separate optimization behind clear validation.

This keeps the feature understandable: playback can help discover the media source, but Download Manager still owns the managed local file.

## Security And Privacy

- Renderer still never receives unrestricted filesystem access.
- Renderer still never submits local paths for download, open, reveal, or delete operations.
- Error details must continue masking:
  - Jable cookies
  - signed playlist or segment URLs
  - HLS keys
  - full managed local absolute paths
- Batch actions must not mutate Jable remote collection state.
- Playback-triggered download must only apply to trusted Jable video URLs and the existing isolated Jable session.

## Implementation Milestones

1. UI audit and interaction cleanup
   - tighten source-card download button states
   - improve Download List row density, action placement, and error presentation
   - reduce noisy toasts for routine state changes

2. Download List filtering and bulk-safe actions
   - add status filters or grouping
   - add retry failed and cancel queued
   - optionally add selected-row actions

3. Download settings speed modes
   - add persisted `downloadSpeedMode`
   - map Stable/Balanced/Fast to Rust min/max concurrency
   - keep Balanced as the default

4. Pause/resume and shutdown recovery
   - add `paused` asset state
   - add pause/resume IPC and renderer actions
   - preserve `.segments` working directories for paused downloads
   - validate segment manifest on resume
   - prompt and pause downloads during graceful quit
   - reconcile orphaned queued/downloading records to paused on startup

5. Failure metadata and retry hints
   - add stable failure phase/code if needed
   - update localized error display
   - add tests for sanitized details

6. Playlist refresh retry
   - refresh page/playlist once after compatible segment rejection or expiration
   - retry unfinished segments only when safe
   - preserve cancellation behavior

7. Playback-triggered download research spike
   - inspect observed media request availability
   - prove whether playlist/header reuse is enough
   - explicitly defer Chromium cache byte reuse unless validated

## Test Plan

- Rust tests for speed mode mapping and concurrency fallback behavior.
- Node tests for new settings normalization and data-engine migration fields.
- Node tests for error classification and sanitization.
- Renderer tests for Download List filters, bulk actions, and source-card state display.
- Electron tests for FFmpeg missing, queue/pause/resume/cancel/retry, graceful quit recovery, open/reveal, and download-root safety.
- Manual tests on macOS and Windows for:
  - Stable/Balanced/Fast modes
  - pause active download and resume without restarting from zero
  - graceful quit with active downloads
  - force quit/crash recovery to paused state
  - failed retry
  - cancel active download
  - retry failed batch
  - delete local file
  - missing-file reconciliation

## Decisions

- V2 includes selected-row batch download.
- V2 includes configurable maximum active video downloads.
- V2 includes segment-level pause/resume.
- Resume reuses completed HLS segment files but does not resume `.mp4.part` output.
- Graceful app close pauses active and queued downloads after confirmation.

## Open Questions

- Should speed mode be only Stable/Balanced/Fast, or should an Advanced custom min/max UI be included?
- Should ready source-card click open the local file, or should source cards remain state-only with opening reserved for Download List?
- Should playback-triggered download be part of V2 delivery or only a research spike for V3?
