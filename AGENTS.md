# Repository Guidelines

## Project Structure & Module Organization

This repository contains a Tampermonkey userscript and an Electron desktop MVP for exporting Jable favourites and watch-later entries.

- `jable-favourites-exporter.user.js`: main userscript with metadata, configuration, scraping helpers, pagination, download logic, and UI injection.
- `app/main.js`: Electron main process, window creation, persistent session management, and IPC handlers.
- `app/webview-preload.js`: scraper injected into the embedded Jable `BrowserView`.
- `app/database.js`: SQLite schema, upsert logic, sync state, and JSON import/export.
- `app/renderer/`: desktop GUI files.
- `test/`: Node test files for storage and import/export behavior.
- `README.md`: installation and usage documentation for end users.
- `AGENTS.md`: contributor guidance for future maintenance.

Keep the userscript self-contained. Put desktop-only code under `app/` and tests under `test/`.

## Build, Test, and Development Commands

The userscript has no build step. Edit it directly and validate it in Tampermonkey.

- `ll`: inspect repository files.
- `cat jable-favourites-exporter.user.js`: review the userscript.
- `grep "EXPORT_FORMAT" jable-favourites-exporter.user.js`: find configuration or implementation details.
- `npm install`: install the Electron development dependency.
- `npm start`: run the desktop app.
- `npm test`: run Node tests.
- `git diff`: review local changes before committing.

For validation, install or update `jable-favourites-exporter.user.js` in Tampermonkey, then test:

- `https://jable.tv/my/favourites/videos/`
- `https://jable.tv/my/favourites/videos-watch-later/`

## Coding Style & Naming Conventions

Use plain JavaScript compatible with modern browsers and Tampermonkey:

- Two-space indentation.
- `var` declarations, matching the existing script.
- Small, direct functions with descriptive names such as `scrapeCurrentPage`, `readPagerLinks`, and `downloadJson`.
- Uppercase constants for selectors and IDs, for example `SEL_PAGER_LINKS` and `BTN_ID`.

Avoid dependencies, bundlers, or broad abstractions unless the script grows enough to justify them. Comment only non-obvious browser, pagination, or DOM behavior.

For desktop code, use CommonJS modules, two-space indentation, and direct IPC handlers. Keep scraper selectors centralized in `app/webview-preload.js`, BrowserView bounds/control in `app/main.js`, and database behavior centralized in `app/database.js`.

## Testing Guidelines

Run `npm test` for SQLite/import/export changes. Test userscript changes manually in Tampermonkey before opening a pull request.

Verify that:

- The export button appears beside the settings link, or the fallback button appears.
- Pagination is clicked through without duplicate exported URLs.
- JSON and CSV output still include `title`, `url`, `views`, and `likes`.
- Both favourites and watch-later pages produce the expected filenames.
- The desktop app can open Jable, preserve login after restart, sync both collections, and import/export JSON.

## Commit & Pull Request Guidelines

Recent commits use short, imperative summaries, for example `Add Jable Favourites Exporter user script`.

Pull requests should include:

- A concise description of the behavior changed.
- Manual test notes with browser and Tampermonkey versions.
- Screenshots or exported sample shape when UI or output format changes.
- Any known limitations caused by Jable DOM changes.

## Security & Configuration Tips

Keep `@grant none` unless a Tampermonkey API is required. Do not add external network calls, credentials, or tracking. Treat Jable DOM selectors as fragile and update them narrowly when the site changes.
