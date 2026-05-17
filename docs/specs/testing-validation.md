# Testing And Validation Specification

Last verified against implementation: 2026-05-17

This document maps current functionality to automated and manual validation.

## Standard Quality Gates

Use Node.js 24. If the shell is not already using Node 24, run npm commands through `fnm exec --using 24`.

Recommended full gate:

```sh
fnm exec --using 24 npm run check
```

Targeted gates:

```sh
fnm exec --using 24 npm run format:check
fnm exec --using 24 npm run lint
fnm exec --using 24 npm run typecheck
fnm exec --using 24 npm test
fnm exec --using 24 npm run test:renderer
fnm exec --using 24 npm run rust:ci
fnm exec --using 24 npm run test:electron
```

## Automated Coverage Map

| Area                                                                                          | Tests                                       |
| --------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Rust data engine migrations, sync visibility, search, import/export, streamed export, toggles | `test/node/database.test.js`                |
| Rust data-engine IPC contract                                                                 | `test/node/data-engine-contract.test.js`    |
| Rust-native data invariants                                                                   | `native/local-data-engine/src/tests.rs`     |
| Pagination helper behavior                                                                    | `test/node/sync-utils.test.js`              |
| URL trust, fallback rewrites, release URL allowlist                                           | `test/node/url-policy.test.js`              |
| Browser tab policy, media serialization, shortcut detection                                   | `test/node/browser-tab-policy.test.js`      |
| Settings normalization and persistence                                                        | `test/node/settings.test.js`                |
| Download asset persistence and normalization                                                  | `test/node/data-engine-contract.test.js`    |
| HLS playlist extraction, parsing, and request header helpers                                  | `test/node/download-helpers.test.js`        |
| Rust native download engine adaptive concurrency, playlist generation, build/check/clippy     | `npm run rust:ci`                           |
| IPC payload normalization                                                                     | `test/node/ipc-normalizers.test.js`         |
| Desktop i18n key parity and fallback behavior                                                 | `test/node/i18n.test.js`                    |
| Userscript i18n guardrails                                                                    | `test/node/userscript-i18n.test.js`         |
| Update checking                                                                               | `test/node/update-checker.test.js`          |
| Ad request blocking                                                                           | `test/node/ad-blocker.test.js`              |
| Cosmetic ad filtering                                                                         | `test/node/ad-cosmetic-policy.test.js`      |
| Webview preload pure helpers                                                                  | `test/node/webview-preload-helpers.test.js` |
| Main/preload IPC guardrails                                                                   | `test/node/ipc-guardrails.test.js`          |
| Renderer i18n                                                                                 | `test/renderer/i18n/index.test.ts`          |
| Renderer components                                                                           | `test/renderer/components/*.test.ts`        |
| Renderer composables                                                                          | `test/renderer/composables/*.test.ts`       |
| Electron startup, preload bridge, settings IPC, tab IPC, import/export smoke                  | `test/electron/app-smoke.test.js`           |

## Change-Specific Test Selection

- Userscript UI or localization changes: run userscript i18n tests and manually test Tampermonkey pages.
- Renderer UI changes: run renderer tests, typecheck, and renderer build.
- Main-process browser/tab changes: run browser tab policy tests, IPC guardrail tests, and Electron smoke tests.
- IPC payload normalization changes: run IPC normalizer tests, IPC guardrail tests, typecheck, and Electron smoke tests when handler wiring changes.
- Webview preload helper changes: run webview helper tests, IPC guardrail tests, and Node tests covering URL/sync helper behavior.
- URL policy or release URL changes: run URL policy and update checker tests.
- Settings changes: run settings tests plus renderer SettingsPanel tests.
- Download List, FFmpeg, native download engine, pause/resume, or download pipeline changes: run download Node tests, `npm run rust:ci`, renderer component/composable tests, typecheck, lint, and renderer build. Run Electron smoke tests when IPC handler wiring, app-close behavior, or shell/file boundary behavior changes.
- Search, migrations, sync visibility, outbox, pending remote, or import/export changes: run Node database tests, data-engine contract tests, and Rust tests.
- Rust-native data-engine invariant changes: update and run `native/local-data-engine/src/tests.rs` through `fnm exec --using 24 npm run rust:ci`.
- Documentation-only changes: run `fnm exec --using 24 npm run format:check`.

## Manual Desktop Validation

Verify these behaviors when touching related desktop areas:

- App starts and opens a Jable home tab.
- Jable login persists across restart while the server-side session remains valid.
- Primary-origin load failure falls back to `https://fs1.app` and local storage still canonicalizes video URLs.
- Browser tabs open, switch, close, mute, right-click, and preserve active-tab policy.
- Compact tab mode can be toggled and persists through Settings.
- Tab rail width can be resized and reset.
- `target=_blank` and `window.open` create app tabs.
- Middle-click in embedded browser opens links in background tabs.
- HTML fullscreen covers the app chrome and restores normal bounds after exit.
- Browser context menus show correct link, media, selection, navigation, and page URL actions.
- Local video cards open in current tab, open in new tab through middle/platform click, and show context menu actions.
- Local video cards show compact download states and do not expose detailed progress or error text.
- Local video cards can be explicitly selected and the selected set can be queued for download without downloading the whole current page.
- Missing FFmpeg blocks download start/retry and Download List shows setup-required state.
- Settings can change the maximum active video downloads value and the queue starts additional active downloads up to that limit.
- Settings can re-check FFmpeg, choose a manual FFmpeg binary, clear the manual path, choose a download folder, and open the download folder.
- Download List renders queued, downloading, paused, failed, ready, and missing rows.
- Ready downloads open through the OS default player and can be revealed in the OS file manager.
- Failed and missing downloads can be retried.
- Queued and active downloads can be paused or canceled.
- Paused downloads can be resumed without restarting from zero when preserved segments are compatible.
- Closing or quitting the app with queued or active downloads prompts to pause downloads before closing.
- Force quit or crash recovery reconciles orphaned queued/downloading records to paused on next launch/listing.
- Deleting a Download List item removes the local managed file and download record without changing collection membership.
- Re-syncing Favourites or Watch Later does not remove local download records.
- Quick sync updates existing data without hiding unscanned rows.
- Full sync rebuilds site order and hides rows missing from a completed run.
- Incomplete full sync does not hide missing rows.
- AJAX full sync completes or falls back to sequential paging without data loss.
- Collection toggles outside sync update local visibility after site success.
- Collection toggles during sync enter Pending Sync and do not alter normal local visibility until remote success.
- Pending Sync Add, Remove, and Resolved actions behave explicitly.
- JSON import requires a final target collection.
- JSON export preserves the `{ data, meta }` paged resource shape and `site_order`.
- Language switching updates renderer copy, native menus, context menus, dialogs, and toast messages.

## Manual Userscript Validation

Verify these pages in Tampermonkey when touching the userscript:

- `https://jable.tv/my/favourites/videos/`
- `https://jable.tv/my/favourites/videos-watch-later/`
- `https://fs1.app/my/favourites/videos/`
- `https://fs1.app/my/favourites/videos-watch-later/`

Expected checks:

- Floating export UI appears only on supported collection pages.
- Locale selector switches between Traditional Chinese, English, and Japanese.
- Progress and error labels follow the selected locale.
- Pagination advances without duplicate exported URLs.
- JSON output includes paged `data` and `meta`.
- CSV output includes `title,url,views,likes,img,preview`.
- Favourites export uses `favourites_list`.
- Watch-later export uses `watch_later_list`.
- Long exports preserve or migrate cache state through IndexedDB or localStorage fallback.

## Documentation Validation

- Specs should be updated in the same change as behavior changes.
- English specs in `docs/specs/*.md` are source-of-truth documents.
- Any `docs/specs/*.local.md` files are ignored local reading copies for other languages.
- Verify ignored local copies with:

```sh
git status --short --ignored docs/specs
```
