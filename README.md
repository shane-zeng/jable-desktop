# Jable Desktop

> A Tampermonkey user script and Electron desktop app to export, sync, and browse favourite or watch-later videos from [Jable.tv](https://jable.tv/) — even when pagination is loaded dynamically.

Jable Desktop is an unofficial desktop companion for Jable.

The original userscript remains available as `jable-favourites-exporter.user.js`. The desktop app adds a persistent embedded browser session and SQLite storage.

---

## 📦 Features

✅ Export all items across multiple pages (auto-click pagination).
✅ Supports both **「影片收藏」** and **「稍後觀看」** pages.
✅ Works even when Jable uses AJAX to load content (no API access needed).
✅ Output format: **JSON** (default) or **CSV** (toggleable).
✅ Compatible with modern browsers (Chrome / Edge / Firefox).
✅ No external dependencies for the userscript.
✅ Desktop MVP stores synced data in SQLite and supports JSON import/export.

---

## 🚀 Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Visit the script file: jable-favourites-exporter.user.js
3. Tampermonkey will prompt to install the script — click **Install**.

---

## 🧭 Usage

1. Go to your Jable account:
- **影片收藏** → `https://jable.tv/my/favourites/videos/`
- **稍後觀看** → `https://jable.tv/my/favourites/videos-watch-later/`
2. Wait until all thumbnails are loaded.
3. Click the **「匯出全部」** button (next to ⚙️ 設定).
4. The script will:
- Simulate clicking each pagination button.
- Collect video titles and URLs.
- Export a JSON or CSV file automatically.

---

## 💾 Output Files

| Page | URL | Output filename |
|------|-----|-----------------|
| 影片收藏 | `https://jable.tv/my/favourites/videos/` | `favourites_list.json` (or `.csv`) |
| 稍後觀看 | `https://jable.tv/my/favourites/videos-watch-later/` | `watch_later_list.json` (or `.csv`) |

You can change export format by editing this line in the script:
```js
var EXPORT_FORMAT = 'json'; // or 'csv'
```

---

## 🖥️ Desktop App MVP

The desktop app keeps a persistent Jable browser session and stores synced data in SQLite.

```sh
npm install
npm start
```

Log in inside the embedded browser, open **影片收藏** or **稍後觀看**, then click **同步**. The SQLite database path is shown in the right panel.

Desktop app files:

- `app/main.js`: Electron main process and IPC handlers.
- `app/webview-preload.js`: scraper injected into the embedded Jable `BrowserView`.
- `app/database.js`: SQLite schema, upsert logic, JSON import/export.
- `app/renderer/`: desktop UI.

### Desktop Validation

```sh
npm test
```

Manual checks:

- Restart the app and confirm the embedded browser stays logged in.
- Sync both favourites and watch-later lists.
- Import an existing userscript JSON export and verify rows appear in the matching tab.
- Export JSON and confirm the `{ data: [...], meta: {...} }` shape is preserved.

### Desktop Packaging

Install the packaging tool once:

```sh
npm install --save-dev electron-builder
```

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

Unsigned artifacts are only for local validation. The desktop app uses `io.github.shane-zeng.jable-desktop` as its stable app ID. For public distribution, add real icons and configure platform signing before sharing installers.

#### macOS Developer ID signing and notarization

Prerequisites:

- Apple Developer Program membership.
- A `Developer ID Application` certificate installed in the local keychain.
- Notarization credentials, preferably an App Store Connect API key.

Local release build:

```sh
export CSC_NAME="Developer ID Application: Your Name (TEAMID)"
export APPLE_API_KEY="/absolute/path/AuthKey_KEYID.p8"
export APPLE_API_KEY_ID="KEYID"
export APPLE_API_ISSUER="issuer-uuid"
npm run dist:mac
```

Useful verification commands:

```sh
codesign --verify --deep --strict --verbose=2 "release/mac/Jable Desktop.app"
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/Jable Desktop.app"
xcrun stapler validate "release/mac/Jable Desktop.app"
xcrun stapler validate "release/mac-arm64/Jable Desktop.app"
spctl --assess --type execute --verbose "release/mac/Jable Desktop.app"
spctl --assess --type execute --verbose "release/mac-arm64/Jable Desktop.app"
```

#### Windows code signing

Prerequisites:

- An OV/EV code signing certificate exported as `.pfx`, or a compatible signing service.
- The certificate password stored outside the repository.

Local release build with a `.pfx` certificate:

```sh
export WIN_CSC_LINK="/absolute/path/windows-code-signing-cert.pfx"
export WIN_CSC_KEY_PASSWORD="certificate-password"
npm run dist:win
```

On Windows, verify the installer signature with PowerShell:

```powershell
Get-AuthenticodeSignature .\release\Jable-Desktop-0.2.0-win-x64.exe
```

Windows SmartScreen can still warn on early downloads until the signed file gains reputation.
