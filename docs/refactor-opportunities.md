# Refactor Opportunities

This file tracks no-spec-change optimization work so future maintenance can continue from the known backlog instead of repeating a full project structure audit.

## Scope Rule

These refactors must not change documented behavior, IPC contracts, sync semantics, JSON shapes, or renderer UI behavior.

Before implementing a candidate:

- Check the relevant `docs/specs/` file and nearby tests.
- Verify the current code path because this backlog may lag behind implementation.
- Keep changes small enough that behavior can be validated with focused tests.
- Prefer local helpers and direct code over broad abstractions unless the extracted logic has clear domain meaning, branching complexity, or repeated use.

## Completed Batches

- GitHub Actions Rust cache and stale-run cancellation.
  Test and release build jobs now restore the shared Rust workspace cache for `native/target`, and test workflow runs cancel stale in-progress runs for the same pull request or branch.
- Rust native engine workspace build cache.
  `native/Cargo.toml` now owns both native engine crates as one Cargo workspace, so Rust check/clippy/test/build commands share a single `native/target` directory and one lockfile instead of compiling each crate in separate target trees.
- Rust data-engine no-search list/count query optimization.
  `native/local-data-engine/src/store.rs` pushes simple visible-list count and pagination into SQL while keeping search behavior aligned with `listVideos` and `countVideos`.
- Rust download asset membership batching.
  `native/local-data-engine/src/downloads.rs` avoids per-record collection membership queries when listing download assets.
- Rust resource import flattening cleanup.
  `native/local-data-engine/src/resource.rs` avoids repeated resource flattening during import.
- Download Manager pure helper extraction.
  Download error classification and local playback range handling are split out from the former single-file Download Manager while preserving the existing manager API and IPC surface.
- Renderer download action/display extraction.
  Download action orchestration and shared display formatting are split out of `app/renderer-src/App.vue` and reused by download record components.
- WebView preload AJAX sync helper extraction.
  AJAX fetch timeout handling, retry/backoff, page validation, and bounded concurrent prefetch execution live in `app/browser/webview-preload-helpers.ts`; `app/webview-preload.ts` keeps DOM scraping, IPC progress reporting, and fallback orchestration.
- Rust sync pending-remote cleanup.
  Pending remote group parsing, latest operation lookup, group resolution, and sync-owned visible/hidden collection item upserts are centralized in `native/local-data-engine/src/sync.rs`.
- Download Manager bulk queue action cleanup.
  Bulk retry, resume, pause, and cancel flows share focused result accounting helpers while preserving action-specific single-record behavior in `app/main-process/download/manager.ts`.
- Download Manager local playback preview split.
  Thumbnail preview metadata validation, VTT formatting, FFmpeg thumbnail generation, preview cache cleanup, and preview generation queue state now live in `app/main-process/local-playback/preview.ts`; `app/main-process/download/manager.ts` keeps the stable manager API surface through the download module.
- Download Manager local playback server split.
  Local playback token TTL, custom-protocol request parsing, local video response streaming, thumbnail VTT/image responses, and `download:local-playback-source` shaping now live in `app/main-process/local-playback/server.ts`; range parsing lives in `app/main-process/local-playback/range.ts`.
- Download Manager environment split.
  FFmpeg detection/path selection, download-root selection/readiness validation, and shell open/reveal behavior now live in `app/main-process/download/environment.ts`; `app/main-process/download/manager.ts` keeps download records, queue orchestration, HLS work, and IPC-facing action forwarding.
- Download Manager segment workspace split.
  `.segments` directory naming, segment file naming, resume-manifest identity matching, reusable segment counting, playback-capture manifest counts, and segment-directory byte totals now live in `app/main-process/download/segment-workspace.ts`; `app/main-process/download/manager.ts` keeps the HLS resolution, native segment download, and remux orchestration.
- Download Manager request/path boundary split.
  Renderer download payload normalization, trusted video URL enforcement, source-page subtitle notice parsing, collision-safe relative output filenames, and managed-path containment checks now live in `app/main-process/download/request-boundary.ts`; `app/main-process/download/manager.ts` keeps only short wrappers where existing orchestration and tests depend on those names.
- Download Manager playback capture split.
  Playback-triggered download capture state, user-initiated playback gating, page-load suppression, playback auto-resume guards, capture progress, and background completion queueing now live in `app/main-process/download/playback-capture.ts`; `app/main-process/download/manager.ts` keeps normal queue orchestration and delegates playback-capture IPC actions to that controller.
- Download Manager FFmpeg remux split.
  FFmpeg child process spawning, progress-pipe parsing, `.mp4.part` cleanup, MP4 remux arguments, pause/cancel checks, and final rename now live in `app/main-process/download/ffmpeg-remux.ts`; `app/main-process/download/manager.ts` decides when remux runs and how resulting status is persisted.
- Download Manager HLS source/segment split.
  Jable cookie headers, video page fetches, source-page subtitle notice extraction, playlist URL extraction, and variant playlist selection now live in `app/main-process/download/hls-source.ts`; Rust native segment download calls, sampled concurrency options, progress polling, playlist refresh compatibility checks, and native segment error mapping now live in `app/main-process/download/hls-segments.ts`.
- Download Manager file action split.
  Delete confirmation, managed file deletion, record removal, preview cleanup, open file, and reveal file now live in `app/main-process/download/file-actions.ts`; `app/main-process/download/manager.ts` keeps queue state and supplies the action controller with the relevant record/runtime callbacks.
- Download Manager queue action split.
  Enqueue, retry, resume, pause, cancel, bulk queue actions, and playback auto-download disabling now live in `app/main-process/download/queue-actions.ts`; `app/main-process/download/manager.ts` keeps active download execution, queue pumping, record notification, and controller wiring.
- Download Manager record/runtime state split.
  Persisted/runtime record projection now lives in `app/main-process/download/record-state.ts`, and throttled byte/speed sampling now lives in `app/main-process/download/runtime-progress.ts`; `app/main-process/download/manager.ts` supplies queue, active-task, playback-capture, and persistence callbacks.
- Download Manager active runner split.
  One active HLS download pipeline now lives in `app/main-process/download/active-runner.ts`: start persistence, output directory preparation, HLS source/segment/remux orchestration, ready/failed/paused persistence, preview scheduling, and runtime cleanup.
- Download Manager shutdown split.
  Close-time queue draining, queued/active pause persistence, native/FFmpeg stop signals, active task waiting, and the pause-before-close dialog now live in `app/main-process/download/shutdown.ts`; `app/main-process/download/manager.ts` keeps app-facing forwarding and runtime maps.
- Download Manager folder boundary split.
  Download Manager implementation modules now live under `app/main-process/download/`, with `app/main-process/download/manager.ts` as the domain composition root.
- WebView preload DOM scraping cleanup.
  Pure video row, preview URL, pager, and page signature parsing now live in `app/browser/webview-preload-helpers.ts`; `app/webview-preload.ts` keeps IPC, progress reporting, and DOM replacement side effects.
- HLS playback helper split.
  Pure proxy URL parsing, request-target parsing, playlist URI rewriting, and capture-plan segment mapping live in `app/main-process/hls-playback/helpers.ts`.
- Search count path optimization.
  Search-backed `countVideos` now streams only `v.search_text` through the existing Rust matcher instead of hydrating and sorting full list rows; `listVideos` search filtering remains Rust-owned to preserve current token and pagination semantics.
- WebView preload runtime concern split.
  Browser sync orchestration, deferred sync replay, collection action observation, pending operation overlays, current video metadata refresh, local playback replacement, theater mode, and HLS playback proxy/runtime observers now live in focused modules under `app/browser/webview-preload/`; `app/webview-preload.ts` keeps preload composition, IPC request handlers, scraping, pager DOM side effects, page diagnosis, and tab gesture forwarding.
- HLS playback folder and proxy split.
  Production HLS playback modules now live under `app/main-process/hls-playback/`: `capture.ts` is the composition entrypoint, `proxy-server.ts` owns loopback proxy/token/playlist routing, `ipc.ts` owns renderer IPC payloads, `capture-writes.ts` owns managed segment writes and prefetch, `proxy-headers.ts` owns request/response headers, `probe.ts` owns debug observation, and `shared.ts` owns shared types/env gates.
- Main-process local playback folder boundary.
  Local playback range parsing, custom-protocol serving, and thumbnail preview generation now live under `app/main-process/local-playback/`.
- Root playback/download adapter removal.
  Main-process source, Node tests, and Electron startup now import domain entrypoints directly from `app/main-process/download/`, `app/main-process/hls-playback/`, and `app/main-process/local-playback/`. Electron runtime builds clean `app/runtime-dist/` before compiling so deleted ignored output files do not remain package candidates.
- Main-process browser/app boundary split.
  `app/main.ts` is back under 1000 lines and keeps lifecycle plus top-level wiring. Embedded browser runtime wiring, browser session restore/save, preload request/response bookkeeping, and active Jable origin fallback state are delegated out of `main.ts`; app local/export/documentation side effects live in `app-actions.ts`; and app-level active-download quit/window-close gating lives in `download-app-shutdown.ts`.
- Main-process browser folder boundary.
  Browser runtime modules now live under `app/main-process/browser/`: `runtime.ts` composes the browser subsystem, `tab-manager.ts` owns `WebContentsView` tab state, `shortcut-manager.ts` owns main-process shortcut wiring, `session-controller.ts` and `session-store.ts` own startup tab persistence, `preload-requests.ts` owns browser preload request/response bookkeeping, and `origin-controller.ts` owns active Jable origin fallback state.

## Remaining Candidates

No active no-spec-change refactor candidates are currently tracked.

## Watchlist

These are maintenance hot spots, not immediate refactor requests. Do not split them just because they are large; wait until nearby behavior is being changed or the triggering condition applies.

### Rust sync state machine boundary

Risk: high, priority conditional.

`native/local-data-engine/src/sync.rs` is large and mixes sync page persistence, collection add/remove toggles, deferred remote outbox state, pending remote groups, and finish-sync reconciliation. This is the highest-value future split, but it also owns sensitive sync/outbox invariants.

Trigger: when changing sync, outbox replay, pending remote grouping, or finish-sync reconciliation behavior.

Preferred direction: split in small behavior-preserving steps along real domain boundaries such as sync page persistence and pending remote/outbox handling. Keep Rust-owned invariants covered directly in `native/local-data-engine/src/tests.rs`, with Node contract tests only as the JS boundary check.

### Settings panel section boundaries

Risk: medium, priority conditional.

`app/renderer-src/components/SettingsPanel.vue` currently contains several settings sections plus shortcut display, import detection, FFmpeg configuration, and download-root behavior. It is still acceptable as-is.

Trigger: when adding another settings section, expanding import detection, or changing shortcut/FFmpeg/download-root behavior enough that the existing component becomes harder to scan.

Preferred direction: extract focused section components or helper modules for import detection and shortcut display. Do not split purely for visual neatness.

### App browser message handling

Risk: medium, priority low.

`app/renderer-src/App.vue` already delegates substantial state to composables, but browser message handling still receives multiple cross-domain messages in one place.

Trigger: when adding another set of browser messages or changing browser-message routing enough that the handler obscures ownership.

Preferred direction: consider a focused `useBrowserMessages` composable that routes existing message types without changing renderer state semantics.

### IPC channel string alignment

Risk: medium, priority conditional.

IPC channel names are intentionally repeated across `app/preload.ts`, `app/main-process/ipc-handlers.ts`, and related tests. `docs/specs/ipc-contract.md` already documents the multi-file alignment rule, and current guardrail tests cover the boundary.

Trigger: when adding or renaming a batch of IPC channels.

Preferred direction: consider minimal channel constants only if they reduce real synchronization risk. Do not introduce a generated RPC framework or broad IPC abstraction.

## How to Continue

When continuing this optimization work, add or pick one concrete remaining candidate, inspect only the relevant files and tests, then implement and update this file. Do not repeat the original full project architecture analysis unless the user asks for a fresh audit.
