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
  AJAX fetch timeout handling, retry/backoff, page validation, and bounded sliding window execution live in `app/browser/webview-preload-helpers.ts`; `app/webview-preload.ts` keeps DOM scraping, IPC progress reporting, and fallback orchestration.

## Remaining Candidates

### Rust sync pending-remote cleanup

Risk: low to medium.

`native/local-data-engine/src/sync.rs` still has repeated pending remote operation and visibility update SQL. Good candidates are helpers with clear sync-domain names, such as resolving pending groups or applying local add/remove visibility. Avoid generic SQL helpers that hide the state-machine rules.

Validation should include Rust tests for outbox ordering, pending remote grouping, resolved/superseded handling, and full-sync visibility behavior.

### Download Manager bulk queue action cleanup

Risk: low to medium.

`app/main-process/download-manager.ts` still has repeated bulk action result setup and queue iteration patterns around retry, resume, pause, and cancel flows. A helper is only worthwhile if it preserves readable action-specific branches and does not introduce mode flags that obscure behavior.

Validation should include Node tests for bulk download list actions and Download Manager orchestration.

### Search-path query optimization

Risk: medium to high.

The no-search list/count path has already been optimized. Search still needs stricter care because `listVideos` and `countVideos` must stay perfectly aligned with SQLite FTS5 tokenization, visibility filters, downloadable filters, sorting, limit, and offset semantics.

Only optimize this after adding or strengthening tests that cover search result counts, pagination, collection visibility, fallback-origin canonical URLs, and downloadable-only filters.

### Userscript pagination/export duplication cleanup

Risk: low, priority low.

`jable-favourites-exporter.user.js` remains intentionally self-contained. Pagination and export paths contain some repeated logic, but duplication is acceptable unless the extracted helper has clear browser/export domain meaning and reduces branching complexity.

Manual Tampermonkey validation is required on favourites and watch-later pages for both supported origins.

### WebView preload DOM scraping cleanup

Risk: medium.

The AJAX sync helpers are extracted, but `app/webview-preload.ts` still owns a large DOM scraping and collection action observer surface. Further cleanup should only move pure selector, pager, or parsing logic into `app/browser/webview-preload-helpers.ts` when it stays testable without Electron or live Jable pages.

Keep IPC progress reporting, active sync locks, deferred operation replay, and DOM mutation side effects in preload unless there is a stronger ownership boundary.

## How to Continue

When continuing this optimization work, pick one remaining candidate, inspect only the relevant files and tests, then implement and update this file. Do not repeat the original full project architecture analysis unless the user asks for a fresh audit.
