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
- WebView preload DOM scraping cleanup.
  Pure video row, preview URL, pager, and page signature parsing now live in `app/browser/webview-preload-helpers.ts`; `app/webview-preload.ts` keeps IPC, progress reporting, active locks, and DOM replacement side effects.

## Remaining Candidates

### Search-path query optimization

Risk: medium to high.

The no-search list/count path has already been optimized. Search still needs stricter care because `listVideos` and `countVideos` must stay perfectly aligned with SQLite FTS5 tokenization, visibility filters, downloadable filters, sorting, limit, and offset semantics.

Only optimize this after adding or strengthening tests that cover search result counts, pagination, collection visibility, fallback-origin canonical URLs, and downloadable-only filters.

### Userscript pagination/export duplication cleanup

Risk: low, priority low.

`jable-favourites-exporter.user.js` remains intentionally self-contained. Pagination and export paths contain some repeated logic, but duplication is acceptable unless the extracted helper has clear browser/export domain meaning and reduces branching complexity.

Manual Tampermonkey validation is required on favourites and watch-later pages for both supported origins.

## How to Continue

When continuing this optimization work, pick one remaining candidate, inspect only the relevant files and tests, then implement and update this file. Do not repeat the original full project architecture analysis unless the user asks for a fresh audit.
