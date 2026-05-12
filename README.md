# Jable Desktop

Unofficial desktop app for syncing, browsing, importing, and exporting your Jable favourites and watch-later lists.

- [繁體中文](#繁體中文)
- [English](#english)

---

## 繁體中文

Jable Desktop 是非官方桌面工具，與 Jable 官方沒有關聯。它會在 App 內開啟 Jable，將「影片收藏」與「稍後觀看」同步到你的電腦本機，方便瀏覽、排序、匯入與匯出備份。

### 主要功能

- 同步 **影片收藏** 與 **稍後觀看**。
- 使用內嵌瀏覽器登入 Jable，並在本機保存登入所需資料。
- 將同步資料儲存在你的電腦本機。
- 支援 JSON 匯入與匯出。

### 安裝

1. 到 [GitHub Releases](https://github.com/shane-zeng/jable-desktop/releases) 下載最新版本。
2. macOS 使用者下載 `.dmg` 或 `.zip`。
3. Windows 使用者下載 `.exe` 安裝檔或 `.zip`。
4. 開啟 **Jable Desktop**。

目前發佈檔尚未做正式簽章。macOS 可能出現 Gatekeeper 提示，Windows 可能出現 SmartScreen 提示；請確認檔案來源是本專案的 GitHub Release。

### 第一次使用

1. 在 **瀏覽器** 頁籤登入 Jable。
2. 開啟 Jable 的 **影片收藏** 或 **稍後觀看** 頁面。
3. 切到 **本機資料** 頁籤。
4. 點擊 **同步目前 Jable 頁面**。
5. 同步完成後，影片會出現在本機清單中。

### 匯入與匯出

- 點擊 **匯出 JSON** 可將目前清單備份成 JSON。
- 點擊 **匯入 JSON** 可載入先前匯出的 JSON。
- 舊版 Tampermonkey userscript 匯出的 JSON 也可以匯入。

### 資料與登入狀態

同步資料會儲存在你的電腦本機。App 不會把你的清單上傳到其他服務；你在內嵌瀏覽器中的登入與瀏覽仍會直接與 Jable 官方網站互動。

App 會保存 Jable 的本機登入資料，所以一般重開 App 後仍可維持登入。若你在其他瀏覽器或裝置登入，或 Jable 讓伺服器端 session 過期，仍可能需要重新登入。

### 常見問題

**同步後沒有資料**

確認內嵌瀏覽器已登入 Jable，且目前頁面是 **影片收藏** 或 **稍後觀看**，再點擊 **同步目前 Jable 頁面**。

**重新開啟後需要重新登入**

這通常代表 Jable 官方 session 已失效。請重新登入後再同步；桌面 App 不會繞過 Jable 的官方 session 檢查。

**我只想用瀏覽器匯出**

可以使用 `jable-favourites-exporter.user.js` 搭配 Tampermonkey。桌面 App 則適合需要長期同步、瀏覽與備份的人。

### 開發文件

開發、測試、打包與 release 流程請看 [docs/development.md](docs/development.md)。

### 授權

MIT。詳見 [LICENSE](LICENSE)。

---

## English

Jable Desktop is an unofficial desktop tool and is not affiliated with Jable. It opens Jable inside the app and syncs your favourites and watch-later lists to your computer, so you can browse, sort, import, and export backups.

### Features

- Sync **Favourites** and **Watch Later**.
- Sign in through the embedded browser and keep local login data.
- Store synced data locally on your computer.
- Import and export JSON backups.

### Installation

1. Download the latest build from [GitHub Releases](https://github.com/shane-zeng/jable-desktop/releases).
2. On macOS, download the `.dmg` or `.zip`.
3. On Windows, download the `.exe` installer or `.zip`.
4. Open **Jable Desktop**.

Current release artifacts are not formally signed. macOS may show a Gatekeeper warning, and Windows may show a SmartScreen warning; make sure the file came from this project's GitHub Release.

### First Use

1. Sign in to Jable in the **瀏覽器** (Browser) tab.
2. Open Jable's **Favourites** or **Watch Later** page.
3. Switch to the **本機資料** (Local Data) tab.
4. Click **同步目前 Jable 頁面** (Sync Current Jable Page).
5. After syncing finishes, videos appear in the local list.

### Import And Export

- Click **匯出 JSON** (Export JSON) to back up the current list as JSON.
- Click **匯入 JSON** (Import JSON) to load a previously exported JSON file.
- JSON files exported by the older Tampermonkey userscript can also be imported.

### Data And Login State

Synced data is stored locally on your computer. The app does not upload your lists to another service; sign-in and browsing inside the embedded browser still communicate directly with Jable's website.

The app keeps Jable's local login data, so reopening the app should normally keep you signed in. If you sign in from another browser or device, or if Jable expires the server-side session, you may still need to sign in again.

### Troubleshooting

**No videos appear after syncing**

Make sure the embedded browser is signed in to Jable and currently opened on the **Favourites** or **Watch Later** page, then click **同步目前 Jable 頁面** (Sync Current Jable Page).

**The app asks me to sign in again after reopening**

This usually means Jable's official session has expired. Sign in again before syncing; the desktop app does not bypass Jable's official session checks.

**I only want to export from the browser**

You can still use `jable-favourites-exporter.user.js` with Tampermonkey. The desktop app is better for ongoing sync, browsing, and backups.

### Development Docs

For development, testing, packaging, and release details, see [docs/development.md](docs/development.md).

### License

MIT. See [LICENSE](LICENSE).
