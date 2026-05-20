# Testing And Validation Specification

Last verified against implementation: 2026-05-18

This document maps current functionality to automated and manual validation.

## Standard Quality Gates

Use Node.js 24. If the shell is not already using Node 24, run npm commands through `fnm exec --using 24`.

Recommended full gate:

```sh
fnm exec --using 24 npm run check
```

Targeted gates:

Electron smoke is intentionally excluded from the recommended full gate. Run it only when a change touches the Electron boot path, BrowserWindow/WebContentsView setup, preload bridge exposure, protocol/session setup, or main/preload IPC registration wiring.

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
| Download Manager orchestration, speed modes, failure classification, sanitization             | `test/node/download-manager.test.js`        |
| Rust native download engine adaptive concurrency, playlist generation, build/check/clippy     | `npm run rust:ci`                           |
| IPC payload normalization                                                                     | `test/node/ipc-normalizers.test.js`         |
| Desktop i18n key parity and fallback behavior                                                 | `test/node/i18n.test.js`                    |
| Userscript i18n guardrails                                                                    | `test/node/userscript-i18n.test.js`         |
| Update checking                                                                               | `test/node/update-checker.test.js`          |
| WebView enhancement loading rules                                                             | `test/node/webview-enhancement.test.js`     |
| WebView content cleanup rules                                                                 | `test/node/webview-content-policy.test.js`  |
| Webview preload pure helpers                                                                  | `test/node/webview-preload-helpers.test.js` |
| Main/preload IPC guardrails                                                                   | `test/node/ipc-guardrails.test.js`          |
| Renderer i18n                                                                                 | `test/renderer/i18n/index.test.ts`          |
| Renderer components                                                                           | `test/renderer/components/*.test.ts`        |
| Renderer composables                                                                          | `test/renderer/composables/*.test.ts`       |
| Electron startup, preload bridge, settings IPC reachability, initial tab state                | `test/electron/app-smoke.test.js`           |

## Change-Specific Test Selection

- Userscript UI or localization changes: run userscript i18n tests and manually test Tampermonkey pages.
- Renderer UI changes: run renderer tests, typecheck, and renderer build.
- Main-process browser/tab changes: run browser tab policy tests and IPC guardrail tests. Run Electron smoke tests only when startup or tab-manager wiring changes.
- IPC payload normalization changes: run IPC normalizer tests, IPC guardrail tests, and typecheck. Run Electron smoke tests only when main/preload handler registration wiring changes.
- Webview preload helper changes: run webview helper tests, IPC guardrail tests, and Node tests covering URL/sync helper behavior.
- URL policy or release URL changes: run URL policy and update checker tests.
- Settings changes: run settings tests plus renderer SettingsPanel tests.
- Download List, FFmpeg, native download engine, speed modes, failure metadata, pause/resume, or download pipeline changes: run download Node tests, `npm run rust:ci`, renderer component/composable tests, typecheck, lint, and renderer build. Run Electron smoke tests only when the change also touches Electron startup, preload exposure, protocol/session setup, or main/preload IPC registration wiring.
- Search, migrations, sync visibility, outbox, pending remote, or import/export changes: run Node database tests, data-engine contract tests, and Rust tests.
- Rust-native data-engine invariant changes: update and run `native/local-data-engine/src/tests.rs` through `fnm exec --using 24 npm run rust:ci`.
- Documentation-only changes: run `fnm exec --using 24 npm run format:check`.

## Manual Desktop Validation

Verify these behaviors when touching related desktop areas:

- App starts and opens a Jable home tab.
- Jable login persists across restart while the server-side session remains valid.
- Primary-origin load failure falls back to `https://fs1.app` and local storage still canonicalizes video URLs.
- Browser tabs open, switch, close, mute, right-click, and preserve active-tab policy.
- Tab rail display mode can be changed through Settings and shortcuts, including shared mode.
- Tab rail width can be resized and reset.
- `target=_blank` and `window.open` create app tabs.
- Middle-click in embedded browser opens links in background tabs.
- HTML fullscreen covers the app chrome and restores normal bounds after exit.
- Browser context menus show correct link, media, selection copy, Google search, navigation, and page URL actions.
- Jable video pages with ready managed downloads automatically switch the page video element to local playback. If the switch happens while the user is already watching, the preload preserves the current playback position and resumes only when the video was already playing; missing, failed, queued, or unavailable downloads keep normal Jable playback. If a ready local playback file is deleted while the page is using it, the page reloads so Jable rebuilds its own player.
- In shared tab rail mode, Local Data new-tab actions create background browser tabs without switching away from Local Data.
- Local video cards open in current tab, open in background new tabs through middle/platform click, and show context menu actions.
- Local video cards show compact download states and do not expose detailed progress or error text.
- Local video cards can be explicitly selected and the selected set can be queued for download without downloading the whole current page.
- Local video card Select All selects only visible downloadable cards and skips already downloaded, queued, or active downloads.
- Local video card download-state filtering can show downloadable rows without including queued, active, or ready downloads, and can show only ready downloaded rows.
- Missing FFmpeg blocks download start/retry and Download List shows setup-required state.
- Settings can change the maximum active video downloads value and the queue starts additional active downloads up to that limit.
- Settings can switch download speed mode between Stable, Balanced, and Fast without changing the maximum active video downloads value.
- Settings can toggle playback-triggered auto-download; it defaults off, and only user-initiated video playback should create a Download List record and write managed segment files. Page preload of a playlist, restored-tab autoplay, reload autoplay, or script-started playback must not start a persisted download.
- Turning playback-triggered auto-download off pauses existing `playback_auto` queued/background/capture work without affecting formal `normal` downloads, and stale playback-background queue items must not start later while the setting is off.
- Active playback-triggered downloads can be paused, canceled, or deleted from the Download List. Pause preserves reusable segments and stops further capture writes; cancel removes working segment files and leaves a failed canceled record; delete removes the record/files and prevents the still-open playback token from recreating them.
- A simple playback-triggered pause can auto-download again after page refresh and playback. Once the user resumes that paused capture into the normal downloader and pauses it again, refreshed playback must not restart auto-download until the user explicitly resumes, retries, or enqueues it.
- Formal `normal` download records that are paused, failed, missing, or canceled must not be restarted by video-page playback. They restart only through explicit Resume, Retry, or Download actions.
- Settings can re-check FFmpeg, choose a manual FFmpeg binary, clear the manual path, choose a download folder, and open the download folder.
- Download List renders queued, downloading, paused, failed, ready, and missing rows.
- Download List multi-select filters can show or combine All, Ready, Downloading, Queued, Paused, Failed, and Missing states, and the selection survives app restart.
- Ready downloads open through the OS default player and can be revealed in the OS file manager.
- Ready downloads can also be streamed through the app's local playback protocol with byte-range seeking.
- Failed and missing downloads can be retried.
- Retry Failed queues failed and missing records without duplicating ready, queued, or active records.
- Queued and active downloads can be paused individually, and Queue Actions > Pause All moves queued and active records to paused without deleting preserved segments.
- Paused downloads can be resumed individually, and Queue Actions > Resume All queues paused records through the normal segment-level resume path.
- Queued downloads can be canceled individually, and Cancel Queued marks queued records failed with the canceled message without deleting ready files.
- Delete Selected only applies to visible selected eligible Download List records and does not modify collection membership or Jable remote state.
- Download Error Log is hidden from the toolbar, opens from Download List diagnostics shortcuts, defaults to the most recent 100 failed/missing records, and shows sanitized detail without signed URLs, cookies, HLS keys, or full download-root paths.
- Paused downloads can be resumed without restarting from zero when preserved segments are compatible.
- Segment failures from refreshable HTTP/CDN rejection statuses refresh the video page and playlist once, then retry only when the existing work is compatible.
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
