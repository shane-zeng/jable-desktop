# Development Notes

> Developer-oriented notes for building, testing, packaging, and releasing Jable Desktop.

The user-facing guide lives in [README.md](../README.md).

---

# Jable Desktop

> A Tampermonkey user script and Electron desktop app to export, sync, and browse favourite or watch-later videos from [Jable.tv](https://jable.tv/) — even when pagination is loaded dynamically.

Jable Desktop is an unofficial desktop companion for Jable.

The original userscript remains available as `jable-favourites-exporter.user.js`. The desktop app adds an embedded browser with isolated persistent Jable cookies and SQLite storage.

---

## Features

- Export all items across multiple pages (auto-click pagination).
- Supports both **「影片收藏」** and **「稍後觀看」** pages.
- Works even when Jable uses AJAX to load content (no API access needed).
- Output format: **JSON** (default) or **CSV** (toggleable).
- Compatible with modern browsers (Chrome / Edge / Firefox).
- No external dependencies for the userscript.
- Desktop MVP stores synced data in SQLite and supports JSON import/export.
- Desktop sync preserves Jable site order and supports quick/full sync modes.

---

## Userscript Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Visit the script file: `jable-favourites-exporter.user.js`.
3. Tampermonkey will prompt to install the script. Click **Install**.

---

## Userscript Usage

1. Go to your Jable account:
- **影片收藏**: `https://jable.tv/my/favourites/videos/`
- **稍後觀看**: `https://jable.tv/my/favourites/videos-watch-later/`
2. Wait until all thumbnails are loaded.
3. Click the **「匯出全部」** button next to **設定**.
4. The script will:
- Simulate clicking each pagination button.
- Collect video titles and URLs.
- Export a JSON or CSV file automatically.

---

## Output Files

| Page | URL | Output filename |
|------|-----|-----------------|
| 影片收藏 | `https://jable.tv/my/favourites/videos/` | `favourites_list.json` (or `.csv`) |
| 稍後觀看 | `https://jable.tv/my/favourites/videos-watch-later/` | `watch_later_list.json` (or `.csv`) |

You can change export format by editing this line in the script:

```js
var EXPORT_FORMAT = 'json'; // or 'csv'
```

---

## Desktop App MVP

The desktop app opens Jable in an embedded browser and stores synced data in SQLite.

```sh
npm install
npm start
```

Log in inside the embedded browser, choose **影片收藏** or **稍後觀看** in the local data view, then click **快速同步** or **完整同步**. Jable cookies are kept in the isolated `persist:jable-session` Electron partition, but Jable can still expire or revoke the server-side session. The SQLite database path is shown in the right panel.

`npm start` builds the Vue renderer into `app/renderer-dist/` before Electron starts. For renderer development, run Vite in one terminal and Electron in another:

```sh
npm run dev:renderer
npm run start:dev
```

Desktop sync behavior:

- **快速同步** navigates to page 1, updates scanned rows, and stops after a page where every row is already known.
- **完整同步** navigates to page 1, updates all visible site rows, rebuilds `site_order`, and hides local rows not seen in a completed full run.
- Full sync runs in batches of 100 pages. Batch-limited or failed runs are marked incomplete; scanned rows remain saved, but missing-row hiding is skipped until a completed full run.
- JSON export keeps the public userscript-compatible row shape and uses `site_order` only for output ordering.

Desktop app files:

- `app/main.js`: Electron main process and IPC handlers.
- `app/webview-preload.js`: scraper injected into the embedded Jable `BrowserView`.
- `app/database.js`: SQLite schema, upsert logic, JSON import/export.
- `app/renderer-src/`: Vue 3 + TailwindCSS renderer source.
- `app/renderer-dist/`: Vite-built renderer loaded by Electron and packaged for release.
- `app/renderer/`: legacy plain renderer kept for reference during the migration.

### Desktop Validation

```sh
npm run build:renderer
npm test
```

Manual checks:

- Restart the app and confirm the embedded browser keeps local Jable cookies when the server-side session is still valid.
- Quick sync both favourites and watch-later lists.
- Full sync a list and confirm local ordering matches the Jable page order.
- For large lists, continue a paused full sync and confirm incomplete batches do not hide old rows.
- Import an existing userscript JSON export and verify rows appear in the matching tab.
- Export JSON and confirm the `{ data: [...], meta: {...} }` shape is preserved.

### Desktop Packaging

Install dependencies once:

```sh
npm install
```

Packaging scripts build the Vue renderer before running `electron-builder`.

Build unpacked apps for local smoke testing:

```sh
npm run pack:mac
npm run pack:win
```

Build unsigned distribution artifacts:

```sh
npm run dist:mac:unsigned
npm run dist:win:unsigned
```

Artifacts are written to `release/`. The packaged app still stores its SQLite database under the OS app data directory, so user data is not bundled inside the app.

Unsigned artifacts are currently the default release output. The desktop app uses `io.github.shane-zeng.jable-desktop` as its stable app ID.

#### Unsigned GitHub Draft Releases

Pushing a version tag runs `.github/workflows/release.yml`:

```sh
git tag v0.2.0
git push origin v0.2.0
```

The workflow runs tests, builds unsigned macOS artifacts with `npm run dist:mac:unsigned`, builds unsigned Windows artifacts with `npm run dist:win:unsigned`, then creates a GitHub draft release. Review and smoke test the draft assets before publishing the release.

No GitHub Actions repository secrets or variables are required for the unsigned release workflow. GitHub provides `GITHUB_TOKEN` automatically, and the workflow sets `permissions: contents: write` so it can create the draft release.

Expected draft release artifacts:

- macOS `.dmg`
- macOS `.zip`
- Windows `.exe`
- Windows `.zip`

Because these artifacts are unsigned, macOS Gatekeeper and Windows SmartScreen may warn users when they open the app.
