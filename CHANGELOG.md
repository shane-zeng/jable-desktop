# Changelog

All notable changes to this project are documented in this file.

The entries through `v0.7.0` were reconstructed from the repository tag history and commit subjects because the project did not previously keep a changelog.

## [Unreleased]

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

[Unreleased]: https://github.com/shane-zeng/jable-desktop/compare/v0.7.1...HEAD
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
