# Jable Desktop 使用說明

Jable Desktop 是非官方桌面工具，與 Jable 官方沒有關聯。

它會在 App 內開啟 Jable，將「影片收藏」與「稍後觀看」同步到你的電腦本機，方便瀏覽、搜尋、排序、匯入與匯出備份。

[回到專案首頁](../README.md) · [English](README.en-US.md) · [日本語](README.ja-JP.md)

## 功能特色

- 同步「影片收藏」與「稍後觀看」
- 內建多分頁嵌入式瀏覽器
- 本機 SQLite 儲存
- 快速同步與完整同步模式
- SQLite FTS5 本機全文搜尋
- JSON 匯入與匯出
- 支援繁體中文、英文與日文介面
- 支援 macOS 與 Windows

## 技術亮點

- Electron 桌面應用架構
- Vue 3 + TypeScript renderer
- SQLite 持久化儲存與 FTS5 全文搜尋
- Incremental sync 與 full reconciliation sync 設計
- Embedded browser session persistence
- Shared IPC wire types
- 輕量 i18n 架構，支援 renderer、Electron native menu 與 userscript 多語系
- GitHub Actions 自動化 lint、typecheck、test 與 release packaging

## 架構概覽

Jable Desktop 採用 embedded browser 設計，而非依賴非官方 API。

使用者登入與瀏覽行為仍直接與 Jable 官方網站互動；App 本身負責同步網站清單資料到本機 SQLite，並提供本機搜尋、排序、備份與還原功能。

系統主要分為：

- Electron main process
- Embedded browser / webview layer
- Vue renderer UI
- SQLite persistence layer
- Sync / scraping pipeline

## 本機搜尋

本機搜尋使用 SQLite FTS5。

App 會從影片標題與 URL 建立正規化搜尋索引，支援：

- 中文與日文搜尋
- punctuation-normalized phrase matching
- URL fragment 搜尋
- any / all / phrase 搜尋模式

同步完成後，可直接在本機進行快速搜尋與排序，而不需重新載入網站清單。

## 同步模式

### 快速同步

- 從第 1 頁開始同步
- 若整頁資料都已存在則停止
- 適合日常增量更新
- 第一次建立本機資料時請先使用完整同步

### 完整同步

- 從第 1 頁同步到最後一頁
- 重建完整網站排序
- 更新所有仍存在於網站上的影片
- 隱藏網站上已不存在的本機資料

大型清單會在背景以受控 AJAX 視窗加速同步；若網站回應不符合預期，會自動退回一般逐頁同步。

## 待同步清單

同步期間如果你在 Jable 頁面操作加入或移除，App 會先把操作寫入本機 outbox，等同步頁面抓取完成後再送回 Jable。

若送回 Jable 失敗，本機資料頁會出現全域「待同步」tab。這個清單不顯示資料表中的每一筆原始操作，而是依影片整理成最後狀態，例如「應加入」或「應移除」。同一支影片連續加入、移除、再加入時，只會顯示一列，並顯示操作序列摘要。

你可以在「待同步」裡對任一影片按「重送最終狀態」。成功後該影片會從清單移除；失敗時會保留並更新錯誤訊息。這個動作只修正該影片是否在遠端清單中，不保證還原原本的遠端排序；下一次完整同步會重新讀取網站排序並讓本機資料收斂。

如果下一次完整同步完成且沒有新的送出失敗，舊的待同步項目會被視為已由完整同步結果取代，tab 會自動隱藏。

## 安裝

1. 到 GitHub Releases 下載最新版本
2. macOS 使用 `.dmg` 或 `.zip`
3. Windows 使用 `.exe` 或 `.zip`
4. 開啟 Jable Desktop

目前 release 尚未進行正式簽章：

- macOS 可能出現 Gatekeeper 提示
- Windows 可能出現 SmartScreen 提示

請確認檔案來源為本專案 GitHub Releases。

## 第一次使用

1. 在內建瀏覽器登入 Jable
2. 切換到「本機資料」
3. 選擇「影片收藏」或「稍後觀看」
4. 點擊「完整同步」
5. 同步完成後即可在本機瀏覽資料

第一次同步完成後，日常更新可改用「快速同步」。

## 匯入與匯出

- 支援 JSON 匯出備份
- 支援 JSON 匯入還原
- 保留網站排序資訊 (`site_order`)
- 相容舊版 Tampermonkey userscript 匯出格式

## 資料與登入狀態

同步資料儲存在使用者本機電腦。

App 不會將你的清單上傳到其他服務；登入與瀏覽仍直接與 Jable 官方網站互動。

若 `https://jable.tv` 載入失敗，桌面 app 會在目前 session 自動切換到官方備用站 `https://fs1.app`。本機資料仍會使用主要網址作為標準 URL，避免同一影片因不同網域重複。

Jable 的登入狀態會保存在隔離的 Electron session partition 中，但若 Jable 官方 session 過期，仍可能需要重新登入。

## Tampermonkey Userscript

原始 userscript 仍可單獨使用：[`jable-favourites-exporter.user.js`](../jable-favourites-exporter.user.js)。

它支援：

- `https://jable.tv/my/favourites/videos/`
- `https://jable.tv/my/favourites/videos-watch-later/`
- `https://fs1.app/my/favourites/videos/`
- `https://fs1.app/my/favourites/videos-watch-later/`

進入頁面後，點擊右下角浮動匯出按鈕即可匯出所有分頁。旁邊的語言選擇器可切換 **繁中** / **EN** / **日本語**。

## 開發文件

詳細開發文件請參考 [docs/development.md](development.md)。

內容包含：

- 系統架構
- SQLite schema 與 migration
- 搜尋架構
- Sync pipeline
- Electron process 設計
- Packaging 與 release workflow
- 測試與 validation checklist

## 授權

MIT License。

詳見 [LICENSE](../LICENSE)。
