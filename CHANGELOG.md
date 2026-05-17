# Changelog

All notable changes to this project are documented in this file.

The entries through `v0.7.0` were reconstructed from the repository tag history and commit subjects because the project did not previously keep a changelog.

## [Unreleased]

## [v0.10.1] - 2026-05-17

### Changed

- Add open-data-folder and manual update check
- Split Rust data engine modules
- Move Rust sync engine methods
- Update Rust data engine docs
- Fix quick sync completion count
- Document sync completion counts
- Add FFmpeg readiness settings
- Add configurable download location
- Add download list tab skeleton
- Add download records list foundation
- Add single video download workflow
- Add download retry handling
- Add download delete action
- Add download reveal action
- Add download source page action
- Confirm download deletion
- Ignore docs/proposals in .gitignore
- Add download cancellation
- Show download file sizes
- Add download list filters
- Handle interrupted downloads
- Classify download failures
- Persist inferred download states
- Document FFmpeg download setup
- Show download timestamps
- Simplify FFmpeg setup docs
- Show source download states
- Test download playlist helpers
- Retry downloads from source cards
- Notify download completion
- Document download manager spec
- Make data engine Rust-only
- Store downloads in data engine
- Store relative download paths
- Remove deleted engine config entries
- Validate managed download paths
- Check download root before queueing
- Persist missing download state on open
- Document FFmpeg download setup
- Cover download file IPC in smoke test
- Restrict downloads to Jable video URLs
- Send cloneable download payloads
- Force MP4 muxer for partial downloads
- Show active download throughput
- Download HLS segments in parallel
- Smooth active download speed
- Document smoothed download speed
- Move segment downloads to Rust
- Show all download collection memberships
- Adapt segment download concurrency
- Use clean download filenames
- Back off segment concurrency on CDN rejection
- Refactor native download engine modules
- Remove persisted download source collection
- Clarify download delete confirmation
- Redesign download list cards
- Polish download card error UI
- Remove download card title chrome
- Use icon warning for download errors
- Align download card actions
- Stabilize download card footer
- Match download card layout
- Refine download card progress
- Align download card progress bars
- Simplify download card details
- Show concise download error summaries
- Persist download list state filter
- Bump version to 0.10.1

## [v0.10.0] - 2026-05-16

### Changed

- Add bounded AJAX window for full sync
- Introduce data engine abstraction
- Add native data engine scaffold
- Implement rust data engine operations
- Verify rust data engine contract
- Default to rust data engine
- Document rust data engine rollout
- Target mac arm64 and windows release builds
- Mark TypeScript data engine deprecated
- Harden full sync ajax prefetch
- Surface ajax sync fallback status
- Document generated changelog policy
- Add pending remote operations features
- Show sync queue progress; replay outbox sequentially
- Make pagination input editable and add go action
- Add app settings, UI, and persistence
- Defer local apply for deferred remote ops
- Add explicit Pending Sync actions (add/remove/resolve)
- Add remove action chip and checkbox styles
- Extract collections to app/collections.ts
- Add implementation-backed feature specs
- Add IPC normalizers, DB refactors, and app constants
- Bump version to 0.10.0

## [v0.9.4] - 2026-05-16

### Changed

- Persist sync pages from preload
- Run sync in a hidden worker
- Protect manual toggles during sync
- Start fresh syncs from page one
- Add sync operation reconciliation
- Preserve order after sync operations
- Queue collection changes during sync
- Apply queued collection overlays across tabs
- Harden queued sync operations
- Handle queued operation replay failures
- Preserve order for duplicate queued adds
- Show sync queue progress states
- Recover sync pagination and queued replay
- Bump version to 0.9.4

## [v0.9.3] - 2026-05-15

### Changed

- Use jable-desktop as GitHub release repo
- Bump package version to 0.9.2
- Keep collection action buttons on sponsor removal
- Bump version to 0.9.3

## [v0.9.1] - 2026-05-15

### Changed

- Add Electron smoke test
- Add Jable ad blocker and cosmetic filter
- Bump version to 0.9.0
- Block additional ad hosts and speed cosmetic scan
- Bump version to 0.9.1

## [v0.8.0] - 2026-05-15

### Changed

- Retain release workflow handoff artifacts for 1 day because GitHub Release assets are the durable download files.
- Normalize generated changelog release bodies to avoid extra blank lines after section headings.
- Run Prettier on generated changelog updates before the release workflow commits them.

## [v0.7.3] - 2026-05-15

### Added

- Add release workflow automation that commits `CHANGELOG.md` after a draft GitHub release is created.
- Add a changelog update script for release tags.

### Changed

- Update release documentation to describe the post-release changelog commit flow.
- Guard automated changelog commits so they only run when the released tag points at the current default branch head.

## [v0.7.1] - 2026-05-15

### Added

- Add the project changelog and reconstruct release notes for all existing git tags.
- Document that every future version tag must include an updated `CHANGELOG.md` entry before the tag is pushed.

### Changed

- Bump the desktop package version to `0.7.1`.

## [v0.7.0] - 2026-05-15

### Added

- Add English desktop localization and renderer language support.
- Add Japanese desktop localization.
- Split README content into language-specific user guides for Traditional Chinese, English, and Japanese.

### Changed

- Improve localization UX so renderer copy, native menus, context menus, dialogs, and user preferences stay aligned.

## [v0.6.2] - 2026-05-14

### Added

- Add a local data screenshot to README documentation.
- Add collection list action handling and state matching for Jable page interactions.
- Add tab-switching shortcuts with focus handling so repeated shortcuts continue to work.
- Add HTML fullscreen support for embedded browser content.

## [v0.6.1] - 2026-05-14

### Changed

- Refresh README feature descriptions.
- Update quick sync button styling.
- Bump the desktop version to `0.6.1`.

## [v0.6.0] - 2026-05-14

### Added

- Mirror favourite and watch-later toggles from embedded browser actions into local SQLite state.
- Add a compact tab mode shortcut.

### Changed

- Improve active tab visibility behavior.
- Bump the desktop version to `0.6.0`.

## [v0.5.1] - 2026-05-14

### Changed

- Enable `@ts-check` and add JSDoc type coverage for JavaScript modules.
- Guard tab navigation state updates during shutdown.
- Bump the desktop version to `0.5.1`.

## [v0.5.0] - 2026-05-14

### Added

- Add paginated local video listing and matching count queries.
- Add browser tab audio state tracking and controls.
- Add desktop JSON file export for local collections.
- Add IndexedDB-backed userscript export cache with a localStorage fallback.
- Add local full-text search with multiple search modes.

### Changed

- Convert the Vue renderer to TypeScript.
- Refactor known-URL checks and adjust toast spacing.

## [v0.4.1] - 2026-05-13

### Fixed

- Normalize line endings so CI formatting checks pass consistently.

## [v0.4.0] - 2026-05-13

### Added

- Add trackpad swipe support for embedded browser history.
- Add compact floating tab rail and browser tab context menus.
- Add transient status toasts.
- Add local library video context menu actions and open-new behavior.
- Document keyboard shortcuts and mouse actions.

### Changed

- Add Prettier and ESLint checks to CI.
- Document lint, format, and full check scripts.
- Format README tables and compact toast markup.

## [v0.3.0] - 2026-05-13

### Added

- Add quick and full desktop sync modes with `site_order` support.
- Add thumbnail video previews.
- Add the Vue 3 and Vite renderer and integrate it with Electron.
- Add Vitest coverage and renderer test workflow.
- Add `WebContentsView` attach and detach helpers for embedded browsing.

### Changed

- Remove playback progress tracking.
- Remove preview/open links in preparation for the Vue and Tailwind renderer.
- Enforce Node.js 24 and bump Electron.
- Preserve `site_order` during JSON import and export.
- Bump the desktop version to `0.3.0`.

## [v0.2.1] - 2026-05-11

### Added

- Add the MIT license.

### Changed

- Disable automatic GitHub release publishing so generated release assets remain drafts for review.

## [v0.2.0] - 2026-05-11

### Added

- Add the initial Tampermonkey userscript for exporting Jable favourites and watch-later entries.
- Add title, URL, views, and likes export support.
- Add the Electron desktop MVP with SQLite storage.
- Add desktop packaging setup, build icons, release workflow, and development documentation.
- Add embedded browser navigation controls and state handling.

### Changed

- Clarify documentation and centralize the persistent Jable session partition constant.

[Unreleased]: https://github.com/shane-zeng/jable-desktop/compare/v0.10.1...HEAD
[v0.10.1]: https://github.com/shane-zeng/jable-desktop/compare/v0.10.0...v0.10.1
[v0.10.0]: https://github.com/shane-zeng/jable-desktop/compare/v0.9.4...v0.10.0
[v0.9.4]: https://github.com/shane-zeng/jable-desktop/compare/v0.9.3...v0.9.4
[v0.9.3]: https://github.com/shane-zeng/jable-desktop/compare/v0.9.2...v0.9.3
[v0.9.1]: https://github.com/shane-zeng/jable-desktop/compare/v0.8.0...v0.9.1
[v0.8.0]: https://github.com/shane-zeng/jable-desktop/compare/v0.7.3...v0.8.0
[v0.7.3]: https://github.com/shane-zeng/jable-desktop/compare/v0.7.2...v0.7.3
[v0.7.1]: https://github.com/shane-zeng/jable-desktop/compare/v0.7.0...v0.7.1
[v0.7.0]: https://github.com/shane-zeng/jable-desktop/compare/v0.6.2...v0.7.0
[v0.6.2]: https://github.com/shane-zeng/jable-desktop/compare/v0.6.1...v0.6.2
[v0.6.1]: https://github.com/shane-zeng/jable-desktop/compare/v0.6.0...v0.6.1
[v0.6.0]: https://github.com/shane-zeng/jable-desktop/compare/v0.5.1...v0.6.0
[v0.5.1]: https://github.com/shane-zeng/jable-desktop/compare/v0.5.0...v0.5.1
[v0.5.0]: https://github.com/shane-zeng/jable-desktop/compare/v0.4.1...v0.5.0
[v0.4.1]: https://github.com/shane-zeng/jable-desktop/compare/v0.4.0...v0.4.1
[v0.4.0]: https://github.com/shane-zeng/jable-desktop/compare/v0.3.0...v0.4.0
[v0.3.0]: https://github.com/shane-zeng/jable-desktop/compare/v0.2.1...v0.3.0
[v0.2.1]: https://github.com/shane-zeng/jable-desktop/compare/v0.2.0...v0.2.1
[v0.2.0]: https://github.com/shane-zeng/jable-desktop/releases/tag/v0.2.0
