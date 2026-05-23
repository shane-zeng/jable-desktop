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
- Download List and local video file management
- Traditional Chinese, English, and Japanese UI
- macOS and Windows support

## Technical Highlights

- Electron desktop architecture
- Vue 3 + TypeScript renderer
- SQLite persistence with FTS5 full-text search
- Incremental sync and full reconciliation sync workflows
- Embedded browser session persistence
- Shared IPC wire types
- Lightweight i18n architecture covering the renderer and Electron native menus
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

Large lists are accelerated in the background with bounded concurrent AJAX prefetch. If the website response does not validate, the app automatically falls back to normal sequential paging.

## Pending Sync

If you add or remove items on Jable while a sync is running, the app first stores those actions in a local outbox and does not change the normal local list. By default it does not send them automatically; they stay in Pending Sync for manual review. If you enable "Automatically Send Changes After Sync" in Settings, the app sends them back to Jable in original operation order after page scraping finishes. Local data updates only after Jable reports success.

When the app is replaying that outbox after sync, the top-right status toast stays visible with a progress bar until the queued actions finish or the first replay failure stops the run.

If replaying those actions fails, or automatic sending is off, the Local Data view shows a global Pending Sync tab. This tab does not expose raw database operation rows and does not infer a final state. It groups unconfirmed sync operations by video and shows the list, sync state, latest error, and operation sequence summary.

For any video in Pending Sync, you can click "Add" or "Remove" to run an explicit AJAX action against the corresponding Jable list. Success updates local data and removes the pending item. If you already handled it on Jable, or do not want the app to send anything, click "Resolved" to clear only the local pending state; the normal local list will converge with the site on the next Full Sync.

When a later Full Sync completes without new replay failures, pending items left by previous sync runs are treated as superseded by the full website snapshot and the Pending Sync tab hides automatically. Items created during that same sync run still stay pending first.

## Download List And FFmpeg

Downloads require FFmpeg to be installed locally.

After installing FFmpeg, open Settings > Downloads:

- Click Check Again to let the app detect FFmpeg from `PATH`
- Or click Choose FFmpeg to manually select the `ffmpeg` binary
- Use the same section to choose the download folder if needed
- Choose Stable, Balanced, or Fast download speed mode. This controls segment download speed for each video and does not change how many videos run at once.

### macOS

If you use Homebrew:

```zsh
brew install ffmpeg
```

After installation, return to the app settings page and click Check Again. If the app still cannot detect FFmpeg, manually choose the `ffmpeg` binary installed by Homebrew.

### Windows

If you use winget:

```powershell
winget install Gyan.FFmpeg
```

You can also download an FFmpeg build, extract it, add its `bin` folder to `PATH`, or manually choose `ffmpeg.exe` in the app settings page.

Downloaded videos appear in the Download List tab under Local Data. A download item's title, cover, and preview open the Jable source page with the same new-tab and context-menu gestures as collection cards. Ready items can be played with the system default player, revealed in the file manager, or explicitly deleted from local storage; failed items can be retried. The Download List also supports persisted multi-select state filtering, bulk retry for failed items, Queue Actions for Pause All / Resume All / Cancel Queued, and Delete Selected.

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

## Settings

The Settings page controls:

- Interface language
- Maximum open browser tabs, with a memory and playback warning above the recommended range
- WebView Enhancement Mode, off by default; when enabled, it applies extra WebView loading and page cleanup rules
- Browser HTTP cache clearing without affecting Jable login state or local playback thumbnail caches
- Full Sync acceleration: Safe, Standard, or Fast; Fast prefetches more pages at once for large lists, and falls back to conservative page-by-page sync if it hits timeout, 403, or 429 responses
- Whether sync-time favourite and watch-later changes are sent automatically in original operation order after sync
- FFmpeg status, Check Again, manual FFmpeg selection, download folder location, concurrent video downloads, and download speed mode
- JSON import, JSON export, settings backup, full app backup, the local database path, opening the local data folder, opening the Log folder, and clearing diagnostics
- Manual update checks

## Import And Export

- Export or import single-list JSON backups from Settings > Data
- Export a settings backup, or export a full app backup that includes all local list rows, hidden state, sync state, and download records
- Full app backup does not include Jable cookies/login session, logs, browser tab restore state, window placement, or downloaded video files
- Importing a full app backup merges data and clears Pending Sync so old operations are not sent to Jable later; queued or downloading records are restored as paused
- Preserve `site_order`
- When a JSON file includes source metadata, the app preselects Favourites or Watch Later; if the source cannot be detected, choose the import target manually

## Data And Login State

Synced data is stored locally on the user's computer.

The app does not upload list data to external services. Browsing and sign-in continue communicating directly with the official Jable website.

If `https://jable.tv` fails to load, the desktop app automatically switches to the official fallback site `https://fs1.app` for the current session. Local data still uses the primary URL as the canonical URL so the same video is not duplicated across domains.

Login state is stored inside an isolated Electron session partition, but users may still need to sign in again if the official Jable session expires.

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

## Disclaimer

> **This tool is provided only for learning and technical research.** Users are responsible for complying with local laws and respecting content copyright. The developer is not responsible for legal liability arising from use of this tool. Do not use this tool for illegal or infringing purposes.

## Acknowledgements

The download feature and download workflow design reference [hcjohn463/JableDownload](https://github.com/hcjohn463/JableDownload). This project is not a fork of that project; the related implementation is integrated into Jable Desktop's Electron / Rust architecture.

## License

Apache License 2.0.

See [LICENSE](../LICENSE).
