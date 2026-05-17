# Browser Runtime Specification

Last verified against implementation: 2026-05-17

This document specifies the embedded browser runtime owned by the Electron main process and webview preload.

## Browser Process Model

- The renderer never embeds Jable directly.
- Jable pages run in main-process `WebContentsView` instances.
- Each browser tab has one `WebContentsView`.
- The renderer sends layout bounds to the main process through `browser:set-bounds`.
- When Browser view is hidden, the renderer sends invisible bounds so browser views are detached from the visible area.
- The only renderer-to-main API is `window.jableApp`.
- The only Jable page automation channel is request/response IPC to `app/webview-preload.ts`.
- Pure webview preload parsing, retry, page, and URL helper behavior lives in `app/browser/webview-preload-helpers.ts`.
- Main process code must not call embedded page functions through injected JavaScript strings.

## Session And Origins

- Browser tabs use the persistent Electron session partition `persist:jable-session`.
- Jable cookies are isolated from the default Electron session.
- Trusted Jable origins are:
  - `https://jable.tv`
  - `https://fs1.app`
- The primary origin is `https://jable.tv`.
- The fallback origin is `https://fs1.app`.
- If a primary-origin page load fails, the app can reload the same URL on the fallback origin for the current session.
- Stored video URLs are canonicalized to the primary origin to avoid duplicate local rows across Jable origins.
- Browser navigation accepts only safe `http:` and `https:` URLs.
- Ready managed downloads are streamed back into Jable video pages through the privileged `jable-local-video://` protocol. The protocol is token-based and never exposes local filesystem paths to the page.
- Release URLs opened externally must be GitHub release URLs under `shane-zeng/jable-desktop`.

## Tab Policy

- Normal tabs use background throttling.
- Sync tabs disable background throttling.
- `window.open` and `target=_blank` create app browser tabs.
- Background tab dispositions stay in the background; other dispositions activate the new tab.
- Closing the active tab activates the tab to the right when possible.
- Closing the last active tab falls back to the previous tab.
- Closing an inactive tab does not change the active tab.
- If all normal tabs are closed, the app creates a new home tab.
- Active-tab changes focus the new active `WebContentsView` so repeated shortcuts continue to work.

## Shortcuts And Gestures

- App-specific keyboard and mouse shortcuts are documented in `docs/shortcuts.md`.
- Browser shortcut detection is centralized in `app/browser/browser-tab-policy.ts`.
- Shortcut handling ignores auto-repeat.
- A short debounce prevents duplicate shortcut handling across multiple `webContents`.
- macOS horizontal trackpad gestures inside embedded browser content map to browser back/forward when the target cannot continue horizontal scrolling.
- macOS window swipe gestures also map to browser back/forward.
- Embedded browser middle-click on links opens a new background browser tab.

## Context Menus

- Embedded page context menus are native Electron menus.
- Editable contexts show edit actions such as undo, redo, cut, copy, paste, and select all.
- Non-editable contexts can include:
  - Open link in background
  - Copy link URL
  - Open media in background
  - Copy media URL
  - Copy selection
  - Back
  - Forward
  - Reload
  - New tab
  - Copy current page URL
- Browser tab context menus can include:
  - New tab
  - Switch to tab
  - Reload tab
  - Mute or unmute tab
  - Copy tab URL
  - Compact mode toggle
  - Close tab
- Local library video context menus can include:
  - Open in current tab
  - Open in new tab
  - Copy URL

## Fullscreen Behavior

- HTML fullscreen from embedded Jable pages is handled in the main process.
- Entering fullscreen stretches the active `WebContentsView` over the app chrome.
- Leaving fullscreen restores the renderer-provided browser bounds.
- Fullscreen applies to the active BrowserView, not a separate native app window.

## WebView Enhancement Mode

- Settings includes `WebView Enhancement Mode`, backed by `AppSettings.webViewEnhancementMode`.
- The setting defaults to off. When it is off, the shared Jable session does not apply the optional WebView loading rules, and the webview preload does not run the matching page cleanup rules.
- When enabled, the main process applies a small, Jable-specific loading ruleset on the shared Jable session partition.
- Matching navigations are suppressed before creating app tabs.
- Jable main-frame page navigations and `blob:` media URLs remain untouched by these rules.
- Page cleanup runs in `app/webview-preload.ts` and must preserve collection action buttons when a configured link appears in a shared detail row.
- Settings changes are forwarded to active BrowserView tabs through `settings-changed`, so enabling the mode does not require restarting the app.
- Set `JABLE_DESKTOP_WEBVIEW_ENHANCEMENT_DEBUG=1` to log matching request, navigation, and page cleanup events while testing.

## Update Checks

- The app checks GitHub Releases for newer final releases.
- The latest release endpoint is `https://api.github.com/repos/shane-zeng/jable-desktop/releases/latest`.
- Draft and prerelease releases are ignored.
- Versions must match `vX.Y.Z` or `X.Y.Z`.
- Manual checks from the Help menu or Settings show a no-update or failure dialog.
- Background checks show an update dialog only once per latest version.
- External release opening is guarded by the release URL allowlist.

## Related Files

- `app/main.ts`
- `app/preload.ts`
- `app/webview-preload.ts`
- `app/browser/webview-preload-helpers.ts`
- `app/browser/browser-tab-policy.ts`
- `app/browser/url-policy.ts`
- `app/browser/webview-enhancement.ts`
- `app/browser/webview-content-policy.ts`
- `app/main-process/update-checker.ts`
- `docs/shortcuts.md`

## Related Tests

- `test/node/browser-tab-policy.test.js`
- `test/node/ipc-guardrails.test.js`
- `test/node/webview-preload-helpers.test.js`
- `test/node/url-policy.test.js`
