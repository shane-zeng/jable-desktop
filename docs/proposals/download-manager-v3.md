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
- a research path for playback-triggered download discovery

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

- Add clearer state filters or grouping:
  - All
  - Active
  - Paused
  - Failed
  - Ready
  - Missing
- Add a compact active queue section when downloads are running.
- Keep source cards compact; detailed progress, errors, bulk actions, and cleanup controls stay in Download List.
- Reduce routine transition toasts when Download List is already visible.
- Decide whether ready source-card clicks should open the local file or remain state-only with opening reserved for Download List.

## Bulk Actions

Safe bulk actions should be available from Download List, not source cards.

Recommended actions:

- Retry Failed
- Cancel Queued
- Clear Completed Records
- Delete Selected Local Files

Rules:

- Bulk delete must require confirmation.
- Bulk delete must not remove videos from Favourites, Watch Later, or remote Jable state.
- Clear Completed Records should remove ready records from Download List. If it also deletes local files, the UI must say that explicitly; otherwise it should only clear records for files already removed or intentionally leave files in place. This behavior needs product confirmation before implementation.
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
- Persisted `deleting` state for delete-in-progress, which is currently not used.
- Direct source URL display on Download List cards, which is currently represented by an Open Page action.

## Implementation Milestones

1. Download List state scanning
   - add finer state filters or grouping
   - optionally add compact active queue section
   - keep persisted filter behavior aligned with settings

2. Bulk actions
   - add Retry Failed
   - add Cancel Queued
   - decide and implement Clear Completed Records semantics
   - design Delete Selected Local Files with confirmation

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

6. Playback-triggered download research
   - inspect observed media request availability
   - determine whether playlist/header reuse is enough
   - keep Chromium cache byte reuse deferred unless proven safe

## Test Plan

- Rust tests for speed mode mapping and concurrency fallback behavior.
- Node tests for settings normalization and any new migration fields.
- Node tests for failure classification, stable failure codes, and sanitization.
- Renderer tests for Download List filters/grouping, bulk actions, error details, and source-card state behavior.
- Electron tests for graceful quit with active downloads, pause/resume/cancel/retry, open/reveal, and download-root safety.
- Manual tests on macOS and Windows for:
  - Stable/Balanced/Fast modes
  - Retry Failed
  - Cancel Queued
  - Clear Completed Records
  - Delete Selected Local Files
  - failed retry after segment URL rejection
  - playback-triggered download research observations

## Open Questions

- Should Clear Completed Records delete files, only remove records for missing files, or be replaced with a differently named action?
- Should speed mode include only Stable/Balanced/Fast, or also Advanced custom min/max controls?
- Should ready source-card click open the local file, or should opening remain reserved for Download List?
- Should playback-triggered download be part of V3 delivery or only a research spike for a later version?
