# Jable Desktop

Unofficial desktop app for syncing, browsing, importing, and exporting your Jable favourites and watch-later lists.

- [繁體中文](#繁體中文)
- [English](#english)

---

## 繁體中文

Jable Desktop 會在桌面 App 內開啟 Jable，保留登入狀態，並把「影片收藏」與「稍後觀看」同步到本機資料庫。你可以在 App 裡瀏覽、排序、匯入既有 JSON，也可以再匯出備份。

### 主要功能

- 同步 **影片收藏** 與 **稍後觀看**。
- 保留 Jable 登入狀態，下次開啟不用重新登入。
- 將資料儲存在你的電腦本機。
- 支援 JSON 匯入與匯出。
- 記錄播放進度，方便之後接續觀看。

### 安裝

1. 到 [GitHub Releases](https://github.com/shane-zeng/jable-desktop/releases) 下載最新版本。
2. macOS 使用者下載 `.dmg` 或 `.zip`。
3. Windows 使用者下載 `.exe` 安裝檔或 `.zip`。
4. 開啟 **Jable Desktop**。

### 第一次使用

1. 在 App 左側的內嵌瀏覽器登入 Jable。
2. 打開 **影片收藏** 或 **稍後觀看** 頁面。
3. 點擊 **同步**。
4. 同步完成後，右側清單會顯示已儲存的影片。

### 匯入與匯出

- 點擊 **匯出** 可將目前清單備份成 JSON。
- 點擊 **匯入** 可載入先前匯出的 JSON。
- 舊版 Tampermonkey userscript 匯出的 JSON 也可以匯入。

### 資料與隱私

Jable Desktop 只會把同步資料儲存在你的電腦本機。App 不會把你的清單、登入資訊或觀看紀錄上傳到其他服務。

### 常見問題

**同步後沒有資料**

先確認內嵌瀏覽器已登入 Jable，並且目前頁面是 **影片收藏** 或 **稍後觀看**。

**重新開啟後需要登入**

請確認你使用的是桌面 App，不是瀏覽器 userscript。桌面 App 使用自己的持久化 Jable session。

**Windows 仍出現 SmartScreen 提示**

目前的 Windows 版本是 unsigned build，SmartScreen 可能會提示。請確認檔案來源是本專案的 [GitHub Release](https://github.com/shane-zeng/jable-desktop/releases)。

### 瀏覽器 Userscript

如果你只想在瀏覽器內匯出清單，也可以使用 `jable-favourites-exporter.user.js` 搭配 Tampermonkey。桌面 App 則適合需要長期同步、瀏覽與備份的人。

### 開發文件

開發、測試、打包與 release 流程請看 [docs/development.md](docs/development.md)。

---

## English

Jable Desktop opens Jable inside a desktop app, keeps your login session, and syncs your favourites and watch-later lists into a local database. You can browse, sort, import existing JSON files, and export backups from the app.

### Features

- Sync **Favourites** and **Watch Later**.
- Keep your Jable login session between app launches.
- Store synced data locally on your computer.
- Import and export JSON backups.
- Save playback progress so you can resume later.

### Installation

1. Download the latest build from [GitHub Releases](https://github.com/shane-zeng/jable-desktop/releases).
2. On macOS, download the `.dmg` or `.zip`.
3. On Windows, download the `.exe` installer or `.zip`.
4. Open **Jable Desktop**.

### First Use

1. Sign in to Jable in the embedded browser on the left.
2. Open the **Favourites** or **Watch Later** page.
3. Click **Sync**.
4. After syncing finishes, saved videos appear in the list on the right.

### Import And Export

- Click **Export** to back up the current list as JSON.
- Click **Import** to load a previously exported JSON file.
- JSON files exported by the older Tampermonkey userscript can also be imported.

### Data And Privacy

Jable Desktop stores synced data locally on your computer. The app does not upload your lists, login data, or playback history to any external service.

### Troubleshooting

**No videos appear after syncing**

Make sure the embedded browser is signed in to Jable and currently opened on the **Favourites** or **Watch Later** page.

**The app asks me to sign in again**

Make sure you are using the desktop app, not the browser userscript. The desktop app uses its own persistent Jable session.

**Windows still shows a SmartScreen warning**

The current Windows build is unsigned, so SmartScreen may show a warning. Make sure the file came from this project's [GitHub Release](https://github.com/shane-zeng/jable-desktop/releases).

### Browser Userscript

If you only want to export from the browser, you can still use `jable-favourites-exporter.user.js` with Tampermonkey. The desktop app is better for ongoing sync, browsing, and backups.

### Development Docs

For development, testing, packaging, and release details, see [docs/development.md](docs/development.md).
