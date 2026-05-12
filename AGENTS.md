# Repository Guidelines

## Project Structure & Module Organization

This repository contains a Tampermonkey userscript and an Electron desktop MVP for exporting Jable favourites and watch-later entries.

- `jable-favourites-exporter.user.js`: main userscript with metadata, configuration, scraping helpers, pagination, download logic, and UI injection.
- `app/main.js`: Electron main process, window creation, persistent session management, and IPC handlers.
- `app/webview-preload.js`: scraper injected into the embedded Jable `BrowserView`.
- `app/database.js`: SQLite schema, upsert logic, sync state, and JSON import/export.
- `app/renderer-src/`: Vue 3 + TailwindCSS renderer source.
- `app/renderer-dist/`: Vite-built renderer loaded by Electron and packaged for release.
- `app/renderer/`: legacy plain renderer kept for reference during the migration.
- `test/`: Node test files for storage and import/export behavior.
- `README.md`: installation and usage documentation for end users.
- `AGENTS.md`: contributor guidance for future maintenance.

Keep the userscript self-contained. Put desktop-only code under `app/` and tests under `test/`.

## Build, Test, and Development Commands

The userscript has no build step. Edit it directly and validate it in Tampermonkey.

- `ll`: inspect repository files.
- `cat jable-favourites-exporter.user.js`: review the userscript.
- `grep "EXPORT_FORMAT" jable-favourites-exporter.user.js`: find configuration or implementation details.
- `npm install`: install Electron and renderer development dependencies.
- `npm run build:renderer`: build the Vue renderer into `app/renderer-dist/`.
- `npm run dev:renderer`: run the Vite renderer dev server.
- `npm start`: build the renderer, then run the desktop app.
- `npm run start:dev`: run Electron against the Vite dev server.
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

For desktop main/preload/database code, use CommonJS modules, two-space indentation, and direct IPC handlers. Keep scraper selectors centralized in `app/webview-preload.js` and database behavior centralized in `app/database.js`.

For renderer code, use Vue single-file components under `app/renderer-src/`, Tailwind utilities for layout and state styling, and `window.jableApp` as the only renderer-to-main boundary. Keep BrowserView sizing logic in `app/renderer-src/composables/useBrowserBounds.js`.

## Testing Guidelines

Run `npm test` for SQLite/import/export changes. Run `npm run build:renderer` for renderer changes. Test userscript changes manually in Tampermonkey before opening a pull request.

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
