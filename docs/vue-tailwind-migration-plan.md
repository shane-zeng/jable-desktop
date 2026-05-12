# Vue + TailwindCSS Renderer Migration Plan

## Goal

Migrate the Electron renderer from plain HTML/CSS/JavaScript to Vue 3 + Vite + TailwindCSS while keeping the existing Electron main process, preload API, SQLite database, and scraper behavior stable.

The first migration target is the **本機資料** UI: collection tabs, search/sort controls, quick/full sync controls, pagination, video cards, and hover preview behavior.

## Current State

- `app/main.js` loads `app/renderer/index.html` directly with `BrowserWindow.loadFile`.
- `app/renderer/app.js` owns all renderer state and DOM updates.
- `app/renderer/styles.css` owns all UI styling.
- `app/preload.js` exposes `window.jableApp`; this API should remain the Vue renderer boundary.
- There is no renderer build pipeline today.

## Target Architecture

- Add a Vite-powered Vue renderer source tree under `app/renderer-src/`.
- Build renderer output to `app/renderer-dist/`.
- Update `app/main.js` to load `app/renderer-dist/index.html` in production.
- Keep `app/preload.js` as the only renderer-to-main API surface.
- Keep scraper/database/main-process code outside the Vue migration unless an API adjustment is required.

Proposed source layout:

```text
app/
  renderer-src/
    main.js
    App.vue
    components/
      TopBar.vue
      BrowserPanel.vue
      LibraryPanel.vue
      CollectionTabs.vue
      VideoCard.vue
      PaginationControls.vue
    composables/
      useJableApi.js
      useLibraryState.js
      useBrowserBounds.js
    styles.css
  renderer-dist/
```

## Package And Build Changes

- Add dev dependencies: `vite`, `@vitejs/plugin-vue`, `vue`, `tailwindcss`, `@tailwindcss/vite`.
- Add scripts:
  - `dev:renderer`: run Vite dev server for renderer development.
  - `build:renderer`: build Vue renderer into `app/renderer-dist`.
  - `start`: build renderer first, then start Electron.
  - `start:dev`: run Electron against Vite dev URL.
  - Packaging scripts should run `build:renderer` before `electron-builder`.
- Update `build.files` in `package.json` to include `app/renderer-dist/**/*` and exclude `app/renderer-src/**/*`.

## Electron Loading Strategy

- Development:
  - If an env var such as `JABLE_RENDERER_DEV_URL` is present, `mainWindow.loadURL` points to the Vite dev server.
  - Otherwise, fallback to `loadFile(app/renderer-dist/index.html)`.
- Production:
  - Always load `app/renderer-dist/index.html`.
- Keep BrowserView bounds logic in the renderer via `window.jableApp.setBrowserBounds`.

## Vue Implementation Plan

1. Scaffold Vue + Vite + Tailwind config without changing app behavior.
2. Recreate the existing shell layout in `App.vue`.
3. Move browser view sizing and navigation controls into Vue state/composables.
4. Move local library state into `useLibraryState`:
   - active collection
   - search/sort/direction
   - current page
   - quick/full sync status
   - full sync continuation state
5. Implement `VideoCard.vue`:
   - title link opens video through BrowserView
   - hover over cover lazily loads and plays preview video
   - no separate `Preview` or `Open` text links
6. Replace legacy `app/renderer/index.html`, `app/renderer/app.js`, and `app/renderer/styles.css` after feature parity is confirmed.

## Tailwind Design Rules

- Keep the current utilitarian desktop-app layout.
- Avoid landing-page or marketing-style composition.
- Keep cards compact, scan-friendly, and no more rounded than the current 8px radius.
- Use Tailwind utility classes for layout and state styling.
- Keep reusable component classes only when utility duplication becomes noisy.

## Compatibility And Risks

- `window.jableApp` must remain available under `contextIsolation`.
- Vite output paths must work from `file://` in packaged Electron builds.
- CSP must allow renderer assets and media previews without opening broad script permissions.
- Full sync continuation state remains in-memory only, matching current behavior.
- Packaging must include built renderer files; otherwise production app will open a blank window.

## Test Plan

- Run `npm test`.
- Run `npm run build:renderer`.
- Run `npm start` and smoke test:
  - Browser tab loads and resizes correctly.
  - Local data tab lists favourites and watch-later items.
  - Quick sync and full sync still work.
  - Continue full sync button state still works within the same app session.
  - Search, sorting, pagination, import, and export still work.
  - Cover hover preview still plays only on hover.
- Run unsigned package smoke tests after packaging scripts are updated.

## Rollout Strategy

- Keep the Vue migration in one focused branch.
- Do not change database schema or scraper behavior in the same migration unless required for renderer parity.
- Land after feature parity with the current renderer is verified.
