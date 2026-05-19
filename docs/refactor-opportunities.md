# Refactor Opportunities

This file tracks no-spec-change optimization work so future maintenance can continue from the known backlog instead of repeating a full project structure audit.

## Scope Rule

These refactors must not change documented behavior, IPC contracts, sync semantics, JSON shapes, renderer UI behavior, or userscript output.

Before implementing a candidate:

- Check the relevant `docs/specs/` file and nearby tests.
- Verify the current code path because this backlog may lag behind implementation.
- Keep changes small enough that behavior can be validated with focused tests.
- Prefer local helpers and direct code over broad abstractions unless the extracted logic has clear domain meaning, branching complexity, or repeated use.

## Completed Batches

- Rust data-engine no-search list/count query optimization.
  `native/local-data-engine/src/store.rs` pushes simple visible-list count and pagination into SQL while keeping search behavior aligned with `listVideos` and `countVideos`.
- Rust download asset membership batching.
  `native/local-data-engine/src/downloads.rs` avoids per-record collection membership queries when listing download assets.
- Rust resource import flattening cleanup.
  `native/local-data-engine/src/resource.rs` avoids repeated resource flattening during import.
- Download Manager pure helper extraction.
  Download error classification and local playback range handling are split out of `app/main-process/download-manager.ts` while preserving the existing manager API and IPC surface.
- Renderer download action/display extraction.
  Download action orchestration and shared display formatting are split out of `app/renderer-src/App.vue` and reused by download record components.
- WebView preload AJAX sync helper extraction.
  AJAX fetch timeout handling, retry/backoff, page validation, and bounded concurrent prefetch execution live in `app/browser/webview-preload-helpers.ts`; `app/webview-preload.ts` keeps DOM scraping, IPC progress reporting, and fallback orchestration.
- Rust sync pending-remote cleanup.
  Pending remote group parsing, latest operation lookup, group resolution, and sync-owned visible/hidden collection item upserts are centralized in `native/local-data-engine/src/sync.rs`.
- Download Manager bulk queue action cleanup.
  Bulk retry, resume, pause, and cancel flows share focused result accounting helpers while preserving action-specific single-record behavior in `app/main-process/download-manager.ts`.
- Download Manager local playback preview split.
  Thumbnail preview metadata validation, VTT formatting, FFmpeg thumbnail generation, preview cache cleanup, and preview generation queue state now live in `app/main-process/local-playback-preview.ts`; `app/main-process/download-manager.ts` keeps local playback token routing, response streaming, download records, and manager IPC surface.
- Download Manager local playback server split.
  Local playback token TTL, custom-protocol request parsing, local video response streaming, thumbnail VTT/image responses, and `download:local-playback-source` shaping now live in `app/main-process/local-playback-server.ts`; `app/main-process/download-manager.ts` keeps ready-file lookup, download records, and manager API forwarding.
- Download Manager environment split.
  FFmpeg detection/path selection, download-root selection/readiness validation, and shell open/reveal behavior now live in `app/main-process/download/environment.ts`; `app/main-process/download-manager.ts` keeps download records, queue orchestration, HLS work, and IPC-facing action forwarding.
- Download Manager segment workspace split.
  `.segments` directory naming, segment file naming, resume-manifest identity matching, reusable segment counting, playback-capture manifest counts, and segment-directory byte totals now live in `app/main-process/download/segment-workspace.ts`; `app/main-process/download-manager.ts` keeps the HLS resolution, native segment download, and remux orchestration.
- Download Manager request/path boundary split.
  Renderer download payload normalization, trusted video URL enforcement, source-page subtitle notice parsing, collision-safe relative output filenames, and managed-path containment checks now live in `app/main-process/download/request-boundary.ts`; `app/main-process/download-manager.ts` keeps only short wrappers where existing orchestration and tests depend on those names.
- Download Manager playback capture split.
  Playback-triggered download capture state, user-initiated playback gating, page-load suppression, playback auto-resume guards, capture progress, and background completion queueing now live in `app/main-process/download/playback-capture.ts`; `app/main-process/download-manager.ts` keeps normal queue orchestration and delegates playback-capture IPC actions to that controller.
- Download Manager FFmpeg remux split.
  FFmpeg child process spawning, progress-pipe parsing, `.mp4.part` cleanup, MP4 remux arguments, pause/cancel checks, and final rename now live in `app/main-process/download/ffmpeg-remux.ts`; `app/main-process/download-manager.ts` decides when remux runs and how resulting status is persisted.
- Download Manager HLS source/segment split.
  Jable cookie headers, video page fetches, source-page subtitle notice extraction, playlist URL extraction, and variant playlist selection now live in `app/main-process/download/hls-source.ts`; Rust native segment download calls, sampled concurrency options, progress polling, playlist refresh compatibility checks, and native segment error mapping now live in `app/main-process/download/hls-segments.ts`.
- Download Manager file action split.
  Delete confirmation, managed file deletion, record removal, preview cleanup, open file, and reveal file now live in `app/main-process/download/file-actions.ts`; `app/main-process/download-manager.ts` keeps queue state and supplies the action controller with the relevant record/runtime callbacks.
- Download Manager queue action split.
  Enqueue, retry, resume, pause, cancel, bulk queue actions, and playback auto-download disabling now live in `app/main-process/download/queue-actions.ts`; `app/main-process/download-manager.ts` keeps active download execution, queue pumping, record notification, and controller wiring.
- Download Manager record/runtime state split.
  Persisted/runtime record projection now lives in `app/main-process/download/record-state.ts`, and throttled byte/speed sampling now lives in `app/main-process/download/runtime-progress.ts`; `app/main-process/download-manager.ts` supplies queue, active-task, playback-capture, and persistence callbacks.
- Download Manager active runner split.
  One active HLS download pipeline now lives in `app/main-process/download/active-runner.ts`: start persistence, output directory preparation, HLS source/segment/remux orchestration, ready/failed/paused persistence, preview scheduling, and runtime cleanup.
- Download Manager shutdown split.
  Close-time queue draining, queued/active pause persistence, native/FFmpeg stop signals, active task waiting, and the pause-before-close dialog now live in `app/main-process/download/shutdown.ts`; `app/main-process/download-manager.ts` keeps app-facing forwarding and runtime maps.
- Download Manager folder boundary split.
  Download Manager implementation modules now live under `app/main-process/download/`, with `app/main-process/download/manager.ts` as the domain composition root and `app/main-process/download-manager.ts` retained as the stable compatibility entrypoint for existing main-process and test imports.
- WebView preload DOM scraping cleanup.
  Pure video row, preview URL, pager, and page signature parsing now live in `app/browser/webview-preload-helpers.ts`; `app/webview-preload.ts` keeps IPC, progress reporting, and DOM replacement side effects.
- HLS playback helper split.
  Pure proxy URL parsing, request-target parsing, playlist URI rewriting, and capture-plan segment mapping live in `app/main-process/hls-playback-helpers.ts`; `app/main-process/hls-playback-capture.ts` keeps token registration, Electron session fetches, logging, and capture lifecycle side effects.
- Search count path optimization.
  Search-backed `countVideos` now streams only `v.search_text` through the existing Rust matcher instead of hydrating and sorting full list rows; `listVideos` search filtering remains Rust-owned to preserve current token and pagination semantics.
- WebView preload runtime concern split.
  Browser sync orchestration, deferred sync replay, collection action observation, pending operation overlays, current video metadata refresh, local playback replacement, theater mode, and HLS playback proxy/runtime observers now live in focused modules under `app/browser/webview-preload/`; `app/webview-preload.ts` keeps preload composition, IPC request handlers, scraping, pager DOM side effects, page diagnosis, and tab gesture forwarding.

## Remaining Candidates

### Userscript pagination/export duplication cleanup

Risk: low, priority low.

`jable-favourites-exporter.user.js` remains intentionally self-contained. Pagination and export paths contain some repeated logic, but duplication is acceptable unless the extracted helper has clear browser/export domain meaning and reduces branching complexity.

Manual Tampermonkey validation is required on favourites and watch-later pages for both supported origins.

## How to Continue

When continuing this optimization work, pick one remaining candidate, inspect only the relevant files and tests, then implement and update this file. Do not repeat the original full project architecture analysis unless the user asks for a fresh audit.
