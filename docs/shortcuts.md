# Shortcuts And Quick Actions

This document inventories the application-specific keyboard shortcuts, mouse shortcuts, and browser gestures currently implemented in Jable Desktop. Settings > Shortcuts shows the user-facing, platform-specific subset from the app shortcut catalog. The last section also lists standard menu behavior provided by Electron `role` menu items.

## Top-Level View Keyboard Shortcuts

| Action               | macOS       | Windows/Linux | Behavior                       |
| -------------------- | ----------- | ------------- | ------------------------------ |
| Switch to Browser    | `Command+1` | `Ctrl+1`      | Activates the Browser view.    |
| Switch to Local Data | `Command+2` | `Ctrl+2`      | Activates the Local Data view. |
| Switch to Settings   | `Command+3` | `Ctrl+3`      | Activates the Settings view.   |

## Browser Tab Keyboard Shortcuts

| Action                  | macOS                                                         | Windows/Linux                         | Behavior                                                                                              |
| ----------------------- | ------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Open a new browser tab  | `Command+T`                                                   | `Ctrl+T`                              | Creates a new Jable home tab and activates it.                                                        |
| Close the current tab   | `Command+W`                                                   | `Ctrl+W`                              | Closes the current browser tab instead of closing the app window; locked sync tabs cannot be closed.  |
| Reload current tab      | `Command+R`, `F5`                                             | `Ctrl+R`, `F5`                        | Reloads the active browser tab.                                                                       |
| Hard reload current tab | `Command+Shift+R`, `Command+Option+R`, `Shift+F5`             | `Ctrl+Shift+R`, `Ctrl+F5`, `Shift+F5` | Reloads the active browser tab while bypassing cache.                                                 |
| Next browser tab        | `Control+Tab`, `Command+Option+Right`, `Shift+Command+]`      | `Ctrl+Tab`, `Ctrl+PageDown`           | Moves to the next tab on the right in tab rail order, wrapping from the last tab to the first tab.    |
| Previous browser tab    | `Control+Shift+Tab`, `Command+Option+Left`, `Shift+Command+[` | `Ctrl+Shift+Tab`, `Ctrl+PageUp`       | Moves to the previous tab on the left in tab rail order, wrapping from the first tab to the last tab. |
| Toggle compact tab mode | `Command+S`                                                   | `Ctrl+S`                              | Toggles tab rail compact mode only when the current top-level view is Browser.                        |
| Toggle shared tab rail  | `Command+Shift+S`                                             | `Ctrl+Shift+S`                        | Toggles shared tab rail mode when the current top-level view is Browser or Local Data.                |
| Toggle Theater Mode     | `T`                                                           | `T`                                   | Toggles theater mode on trusted Jable video pages when focus is not in an editable field.             |
| Exit Theater Mode       | `Esc`                                                         | `Esc`                                 | Leaves theater mode for the current browser tab without changing HTML fullscreen behavior.            |

## Mouse Shortcuts

| Location                    | Shortcut                                          | Behavior                                                                          |
| --------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| Embedded browser page links | Middle-click a link                               | Opens the link in a new background browser tab and keeps the current tab active.  |
| Theater mode                | Click the in-content `x` button                   | Leaves theater mode for the current browser tab.                                  |
| Local Data shared tab rail  | New Tab button                                    | Creates a new background Jable home tab and keeps Local Data active.              |
| Local Data video cards      | Middle-click the thumbnail or title               | Opens the video page in a new background browser tab and keeps Local Data active. |
| Local Data video cards      | macOS `Command+Click` the thumbnail or title      | Opens the video page in a new background browser tab and keeps Local Data active. |
| Local Data video cards      | Windows/Linux `Ctrl+Click` the thumbnail or title | Opens the video page in a new background browser tab and keeps Local Data active. |

## Context Menu Quick Actions

| Location                  | Action       | Behavior                                                                                                                                                                        |
| ------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Jable video browser pages | Theater Mode | Toggles a tab-scoped large player inside the current browser content area without entering fullscreen or covering the app top bar/tab rail; the in-content `x` button exits it. |

## Browser Gestures

| Platform | Gesture                                                     | Behavior                                                                                                                                               |
| -------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| macOS    | Horizontal trackpad gesture inside embedded browser content | Triggers browser history back or forward based on direction; if the target element can still scroll horizontally, page-level scrolling takes priority. |
| macOS    | App window `swipe right` / `swipe left`                     | `right` triggers browser history back; `left` triggers browser history forward.                                                                        |

## Standard Menu Shortcuts

These items are provided through Electron menu `role` entries. Labels and accelerators use Electron / OS defaults per platform, so the app menu is the source of truth for what is displayed at runtime.

| Menu       | Role               | Common Shortcut                                                          |
| ---------- | ------------------ | ------------------------------------------------------------------------ |
| Edit       | `undo`             | `Command+Z` / `Ctrl+Z`                                                   |
| Edit       | `redo`             | `Command+Shift+Z` / `Ctrl+Shift+Z` or the platform default redo shortcut |
| Edit       | `cut`              | `Command+X` / `Ctrl+X`                                                   |
| Edit       | `copy`             | `Command+C` / `Ctrl+C`                                                   |
| Edit       | `paste`            | `Command+V` / `Ctrl+V`                                                   |
| Edit       | `selectAll`        | `Command+A` / `Ctrl+A`                                                   |
| View       | `reload`           | `Command+R` / `Ctrl+R`                                                   |
| View       | `forceReload`      | `Command+Shift+R` / `Ctrl+Shift+R`                                       |
| View       | `toggleDevTools`   | `Command+Option+I` / `Ctrl+Shift+I`                                      |
| View       | `resetZoom`        | `Command+0` / `Ctrl+0`                                                   |
| View       | `zoomIn`           | `Command+Plus` / `Ctrl+Plus`                                             |
| View       | `zoomOut`          | `Command+-` / `Ctrl+-`                                                   |
| View       | `togglefullscreen` | `Control+Command+F` / `F11`                                              |
| Window     | `minimize`         | Platform default minimize shortcut                                       |
| Window     | `zoom`             | macOS platform zoom shortcut                                             |
| Window     | `front`            | macOS window front menu                                                  |
| App / File | `quit`             | `Command+Q` / `Ctrl+Q`                                                   |

## Implementation Notes

- Browser tab keyboard shortcuts are registered through Electron `before-input-event` on each relevant `webContents`, including the renderer and every BrowserView.
- The shortcut handler ignores auto-repeat and uses a short debounce to avoid handling the same keypress from multiple `webContents`.
- After a successful tab switch, focus is moved to the new active BrowserView so repeated tab-switching shortcuts continue to work.
- Tab-switching, opener-group new-tab placement, close activation, and reload shortcut helpers live in `app/browser/browser-tab-policy.ts`; main-process shortcut wiring lives in `app/main-process/browser/shortcut-manager.ts`.
- Settings > Shortcuts renders its platform-specific user-facing list from `app/renderer-src/shortcut-catalog.ts`. When shortcut behavior changes, update this document, the catalog, implementation, and focused tests in the same change.
- Theater mode can be toggled from the context menu or with plain `T` on trusted Jable video pages, and can be left with `Esc` or the in-content `x` button. `Command+T` / `Ctrl+T` still opens a new browser tab, and editable fields keep normal text input.
- Embedded browser middle-click new-tab behavior lives in `app/webview-preload.ts`; Local Data video-card new-tab gestures originate in `app/renderer-src/components/VideoCard.vue`, and `app/renderer-src/App.vue` decides whether the created browser tab is activated.
- Electron menu role defaults follow the Electron documentation: <https://www.electronjs.org/docs/latest/tutorial/menus>.
