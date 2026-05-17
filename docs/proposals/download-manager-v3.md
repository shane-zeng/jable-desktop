# Download Manager V3 Proposal

Status: draft, not finalized

Created: 2026-05-17

Baseline: `docs/specs/download-manager.md`, last verified against implementation on 2026-05-17.

This document collects the remaining Download Manager work that was not completed in V1/V2. Implemented behavior belongs in `docs/specs/download-manager.md`; this proposal should only describe future product and engineering intent.

## Summary

Download Manager now supports managed MP4 downloads, SQLite-backed download records, selected-row batch downloads, configurable active video download count, Rust parallel segment downloads, FFmpeg remuxing, Download List UI, pause/resume, and graceful shutdown recovery.

V3 should focus on the remaining management and recovery features:

- clearer Download List queue scanning
- safe bulk actions
- user-facing speed/stability modes
- structured failure metadata
- better retry decisions after expired or rejected playlist/segment URLs
- error details that stay understandable and sanitized

## Goals

- Make Download List easier to scan when records span active, paused, failed, ready, and missing states.
- Add safe bulk actions for common cleanup and recovery work.
- Add simple download speed modes without exposing low-level Rust downloader internals by default.
- Persist enough attempt metadata to explain failures and support future retry policy.
- Improve retry recovery when signed playlist or segment URLs expire.
- Keep user-facing errors concise while preserving sanitized technical details on demand.
- Keep the current architecture: main-process orchestration, Rust HLS key/segment fetching, and external FFmpeg remuxing.
- Preserve explicit user control. No automatic whole-collection download should be enabled by default.

## Non-Goals

- No in-app video player.
- No FFmpeg bundling.
- No cloud sync of downloaded files.
- No changes to Favourites or Watch Later JSON import/export backup format.
- No Chromium HTTP cache reuse as the canonical downloaded media store.
- No automatic whole-collection download by default.
- No resume of partially written MP4 output files. Resume remains segment-level.

## Current Baseline

The following behavior is already implemented and should not be re-specified here except when V3 changes it:

- Download records persist in SQLite `download_assets`.
- Download files are stored under a user-selectable managed root.
- File paths are stored relative to the managed root.
- Downloaded assets are independent from Favourites and Watch Later membership.
- Download List shows managed download records with search, state filter, and sort controls.
- Local Data cards expose compact per-video download actions.
- Users can select visible Local Data rows and enqueue selected downloads.
- Settings exposes maximum active video downloads.
- Rust downloads HLS keys and segments with sampled adaptive concurrency and connection reuse.
- FFmpeg remuxes local HLS media into MP4.
- Pause/resume preserves reusable completed segment files.
- Graceful quit pauses queued/active downloads after confirmation.
- Crash or force-quit recovery reconciles orphaned queued/downloading records to `paused`.

## Download List UX

V3 should improve scanning and routine operations without making each card visually noisy.

Potential improvements:

- Add persisted multi-select state filters:
  - All
  - Ready
  - Downloading
  - Queued
  - Paused
  - Failed
  - Missing
- `All` is exclusive. Multiple specific filters use OR semantics and survive app restart.
- Add a compact active queue section when downloads are running.
- Keep source cards compact; detailed progress, errors, bulk actions, and cleanup controls stay in Download List.
- Reduce routine transition toasts when Download List is already visible.
- Decide whether ready source-card clicks should open the local file or remain state-only with opening reserved for Download List.

## Bulk Actions

Safe bulk actions should be available from Download List, not source cards.

Recommended actions:

- Retry Failed
- Queue Actions
  - Pause All
  - Resume All
  - Cancel Queued
- Delete Selected Downloads

Rules:

- Bulk delete must require confirmation.
- Bulk delete must not remove videos from Favourites, Watch Later, or remote Jable state.
- Pause All applies to queued and downloading records and preserves resumable segment work when possible.
- Resume All applies to paused records and uses the same segment-level resume path as single-card Resume.
- Cancel Queued should not delete completed local files.
- Retry Failed should not duplicate existing ready, queued, or downloading assets.

## Speed Modes

V3 should add a user-facing speed/stability setting in Settings > Downloads.

Recommended first UI:

| Mode     | Behavior                                                             |
| -------- | -------------------------------------------------------------------- |
| Stable   | Lower segment concurrency, fewer CDN rejection risks.                |
| Balanced | Current default behavior.                                            |
| Fast     | Higher initial concurrency, may be less stable on some CDN sessions. |

Suggested mapping:

| Mode     | Segment min | Segment max |
| -------- | ----------- | ----------- |
| Stable   | 4           | 8           |
| Balanced | 8           | 32          |
| Fast     | 16          | 32          |

Open decision:

- Whether V3 should include only Stable/Balanced/Fast, or also an Advanced custom min/max UI.

## Failure Metadata

V3 may extend `download_assets` with structured attempt fields:

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

Rules:

- Do not store cookies, signed URLs, HLS keys, or absolute local paths.
- Stable codes should support UI labels and retry decisions.
- Raw external command output remains sanitized before display.

## Error Details UX

Failed rows should show a short localized reason on the card and expose details only on demand.

Suggested short reasons:

- FFmpeg not installed
- Playlist not found
- Segment request rejected
- Segment download failed
- FFmpeg remux failed
- File system error
- Download canceled

Suggested details behavior:

- A details modal or disclosure shows sanitized technical text.
- Technical details must mask cookies, signed playlist/segment URLs, HLS keys, and managed absolute paths.
- Details should be useful for troubleshooting but not dominate the normal card layout.

## Playlist Refresh Retry

V3 should improve recovery when signed playlist or segment URLs expire or are rejected.

Recommended behavior:

- Rust keeps concurrency fallback for CDN-sensitive statuses such as HTTP 403, 428, 429, 503, and 504.
- If concurrency fallback still fails with a compatible segment rejection or expiration pattern, main process may refresh the video page and playlist once.
- After refresh, retry unfinished segment work only when the refreshed playlist is compatible with preserved local segment structure.
- Cancellation must stay responsive during refresh and retry.
- The retry path must not duplicate completed local segments or corrupt resumable state.

## Playback-Triggered Download Research

Playback-triggered download remains a research item.

Recommended direction:

- Investigate whether the embedded browser can reliably expose the currently playing trusted Jable video page and observed HLS playlist URL.
- If reliable, offer an opt-in setting such as "Offer download for currently playing video".
- The setting must default off.
- Playback can help discover the media source, but Download Manager still owns the managed local file.
- Do not assume Chromium cache bytes can be reused as the final downloaded asset.

Explicit constraints:

- Trigger only on trusted Jable video detail pages.
- Do not trigger from hover previews.
- Do not duplicate existing ready, queued, or downloading assets.
- Missing FFmpeg blocks final MP4 assembly with the same setup-required behavior as manual downloads.
- Do not log cookies, signed tokens, HLS keys, segment URLs, or full local paths.

## Carry-Over Cleanup

Older proposals mentioned some behaviors that are not currently implemented exactly as written. V3 should either drop or explicitly re-decide them:

- Dedicated `getDownloadStates(videoUrls)` / `countDownloads(options)` IPC methods versus the current `listDownloads()` plus renderer filtering.
- Separate `download-state-changed`, `download-progress`, and `download-error` events versus the current consolidated `downloads-changed`.
- Download row context menu actions versus the current in-card buttons.
- Direct source URL display on Download List cards, which is currently represented by an Open Page action.

## Implementation Milestones

1. Download List state scanning
   - add finalized multi-select state filters
   - optionally add compact active queue section
   - keep persisted filter behavior aligned with settings

2. Bulk actions
   - add Retry Failed
   - add Queue Actions menu
   - add Pause All
   - add Resume All
   - add Cancel Queued
   - design Delete Selected Downloads with confirmation

3. Speed modes
   - add persisted `downloadSpeedMode`
   - map Stable/Balanced/Fast to Rust min/max segment concurrency
   - keep Balanced as default
   - add tests for settings normalization and Rust request options

4. Failure metadata and error details
   - add stable failure phase/code if needed
   - persist attempt timestamps/counts if needed
   - add localized retry hints
   - add sanitized details modal/disclosure

5. Playlist refresh retry
   - classify compatible expiration/rejection failures
   - refresh video page and playlist once
   - retry unfinished segment work only when compatible

6. Carry-over cleanup
   - confirm rejected IPC/event/context-menu/source-URL behaviors stay out of V3

## Test Plan

- Rust tests for speed mode mapping and concurrency fallback behavior.
- Node tests for settings normalization and any new migration fields.
- Node tests for failure classification, stable failure codes, and sanitization.
- Renderer tests for Download List filters/grouping, bulk actions, error details, and source-card state behavior.
- Electron tests for graceful quit with active downloads, pause/resume/cancel/retry, Pause All, Resume All, Cancel Queued, open/reveal, and download-root safety.
- Manual tests on macOS and Windows for:
  - Stable/Balanced/Fast modes
  - Retry Failed
  - Pause All
  - Resume All
  - Cancel Queued
  - Delete Selected Downloads
  - failed retry after segment URL rejection

## Resolved Decisions

- Clear Completed Records is not part of V3.
- Speed mode is limited to Stable, Balanced, and Fast.
- Ready source-card clicks remain state-only; opening local files stays reserved for Download List.
- Playback-triggered download is future research, not V3 delivery.
