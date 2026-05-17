# 下載清單規劃

狀態：已提案，尚未實作

建立日期：2026-05-16

這份文件定義規劃中的 Download Manager / 下載清單功能。它是 proposal，不是已由實作背書的正式規格。

## 摘要

App 應支援使用者針對已存在於「本機資料」中的影片手動建立本機下載。影片收藏與稍後觀看的影片卡片會新增下載動作。獨立的下載清單會顯示由 App 管理的本機影片檔。使用者點擊已下載項目時，App 會用作業系統預設播放器開啟該本機影片檔。

這個功能是下載與檔案管理功能，不是 App 內建離線播放器。

## 目標

- 在本機資料的兩個 collection 中加入手動下載動作：
  - `favourites`
  - `watch_later`
- 將下載媒體存放在 App 管理的本機下載根目錄。
- 讓下載狀態獨立於 collection membership。
- 同一支影片同時存在收藏與稍後觀看時，重用同一個下載資產。
- 在本機資料中新增 Download List / 下載清單 tab，顯示已完成的本機下載。
- 讓已就緒的本機檔案透過 OS default player 開啟。
- 允許刪除本機下載檔案，但不移除影片收藏、稍後觀看或 Jable 遠端狀態。
- App 重新啟動後仍保留下載狀態。
- 所有下載工作都應在 Electron main process 或 main 擁有的 worker 中執行，不放在 Vue renderer。

## 非目標

- 第一版不做 App 內建播放器。
- 第一版不做整個 collection 的自動批次下載。
- 第一版不支援暫停後續傳；下載失敗或 App 中斷後可以重試，但重試可以從頭開始。
- 第一版不提供下載排程、速度上限或同時下載數設定 UI；下載器使用保守固定預設值。
- 第一版不做字幕、章節、轉碼或畫質選擇 UI。
- 不做下載檔案的雲端同步。
- 不更動收藏與稍後觀看的 JSON import/export backup 格式。

## 產品命名

- UI 功能名稱：Download List / 下載清單。
- 使用者動作：Download / 下載。
- 持久化媒體概念：download asset / 下載資產。
- 除非未來加入 App 內建播放器，否則不要把這個功能稱為 Offline Playback / 離線播放。

## 已決定的產品方向

- 使用者應能選擇 managed download root。預設位置可以維持在 Electron `userData` 底下，但 Settings 應允許在下載前或已有下載後改選其他 root。
- Downloaded files 必須保留到使用者明確透過 Download List actions 刪除為止。從本機 collection data 移除影片時，不得刪除已下載的本機檔案。
- MVP 的 Download List 不需要獨立 search 或 sort controls，但 data model 與 APIs 不應阻斷未來加入 Download List search/sort。

## 使用者體驗

### 本機資料卡片

- 收藏與稍後觀看的影片卡片顯示下載動作。
- 這個動作只出現在一般本機影片列，不出現在 Pending Sync 卡片。
- 來源 collection 卡片的下載 UI 應保持精簡，只顯示單一 icon/button 狀態，不顯示完整進度、錯誤文字、retry controls 與 delete controls。
- 動作會反映該影片目前的下載狀態：
  - `not_downloaded`
  - `queued`
  - `downloading`
  - `ready`
  - `failed`
  - `missing`
- 開始下載必須是使用者針對單支影片明確觸發。
- 如果同一支影片同時出現在收藏與稍後觀看，兩邊卡片顯示相同下載狀態。
- `ready` 狀態提供開啟動作，而不是再次建立重複下載。
- `failed` 狀態提供重試。
- `missing` 代表資料庫原本有 ready asset 紀錄，但檔案已不存在於磁碟。
- 詳細 queue、progress、retry 與 delete interactions 應放在 Download List，避免影片收藏與稍後觀看列表視覺過度複雜。

### 下載清單 Tab

- 本機資料新增 Download List / 下載清單 tab。
- 這個 tab 是全域本機資產檢視，不是第三個 Jable collection。
- 這個 tab 是主要 download-manager surface，應顯示所有持久化 download asset states：
  - `queued`
  - `downloading`
  - `failed`
  - `ready`
  - `missing`
- 如果原本 ready 的檔案遺失，該列仍以 `missing` 狀態顯示，直到使用者刪除紀錄或重試。
- 空狀態文案表示目前沒有任何影片加入下載清單。
- 下載清單列顯示：
  - 縮圖
  - 標題
  - 原始 Jable URL
  - 已知時顯示下載檔案大小
  - 下載完成時間
  - 本機檔案狀態
- Queued 與 downloading rows 顯示精簡 progress state。
- Downloading rows 可顯示 runtime-only 的已下載大小與速度。
- Failed rows 顯示 retry 與 delete actions。
- Ready rows 顯示 open、reveal 與 delete actions。
- Missing rows 顯示 retry 與 delete actions。
- 點擊 ready 的下載清單列會用作業系統預設播放器開啟本機檔案。
- Context actions 應包含：
  - 開啟本機檔案
  - 開啟 Jable 頁面
  - 在資料夾中顯示
  - 刪除本機檔案

### 開啟已下載檔案

- Renderer 永遠不直接開啟任意本機路徑。
- Renderer 只把 asset identifier 或 canonical video URL 傳給 main。
- Main 從持久化狀態解析受管理的檔案路徑。
- Main 驗證解析後的路徑位於 App 管理的下載根目錄內。
- Main 驗證檔案存在。
- Main 呼叫 Electron `shell.openPath(filePath)`。
- 如果 OS 回傳錯誤，App 顯示本地化錯誤訊息。
- 如果檔案遺失，main 將 asset 標記為 `missing`，並通知 renderer。

## 儲存

### 下載根目錄

- 預設下載根目錄放在 Electron `userData` 底下，例如：

```text
<userData>/downloads/videos/<video-path-key>/<safe-filename>.mp4
```

- 使用者應能從 Settings 選擇不同的 managed download root。
- 選定的 root 由 App 用來管理 download-manager files。
- 選擇 custom root 時，除非使用者明確選擇既有 App-managed download folder，否則 App 應在該 root 內建立並使用 app-specific child folder。
- 選定 root 必須持久化在 app settings。
- 排入下載前必須視需要建立選定 root，並檢查是否可寫入且 path safety 合格。
- Renderer 不取得不受限制的 filesystem browsing 權限。
- 持久化檔案參照應該相對於受管理的下載根目錄。
- 絕對路徑只在 main process runtime 中推導。

### 檔案命名

- Canonical video URL 是穩定 asset key。
- 資料夾名稱應由 canonical video path key 產生，不只依賴 title 文字。
- 顯示用檔名可以包含 sanitized title 或影片番號，方便使用者辨識。
- 檔名產生必須避免 path traversal、保留名稱與平台不合法字元。
- Fallback origin URL 在 asset lookup 前必須 canonicalize 成主要 Jable origin。

## 資料模型

在 local data engine 新增持久化 download asset model。

建議資料表：

```sql
CREATE TABLE download_assets (
  video_url TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  file_relative_path TEXT,
  format TEXT,
  title TEXT,
  img TEXT,
  preview TEXT,
  size_bytes INTEGER,
  duration_seconds REAL,
  error TEXT,
  downloaded_at TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

狀態值：

| Status        | 意義                                   |
| ------------- | -------------------------------------- |
| `queued`      | 使用者已要求下載，等待 worker 執行。   |
| `downloading` | Worker 正在下載或 remux asset。        |
| `ready`       | 本機檔案存在，可開啟。                 |
| `failed`      | 上一次下載嘗試失敗。                   |
| `missing`     | Asset 曾經 ready，但本機檔案已不存在。 |
| `deleting`    | 刪除作業進行中。                       |

備註：

- `download_assets` 獨立於 `collection_items`。
- `download_assets` 應保存足夠的 title 與 thumbnail metadata，讓對應的 `videos` row 之後即使從 local collection data 移除，Download List 仍能 render rows。
- `file_relative_path` 必須拒絕 absolute paths、drive-root paths、traversal components、empty path components，以及含 colon 的 components。
- 刪除 download asset 不得改變 collection visibility 或 Jable 遠端狀態。
- 刪除 local collection data 或 canonical video row 不得刪除本機下載檔案。刪除本機檔案必須透過明確的 Download List delete action。
- Collection JSON import/export 維持不變。
- MVP 的 Download List 可以不做獨立 search/sort controls。未來 Download List search 可以在有 matching `videos` row 時重用 `videos.search_text`，沒有時 fallback 到 asset 自己保存的 metadata。MVP 不需要獨立 FTS table。
- Rust data engine 透過共用的 `app/data-engine.ts` boundary 提供 download asset API。

## IPC Contract

實作時 TypeScript 名稱可以再調整，但此功能需要下列 renderer-facing capability：

- `getFfmpegStatus()`
  - 回傳偵測到的 FFmpeg readiness、可用時的 version text、來源（`path` 或 `manual`）以及 validation error。
- `refreshFfmpegStatus()`
  - 使用者安裝或變更 FFmpeg 後，重新執行 FFmpeg detection。
- `setFfmpegPath(filePath)`
  - 儲存並驗證手動選擇的 FFmpeg binary path。
- `getDownloadStates(videoUrls)`
  - 回傳目前 Local Data 頁面中每個 canonical video URL 的下載狀態。
- `startVideoDownload(payload)`
  - 對 canonical video URL 啟動或排入下載。
  - Payload 包含 `videoUrl`，也可以包含目前 row metadata，用於 snapshot title 與 thumbnail。
- `listDownloads(options)`
  - 列出 Download List rows。
- `countDownloads(options)`
  - 計算 Download List rows 數量，以支援 pagination。
- `retryVideoDownload(videoUrl)`
  - 重試 failed 或 missing asset。
- `openDownloadedVideo(videoUrl)`
  - 用 OS default player 開啟 ready 的受管理本機檔案。
- `revealDownloadedVideo(videoUrl)`
  - 在 Finder 或 File Explorer 中顯示 ready 的受管理本機檔案。
- `deleteDownloadedVideo(videoUrl)`
  - 刪除受管理檔案，並清除或標記 asset record。

Main-to-renderer events：

- `download-state-changed`
- `download-progress`
- `download-error`

驗證要求：

- Video URL 必須通過既有 trusted Jable video URL normalization。
- Unknown asset identifier 必須明確失敗。
- 永遠不接受 renderer 提供的檔案路徑。
- 開啟與刪除本機檔案前，必須驗證 path containment 位於受管理下載根目錄內。

## 下載流程

第一個完整實作應輸出單一本機 MP4 檔案，因為這最適合交給 OS default player 開啟。

建議流程：

1. 使用者從 Local Data 影片卡片點擊 Download。
2. Renderer 透過 preload API 呼叫 main。
3. Main 建立或更新 `download_assets` row 為 `queued`。
4. Main 擁有的 download worker 使用隔離的 Jable session 載入 Jable 影片頁。
5. Worker 從 page HTML 或觀察到的 media requests 擷取 HLS `.m3u8` URL。
6. Worker 使用 playlist URL、輸出路徑與必要 request headers 呼叫已驗證的外部 FFmpeg binary。
7. FFmpeg 負責讀取 playlist、抓取 HLS segments、處理支援的 HLS 解密，並 remux 成單一 `.mp4`。
8. Worker 先寫入受管理下載根目錄下的 `.part` 檔，傳入 `-f mp4` 避免 FFmpeg 用 `.part` suffix 推斷 muxer，並讀取 FFmpeg `-progress pipe:1` 輸出來顯示 runtime 已下載大小與速度。
9. Worker 以 atomic move 將完成檔案移到最終受管理位置。
10. Asset row 變成 `ready`。
11. 盡可能清理 temporary files。

不支援的 playlist 條件應明確失敗：

- 不支援的 encryption 或 DRM/key format
- 永遠無法產生 VOD segments 的 playlist reload loop
- FFmpeg network、playlist、segment、decryption 或 remux failure

## FFmpeg 策略

交給 OS default player 開啟會強烈偏向輸出 MP4 檔案，因此需要 remux step。

MVP 決策：

- MVP 要求使用者自行安裝 FFmpeg。
- 第一版 packaged builds 不 bundle FFmpeg。
- 使用 FFmpeg 處理 HLS playlist reading、segment fetching、支援的 HLS decryption，以及 MP4 remuxing。
- Runtime 偵測已安裝的 `ffmpeg` binary。
- 如果缺少 FFmpeg，阻擋 download start actions，並顯示明確 dependency error。
- 不要靜默 fallback 成儲存 raw HLS segments，因為這不適合 default-player opening。

Runtime ownership 決策：

- MVP 從 Electron main process 或 main-owned worker 呼叫外部 FFmpeg binary。
- Rust 透過 local data engine 負責 download asset persistence。
- MVP 不用 Rust 重寫 HLS segment downloading、HLS decryption 或 remuxing。
- 未來如果 process supervision、queue control 或 crash isolation 有足夠需求，可以把 FFmpeg process runner 移到 Rust/native boundary 後面；但該 runner 仍是呼叫 FFmpeg，不是取代 FFmpeg。
- Renderer IPC 與 `download_assets` model 應獨立於 runner implementation，讓未來替換 runner 時不必改產品契約。

因為 MVP 依賴使用者自行安裝 FFmpeg，App 必須提供明確的 FFmpeg readiness UX：

- Settings 顯示 FFmpeg status：
  - detected
  - missing
  - invalid path
  - unsupported 或 failed version check
- FFmpeg missing 時，Download List 顯示清楚的 setup-required state。
- FFmpeg missing 時，來源 collection 的下載按鈕不能 silent fail。
- UI 必須提供「重新檢查」動作，讓使用者安裝 FFmpeg 後不必重啟 App，就能要求 App 重新偵測。
- UI 應提供手動選擇 `ffmpeg` binary path 的方式，給安裝後不在 `PATH` 裡的使用者。
- 手動選擇的 binary path 應持久化在 app settings。
- App 應由 main process 執行 `ffmpeg -version` 驗證選定 binary，並確認 command 成功結束。
- 驗證成功後，後續下載使用該手動選定 binary path，而不是搜尋 `PATH`。
- 驗證失敗時，UI 維持 download feature blocked，並顯示本地化錯誤。
- 文件必須分別提供 Windows 與 macOS 安裝說明。
- 文件必須說明使用者安裝 FFmpeg 後，應在 App 裡做什麼：打開 Settings、按重新檢查，或手動選擇 binary path。

未來 bundled FFmpeg enhancement：

- 未來可以在 MVP 之後重新評估是否 bundle FFmpeg，但這不屬於第一版 release 範圍。
- 如果後續要 bundle FFmpeg，實作前需記錄 binary 來源、license obligations、package size impact、macOS signing/notarization impact，以及 Windows packaging impact。

## Queue 與 Retry 規則

- MVP queue concurrency 是一次只下載一支影片。
- Segment download 內部可以使用有界 concurrency。
- Segment concurrency 預設應保守，降低對網站的負載。
- Segment request 失敗時應使用 timeout 與 backoff retry。
- App shutdown 時若有 active download，下一次啟動時要將該 asset 標記為 `failed` 或 `queued`；實際行為必須 deterministic。
- Retry 可以清除舊 temporary directory，並從頭重新下載。
- 使用 partial segment reuse 做 pause/resume 是未來 enhancement。

## 未來批次下載擴充

MVP 明確不包含整個 collection 的自動批次下載，但第一版實作不應阻斷這條未來路徑。

未來批次下載可以新增 `startCollectionDownload(collectionKey, options)` 或 `startVideoDownloads(videoUrls)` 之類的 API。可能的批次來源包含：

- 影片收藏的全部可見 rows。
- 稍後觀看的全部可見 rows。
- 目前搜尋/篩選結果。
- 使用者從本機列表勾選的多筆影片。

批次下載必須重用同一套 `download_assets` model，不應為批次功能新增另一張 asset table，也不應為同一個 canonical video URL 建立重複本機檔案。

未來批次行為應遵守：

- 已經是 `ready` 的 assets 會被略過。
- 既有 `queued` 或 `downloading` assets 不會被重複排入。
- `failed` 或 `missing` assets 只有在 batch request 明確允許 retry 時才會重試。
- 如果 UI 需要 batch-level progress、cancellation 或 history，可以讓 batch queue rows 與 asset rows 分開追蹤。
- 取消 batch 應停止 pending 或 active jobs，但不得刪除已完成的本機檔案，除非使用者明確要求刪除。
- Collection sync 變動不得自動刪除 downloaded assets。
- Active download concurrency 未來可變成可設定值，但預設仍應保守。

## 未來播放分片重用擴充

播放分片重用是未來 research enhancement，不屬於 MVP 預設行為。

使用者角度的想法是：如果內嵌瀏覽器已經在播放 Jable HLS 影片，瀏覽器本來就正在抓 playlist 與 segment requests。未來實作可以評估是否重用這些播放期間的 network responses 來建立 App 管理的本機 MP4，而不是對同一支影片再啟動第二次完整下載。

這跟單純「播放時自動排入一般下載」不同。單純 auto-enqueue 比較容易，但影片資料仍會下載第二次。播放分片重用只有在能穩定 capture 或 tee playback segment responses 時，才值得做。

重要限制：

- Chromium media playback 沒有穩定公開 API 可以讓 renderer JavaScript 或 Electron preload 直接取得已 buffer 的 segment bytes。
- Electron `session.webRequest` 可以觀察 media request URLs 與 headers，但不提供可直接保存的 response bodies。
- Chromium HTTP cache 不是可靠的產品介面，不能假設可以從 cache 重建完整影片；cache 可能是 partial、已 eviction、encrypted、compressed，或某些 media requests 根本不可用。
- 如果 player 使用 native media loading，而不是頁面層的 `fetch`/XHR，monkey-patch `fetch` 無法抓到 segment bytes。

可行的未來實作路徑可能包含：

- Local proxy 或 custom request pipeline：讓 player 的 HLS requests 經過 App 可控通道，App 一邊把 response body 餵給播放，一邊寫入磁碟。
- Custom in-app player pipeline：由 App 自己負責 HLS fetching，先保存每個 segment，再交給播放器。
- Page-level interception：只有在確認 Jable player 使用可攔截的 `fetch`/XHR 載入 playlist 與 segments 時才考慮；這條路徑必須用 live player 驗證，而且會比較受網站變更影響。

如果後續加入播放分片重用，Settings 的 Downloads 區塊可以新增「重用播放下載」或「播放時保存」選項。此選項必須預設關閉。

播放分片重用應遵守：

- 只套用在可信任 Jable 影片詳情頁，也就是 `/videos/.../`。
- 不得因為影片收藏、稍後觀看、下載清單或待同步卡片的 hover preview 而觸發。
- 應等待短暫播放門檻，例如 5-10 秒，再開始 capture，避免使用者短暫誤點造成保存。
- 必須重用與手動下載相同的 `download_assets` identity model。
- 既有 `queued`、`downloading` 或 `ready` assets 不得重複加入。
- FFmpeg missing 時必須阻擋最後 MP4 assembly，並顯示與手動下載一致的 setup-required 訊息。
- 如果可能發生 partial capture，captured segment state 必須與 final asset row 分開表示。
- 設定應存在 app settings，不應存在 individual browser tabs。
- 實作時不得記錄 cookies、HLS URLs、signed tokens、HLS keys、segment URLs 或完整本機路徑。

## 未來下載控制擴充

MVP 可以讓失敗或中斷的下載從頭重試，但實作不應阻斷未來 pause/resume 支援。

未來 pause/resume 支援可以加入 segment-level progress tracking，例如：

- playlist fingerprint 或 content hash
- total segment count
- downloaded segment indexes
- decrypted segment indexes
- 安全續傳所需的 key metadata
- temporary directory state validation

如果第一版會增加不必要複雜度，可以先不建立獨立 job table。不過命名、IPC payload 與 state transitions 應避免假設每次下載都會立即開始，並且會在不中斷的單一流程中完成。

未來 scheduling 與 download-control 支援可以加入 queue/job fields，例如：

- `scheduled_at`
- `priority`
- `max_bytes_per_second`
- `segment_concurrency`
- `paused_at`
- `started_at`
- `completed_at`
- `canceled_at`

這些未來控制必須與核心 asset identity 分離。`download_assets` 應持續代表 canonical video URL 的本機檔案狀態，而未來 queue/job records 可以代表一次或多次產生、修復該本機檔案的嘗試。

## 安全與隱私

- MVP 下載只能由使用者主動觸發。
- 未來播放時自動下載必須由使用者明確 opt-in，且只能由使用者播放行為觸發，不得預設啟用。
- 此功能必須使用現有隔離 Jable session，不得持久化 credentials。
- 一般 log 不得記錄 cookies、authorization headers、HLS keys 或完整本機路徑。
- 不接受任意 remote URL 作為下載來源。
- 不將任意本機檔案路徑暴露給 renderer。
- 刪除下載檔案必須限制在受管理下載根目錄內。
- 功能應提示使用者需自行遵守網站條款與適用法律。

## 在地化

所有可見文字都必須加入：

- `app/i18n/locales/zh-TW.json`
- `app/i18n/locales/en-US.json`
- `app/i18n/locales/ja-JP.json`

預期 copy groups：

- 下載動作 label 與 aria label。
- 下載狀態 label。
- Download List tab label。
- Empty state。
- Open、reveal、retry、delete actions。
- FFmpeg status、setup-required、check-again 與 choose-binary labels。
- FFmpeg missing error。
- Download failure 與 file missing status messages。

## 測試需求

Data engine：

- Migration 會建立 `download_assets`。
- Asset state transitions 是 deterministic。
- Download assets 以 canonical video URL 作為 key。
- Persisted file paths 會驗證為 managed-root-relative paths。
- 刪除 collection item 或 local video row 不會刪除 downloaded file，也不會抹掉 asset record，除非使用者明確刪除 download asset。
- Rust native engine tests 覆蓋 migration 與 state transitions。

IPC 與 main process：

- IPC normalizers 會拒絕 invalid URL 與 unknown payload shape。
- FFmpeg detection 會處理 missing binaries、invalid manual paths，以及成功的 `ffmpeg -version` validation。
- `openDownloadedVideo` 會拒絕 missing、failed 與 path-escaped assets。
- `deleteDownloadedVideo` 不可刪除 managed root 之外的檔案。
- Download progress events 會序列化成穩定 payload。

Renderer：

- 收藏與稍後觀看卡片顯示正確下載動作狀態。
- 同一個 video URL 跨 collections 共享下載狀態。
- Download List 會 render queued、downloading、failed、ready 與 missing assets。
- 點擊 ready 的 Download List item 會呼叫 open IPC method。
- Failed 與 missing states 顯示 retry/delete actions。

Electron smoke：

- 使用 test userData directory。
- Seed 一個受管理本機檔案與 asset row。
- 驗證 open IPC handler 到達 shell boundary，且解析出的路徑是受管理路徑。OS player 本身可 mock 或 guard。

Manual validation：

- macOS default player open behavior。
- Windows default player open behavior。
- Missing FFmpeg behavior，包含 Settings status、Download List setup-required state、重新檢查，以及手動 binary path selection。
- Failed download retry。
- 從 Download List 刪除本機檔案。
- 重新同步收藏與稍後觀看不會移除本機 download assets。

## 實作里程碑

1. 新增 FFmpeg detection、Settings status、重新檢查、手動 binary path selection，以及 Windows/macOS install docs。
2. 新增 data model、IPC types 與 runtime normalizers。
3. 新增 Download List UI，並先用 seeded/manual asset records 做每張卡片的下載狀態。
4. 新增 OS default-player opening、reveal/delete actions。
5. 新增 HLS playlist extraction 與 FFmpeg HLS/remux runner。
6. 針對真實 Jable playback/download 行為確認 FFmpeg headers，並補齊 failure messages。
7. 新增 progress/status events 與 retry handling。
8. 新增 automated tests；功能完成後更新 implementation-backed specs 與 user guides。
