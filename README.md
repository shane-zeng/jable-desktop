# Jable Desktop

Unofficial desktop app for syncing, browsing, importing, and exporting your Jable favourites and watch-later lists.

- [繁體中文](#繁體中文)
- [English](#english)

---

## 繁體中文

Jable Desktop 是非官方桌面工具，與 Jable 官方沒有關聯。它會在 App 內開啟 Jable，將「影片收藏」與「稍後觀看」同步到你的電腦本機，方便瀏覽、排序、匯入與匯出備份。

### 主要功能

- 同步 **影片收藏** 與 **稍後觀看**。
- 使用支援分頁、緊湊浮動模式、可拖曳調整的分頁列與右鍵選單的內嵌瀏覽器登入 Jable，並在本機保存登入所需資料。
- 將同步資料儲存在你的電腦本機。
- 依 Jable 網頁順序顯示本機清單。
- 提供快速同步與完整同步。
- 支援 JSON 匯入與匯出。

### 安裝

1. 到 [GitHub Releases](https://github.com/shane-zeng/jable-desktop/releases) 下載最新版本。
2. macOS 使用者下載 `.dmg` 或 `.zip`。
3. Windows 使用者下載 `.exe` 安裝檔或 `.zip`。
4. 開啟 **Jable Desktop**。

目前發佈檔尚未做正式簽章。macOS 可能出現 Gatekeeper 提示，Windows 可能出現 SmartScreen 提示；請確認檔案來源是本專案的 GitHub Release。

### 第一次使用

1. 在 **瀏覽器** 頁籤登入 Jable。
2. 切到 **本機資料** 頁籤。
3. 選擇 **影片收藏** 或 **稍後觀看**。
4. 點擊 **快速同步**。
5. 同步完成後，影片會出現在本機清單中。

### 同步模式

- **快速同步**：從 Jable 清單第 1 頁開始，遇到整頁都是已知影片後停止。它只會更新本次掃到影片的觀看數、喜歡數與網站排序。
- **完整同步**：從第 1 頁跑到最後一頁，更新所有仍在網站上的影片，重建完整網站排序，並把網站上已不存在的本機項目標記為隱藏。
- 同步會在瀏覽器內自動開啟同步分頁。同步分頁執行期間不能關閉，但你可以切換到其他分頁繼續瀏覽。
- 完整同步每批最多處理 100 頁。若資料很多，App 會暫停並顯示 **繼續完整同步**；已掃到的資料會先寫入，但未完整完成前不會隱藏舊資料。

### 匯入與匯出

- 點擊 **匯出 JSON** 可將目前清單備份成 JSON。
- 點擊 **匯入 JSON** 可載入先前匯出的 JSON。
- 桌面 App 匯出的 JSON 會包含 `site_order`，用來保留 Jable 網頁排序。
- 舊版 Tampermonkey userscript 匯出的 JSON 也可以匯入。

### 資料與登入狀態

同步資料會儲存在你的電腦本機。App 不會把你的清單上傳到其他服務；你在內嵌瀏覽器中的登入與瀏覽仍會直接與 Jable 官方網站互動。

App 會保存 Jable 的本機登入資料，所以一般重開 App 後仍可維持登入。若你在其他瀏覽器或裝置登入，或 Jable 讓伺服器端 session 過期，仍可能需要重新登入。

### 常見問題

**同步後沒有資料**

確認內嵌瀏覽器已登入 Jable，再到 **本機資料** 選擇 **影片收藏** 或 **稍後觀看** 後同步。

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
- Sign in through the tabbed embedded browser with compact floating mode, a resizable tab rail, and context menus, and keep local login data.
- Store synced data locally on your computer.
- Display local lists in the same order as Jable.
- Choose between quick sync and full sync.
- Import and export JSON backups.

### Installation

1. Download the latest build from [GitHub Releases](https://github.com/shane-zeng/jable-desktop/releases).
2. On macOS, download the `.dmg` or `.zip`.
3. On Windows, download the `.exe` installer or `.zip`.
4. Open **Jable Desktop**.

Current release artifacts are not formally signed. macOS may show a Gatekeeper warning, and Windows may show a SmartScreen warning; make sure the file came from this project's GitHub Release.

### First Use

1. Sign in to Jable in the **瀏覽器** (Browser) tab.
2. Switch to the **本機資料** (Local Data) tab.
3. Choose **Favourites** or **Watch Later**.
4. Click **快速同步** (Quick Sync).
5. After syncing finishes, videos appear in the local list.

### Sync Modes

- **Quick Sync** starts from page 1 and stops once it reaches a page where every video is already known. It only updates views, likes, and site order for videos scanned in that run.
- **Full Sync** runs from page 1 to the final page, updates every video still present on Jable, rebuilds the full site order, and hides local items that no longer appear on the site.
- Syncs run in an automatically opened browser tab. The sync tab cannot be closed while it is running, but you can switch to other tabs and keep browsing.
- Full sync processes up to 100 pages per batch. For large lists, the app pauses and shows **繼續完整同步** (Continue Full Sync); scanned data is saved immediately, but old items are not hidden until full sync completes.

### Import And Export

- Click **匯出 JSON** (Export JSON) to back up the current list as JSON.
- Click **匯入 JSON** (Import JSON) to load a previously exported JSON file.
- JSON exported by the desktop app includes `site_order` to preserve the Jable site order.
- JSON files exported by the older Tampermonkey userscript can also be imported.

### Data And Login State

Synced data is stored locally on your computer. The app does not upload your lists to another service; sign-in and browsing inside the embedded browser still communicate directly with Jable's website.

The app keeps Jable's local login data, so reopening the app should normally keep you signed in. If you sign in from another browser or device, or if Jable expires the server-side session, you may still need to sign in again.

### Troubleshooting

**No videos appear after syncing**

Make sure the embedded browser is signed in to Jable, then choose **Favourites** or **Watch Later** in **本機資料** (Local Data) and sync again.

**The app asks me to sign in again after reopening**

This usually means Jable's official session has expired. Sign in again before syncing; the desktop app does not bypass Jable's official session checks.

**I only want to export from the browser**

You can still use `jable-favourites-exporter.user.js` with Tampermonkey. The desktop app is better for ongoing sync, browsing, and backups.

### Development Docs

For development, testing, packaging, and release details, see [docs/development.md](docs/development.md).

### License

MIT. See [LICENSE](LICENSE).
