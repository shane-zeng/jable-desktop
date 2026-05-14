# Shortcuts And Quick Actions

This document inventories the application-specific keyboard shortcuts, mouse shortcuts, and browser gestures currently implemented in Jable Desktop. The last section also lists standard menu behavior provided by Electron `role` menu items.

## Browser Tab Keyboard Shortcuts

| Action                  | macOS                                                         | Windows/Linux                   | Behavior                                                                                              |
| ----------------------- | ------------------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Open a new browser tab  | `Command+T`                                                   | `Ctrl+T`                        | Creates a new Jable home tab and activates it.                                                        |
| Close the current tab   | `Command+W`                                                   | `Ctrl+W`                        | Closes the current browser tab instead of closing the app window; locked sync tabs cannot be closed.  |
| Next browser tab        | `Control+Tab`, `Command+Option+Right`, `Shift+Command+]`      | `Ctrl+Tab`, `Ctrl+PageDown`     | Moves to the next tab on the right in tab rail order, wrapping from the last tab to the first tab.    |
| Previous browser tab    | `Control+Shift+Tab`, `Command+Option+Left`, `Shift+Command+[` | `Ctrl+Shift+Tab`, `Ctrl+PageUp` | Moves to the previous tab on the left in tab rail order, wrapping from the first tab to the last tab. |
| Toggle compact tab mode | `Command+S`                                                   | `Ctrl+S`                        | Toggles tab rail compact mode only when the current top-level view is Browser.                        |

## Mouse Shortcuts

| Location                    | Shortcut                                          | Behavior                                                                         |
| --------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------- |
| Embedded browser page links | Middle-click a link                               | Opens the link in a new background browser tab and keeps the current tab active. |
| Local Data video cards      | Middle-click the thumbnail or title               | Opens the video page in a new browser tab and activates it.                      |
| Local Data video cards      | macOS `Command+Click` the thumbnail or title      | Opens the video page in a new browser tab and activates it.                      |
| Local Data video cards      | Windows/Linux `Ctrl+Click` the thumbnail or title | Opens the video page in a new browser tab and activates it.                      |

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
- Tab-switching helpers live in `app/browser-tab-policy.js`; main-process behavior lives in `app/main.js`.
- Embedded browser middle-click new-tab behavior lives in `app/webview-preload.js`; Local Data video-card new-tab behavior lives in `app/renderer-src/components/VideoCard.vue`.
- Electron menu role defaults follow the Electron documentation: <https://www.electronjs.org/docs/latest/tutorial/menus>.
