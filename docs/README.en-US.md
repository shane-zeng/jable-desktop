# Jable Desktop User Guide

Jable Desktop is an unofficial desktop tool and is not affiliated with Jable.

It opens Jable inside the app and syncs favourites and watch-later lists into local storage for browsing, searching, sorting, importing, and exporting backups.

[Back to project home](../README.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja-JP.md)

## Features

- Sync favourites and watch-later lists
- Embedded multi-tab browser
- Local SQLite storage
- Quick sync and full sync modes
- SQLite FTS5 local search
- JSON import/export
- Traditional Chinese, English, and Japanese UI
- macOS and Windows support

## Technical Highlights

- Electron desktop architecture
- Vue 3 + TypeScript renderer
- SQLite persistence with FTS5 full-text search
- Incremental sync and full reconciliation sync workflows
- Embedded browser session persistence
- Shared IPC wire types
- Lightweight i18n architecture covering the renderer, Electron native menus, and userscript UI
- GitHub Actions quality gates for linting, type-checking, testing, and release packaging

## Architecture Overview

Jable Desktop uses an embedded browser architecture instead of unofficial APIs.

Sign-in and browsing continue communicating directly with the official Jable website while the app synchronizes list data into a local SQLite database for local browsing, search, sorting, backup, and restore workflows.

The application is mainly separated into:

- Electron main process
- Embedded browser / webview layer
- Vue renderer UI
- SQLite persistence layer
- Sync / scraping pipeline

## Local Search

Local search is powered by SQLite FTS5.

The app generates normalized search indexes from titles and URLs and supports:

- CJK-compatible search
- punctuation-normalized phrase matching
- URL fragment search
- any / all / phrase search modes

After syncing, videos can be searched and sorted locally without repeatedly loading website pages.

## Sync Modes

### Quick Sync

- Starts from page 1
- Stops once an entire page is already known
- Designed for incremental updates
- Use Full Sync first when the local database is empty

### Full Sync

- Runs from page 1 to the final page
- Rebuilds complete site ordering
- Updates all visible videos
- Hides local rows no longer present on the website

Large lists are accelerated in the background with a bounded AJAX window. If the website response does not validate, the app automatically falls back to normal sequential paging.

## Pending Sync

If you add or remove items on Jable while a sync is running, the app first stores those actions in a local outbox and sends them back to Jable after page scraping finishes.

If replaying those actions fails, the Local Data view shows a global Pending Sync tab. This tab does not expose raw database operation rows. Instead, it groups by video and shows the final intended state, such as "should be added" or "should be removed". If the same video was added, removed, and added again, it appears once with an operation sequence summary.

You can resend the final state for any video in Pending Sync. A successful resend removes that video from the list; a failed resend keeps it visible and updates the error. This fixes whether the video belongs to the remote list, but it does not try to restore the original remote ordering. The next Full Sync reads the website order again and brings the local `site_order` back in line.

When a later Full Sync completes without new replay failures, older pending items are treated as superseded by the full website snapshot and the Pending Sync tab hides automatically.

## Installation

1. Download the latest release from GitHub Releases
2. macOS users: download `.dmg` or `.zip`
3. Windows users: download `.exe` or `.zip`
4. Open Jable Desktop

Current releases are unsigned:

- macOS may show a Gatekeeper warning
- Windows may show a SmartScreen warning

Please verify the download source is this project's GitHub Releases.

## First Use

1. Sign in to Jable inside the embedded browser
2. Open the Local Data tab
3. Choose Favourites or Watch Later
4. Click Full Sync
5. Synced videos will appear in the local list

After the first full sync, use Quick Sync for routine incremental updates.

## Import And Export

- Export JSON backups
- Import JSON backups
- Preserve `site_order`
- Compatible with legacy Tampermonkey export files

## Data And Login State

Synced data is stored locally on the user's computer.

The app does not upload list data to external services. Browsing and sign-in continue communicating directly with the official Jable website.

If `https://jable.tv` fails to load, the desktop app automatically switches to the official fallback site `https://fs1.app` for the current session. Local data still uses the primary URL as the canonical URL so the same video is not duplicated across domains.

Login state is stored inside an isolated Electron session partition, but users may still need to sign in again if the official Jable session expires.

## Tampermonkey Userscript

The original userscript remains available as [`jable-favourites-exporter.user.js`](../jable-favourites-exporter.user.js).

It supports:

- `https://jable.tv/my/favourites/videos/`
- `https://jable.tv/my/favourites/videos-watch-later/`
- `https://fs1.app/my/favourites/videos/`
- `https://fs1.app/my/favourites/videos-watch-later/`

Open one of those pages, then click the floating export button in the lower-right corner to export all pages. Use the compact language selector beside it to choose **繁中**, **EN**, or **日本語**.

## Development Docs

See [docs/development.md](development.md).

Development notes include:

- Architecture overview
- SQLite schema and migrations
- Search architecture
- Sync pipeline
- Electron process design
- Packaging and release workflow
- Testing and validation checklist

## License

MIT License.

See [LICENSE](../LICENSE).
