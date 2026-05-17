# 下載清單第二版規劃

狀態：已接受，實作中

建立日期：2026-05-17

基準：`docs/specs/download-manager.md`，最後於 2026-05-17 對照實作確認。

這份文件規劃 Download Manager / 下載清單第一版完成後的第二版方向。重點是產品使用體驗、更清楚的 queue 控制、較安全的速度調整、錯誤復原，以及未來擴充點。

## 摘要

下載清單第一版已證明核心流程可行：

- 使用者可以從本機資料卡片下載影片
- 下載紀錄持久化在 SQLite `download_assets`
- 檔案存放在使用者可選擇的下載根目錄
- Rust 併發下載 HLS keys 與 segments
- FFmpeg 將下載好的 local HLS media remux 成 MP4
- 完成的檔案透過作業系統預設播放器開啟
- 常見路徑下取消與重試可正常運作

第二版應保留目前架構，改善它周圍的操作體驗。優先事項不是重寫 downloader、加入 App 內建播放器，或 bundle FFmpeg，而是讓功能更容易理解、更容易復原、使用時比較不吵也不雜。

## 目標

- 改善 Download List 與來源卡片的互動品質。
- 讓 queued、active、failed、ready、missing 狀態更容易掃描。
- 加入較安全的 queue actions，例如 retry all failed、clear completed、cancel queued。
- 加入使用者看得懂的下載速度模式，但預設不暴露底層 downloader 細節。
- 持久化足夠的 attempt metadata，讓錯誤更容易解釋，也支援更好的 retry 判斷。
- 改善 segment URL 過期或被 CDN 拒絕時的自動重試行為。
- 保留目前 SQLite-backed `download_assets` model。
- 保留目前 Rust segment downloader 加外部 FFmpeg remux pipeline。
- 將選取列批次下載與可設定最大同時下載數視為第二版基礎能力。
- 加入 queued 與 active downloads 的真正 pause/resume，並重用可續傳的 segment temp files。
- 保留未來「播放時觸發下載」的擴充路徑。

## 非目標

- 第二版不做 App 內建播放器。
- 第二版不 bundle FFmpeg。
- 不做下載檔案的雲端同步。
- 不改收藏與稍後觀看 JSON import/export backup 格式。
- 不預設自動下載整個 collection。
- 不嘗試 resume 部分寫入的 MP4 output file。Resume 是 segment-level：可重用已完成的 HLS segment files，但 FFmpeg remux 會重新開始。
- 不把 Electron 或 Chromium HTTP cache 當成正式受管理的下載媒體存放位置。

## 產品方向

第二版應把 Download Manager 當成「本機資料裡的一級本機檔案管理器」來處理。

建議優先順序：

1. UI polish 與互動一致性。
2. 錯誤復原與更清楚的錯誤顯示。
3. 下載速度與穩定性設定。
4. Pause/resume 與安全的 App 關閉復原。
5. 播放時觸發下載作為需要驗證的 enhancement，而不是直接假設可重用播放 cache。

## 使用者體驗

### 來源卡片

收藏與稍後觀看的來源卡片應保持精簡。

第二版應調整卡片上的下載按鈕，讓狀態容易辨識，但不要讓每張影片卡片變得雜亂：

- 可行時使用 icon-first action，搭配本地化 tooltip。
- 詳細進度、錯誤文字、刪除與 reveal actions 不放在來源卡片。
- 來源卡片只顯示最小必要狀態：
  - 尚未下載
  - 已排入
  - 下載中
  - 已下載
  - 已暫停
  - 可重試
  - 本機檔案遺失
- 對 ready record，如果互動標示夠清楚，卡片下載 action 可以開啟本機檔案。
- 對 failed 或 missing record，卡片下載 action 應執行 retry。
- 如果同一支影片同時屬於收藏與稍後觀看，兩邊卡片仍反映同一筆全域下載紀錄。

### 下載清單

下載清單應成為主要操作介面。

第二版應改善：

- 更清楚的狀態分組或篩選：
  - 全部
  - 進行中
  - 已暫停
  - 失敗
  - 已完成
  - 檔案遺失
- 下載進行時有精簡的 active queue 區塊
- 每個狀態有更清楚的主要動作
- 一般狀態變更不要用太吵的 toast
- 明確提供 retry、cancel、pause、resume、open、reveal、open page、delete affordances
- 安全的 bulk actions：
  - 重試失敗項目
  - 取消排隊項目
  - 清除已完成紀錄
  - 刪除選取的本機檔案

批次刪除必須維持明確且具破壞性。它需要 confirmation dialog，且不得移除收藏、稍後觀看或 Jable 遠端狀態。

### 錯誤細節

Failed rows 應先顯示簡短本地化訊息，必要時再用展開區塊顯示技術細節。

一般 row 不應直接顯示很長的 FFmpeg output、signed URLs、本機絕對路徑、cookies 或 HLS keys。

建議顯示：

- 簡短原因：
  - 尚未安裝 FFmpeg
  - 找不到 playlist
  - Segment request 被拒絕
  - Segment 下載失敗
  - FFmpeg remux 失敗
  - 檔案系統錯誤
  - 下載已取消
- 重試提示：
  - 檢查 FFmpeg
  - 稍後再試
  - 改用穩定速度模式
  - 檢查下載資料夾權限
- 可選的 Details disclosure，顯示已清理過的技術文字

### 設定

Settings > Downloads 應保留既有 FFmpeg 與下載根目錄控制，並加入簡單的速度與穩定性設定。

建議第一版 UI：

| 模式     | 行為                                                    |
| -------- | ------------------------------------------------------- |
| Stable   | 較低 segment concurrency，降低 CDN 拒絕風險。           |
| Balanced | 目前預設行為。                                          |
| Fast     | 較高 segment concurrency，部分 CDN session 可能較不穩。 |

實作可以把這些模式 map 到 Rust downloader options，不必直接暴露 raw worker counts：

| 模式     | 建議 min | 建議 max |
| -------- | -------- | -------- |
| Stable   | 4        | 8        |
| Balanced | 8        | 32       |
| Fast     | 16       | 32       |

未來 Advanced 區塊可以提供自訂 min/max concurrency，但第二版不應依賴它。

## 資料模型

保留目前 SQLite `download_assets` table 作為 source of truth。

第二版可視需要加入 attempt metadata：

```sql
ALTER TABLE download_assets ADD COLUMN failure_phase TEXT;
ALTER TABLE download_assets ADD COLUMN failure_code TEXT;
ALTER TABLE download_assets ADD COLUMN attempt_count INTEGER;
ALTER TABLE download_assets ADD COLUMN last_started_at TEXT;
ALTER TABLE download_assets ADD COLUMN last_error_at TEXT;
```

建議語意：

| Field             | 意義                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| `failure_phase`   | `ffmpeg_check`、`video_page`、`playlist`、`segments`、`remux`、`file`。 |
| `failure_code`    | App 自有穩定代碼，例如 `segment_http_428` 或 `ffmpeg_exit`。            |
| `attempt_count`   | 這個 asset 已開始下載嘗試的次數。                                       |
| `last_started_at` | 最近一次 attempt 開始時間。                                             |
| `last_error_at`   | 最近一次失敗時間。                                                      |

這些欄位服務 UI 與 retry policy，不應保存 secrets、signed URLs、cookies、HLS keys 或本機絕對路徑。

下載速度模式應存在 app settings，不存在每筆 asset record；除非未來需要 per-download override。

## 下載流程

第二版應保留目前 pipeline：

1. main process 負責 queue orchestration、Jable cookies/headers、cancellation 與 FFmpeg process supervision
2. Rust native download engine 負責 HLS key 與 segment HTTP fetching
3. FFmpeg 維持外部 binary，負責 MP4 remux 與支援的 local HLS AES-128 decryption

建議第二版改善：

- CDN-sensitive HTTP statuses 仍必須觸發 lower concurrency retry。
- 如果 concurrency fallback 後仍像是 segment URL 過期或被拒絕，main 應重新抓取 video page 與 playlist 一次，並在 segment identity 相容時重試 unfinished work。
- Retry policy 應區分：
  - transient HTTP errors
  - concurrency-sensitive rejection
  - playlist extraction failure
  - unsupported playlist/key format
  - remux failure
  - local filesystem failure
- Cancellation 在 Rust segment download 與 FFmpeg remux 階段都要保持反應快速。
- Runtime progress 維持 runtime-only，除了 paused/resumed 這類持久化狀態轉換。
- 暫停 active download 時，App 會 abort Rust segment downloader 或 kill FFmpeg remux process，將 record 標記為 `paused`，移除不可靠的 `.mp4.part`，並保留 `.segments` directory。
- 繼續 paused download 時，App 會重新抓取 video page 與 playlist，在可用時用保存的 segment manifest 驗證 playlist 相容性，重用已完成的 segment files，下載缺少的 segments，最後再用 FFmpeg 從 local playlist remux。
- 如果保留的 segments 與重新抓到的 playlist 不相容，App 可以丟棄保留的 `.segments` directory，重新開始 segment 階段，避免產生損壞 MP4。
- Cancel 維持破壞性：它會丟棄 resumable temp segments，並將 record 標記為 canceled/failed。
- 使用者在有 active 或 queued downloads 時正常關閉 App，App 會提示是否先暫停下載再關閉。確認後 active 與 queued records 會變成 `paused`。
- 非正常離開或 crash 會在下次啟動時復原：不再有 runtime owner 的 persisted `queued` 或 `downloading` records 會被轉成 `paused`。

## 暫停與繼續

第二版包含受管理下載的真正 pause/resume。

支援模型是 segment-level resume：

- 已完成的 segment files 會保留在受管理的 `.segments` working directory。
- 未完成的 segment `.part` files 不被信任，resume 時可以覆寫。
- MP4 `.part` files 不會 resume。如果暫停發生在 FFmpeg remux 階段，`.mp4.part` 會被移除，resume 後重新 remux。
- Resume 需要下載紀錄保留原本的受管理 `localPath`；如果使用者更換下載根目錄，舊 working files 可能無法使用。
- Resume 由使用者手動觸發。App 啟動時不應自動 resume paused downloads。

狀態：

- `queued`：等待開始。
- `downloading`：正在進行 Rust segment download 或 FFmpeg remux。
- `paused`：使用者主動停止，或 App 關閉復原後停止；working files 與來源 playlist 相容時可繼續。
- `failed`：終止性的失敗或取消狀態，除非使用者從頭 retry。
- `ready`：最終 MP4 存在。
- `missing`：曾預期有最終 MP4，但檔案已不存在。

關閉行為：

- 如果使用者嘗試在 queued 或 active downloads 存在時關閉或退出 App，顯示確認 dialog。
- 主要動作是暫停下載並關閉 App。
- 次要動作是回到 App。
- 正常確認關閉後，active/queued downloads 會持久化為 `paused`。
- crash 或 force quit 後，下次啟動會把 orphaned `queued`/`downloading` records reconcile 成 `paused`。

## 批次下載

選取列批次下載是第二版基礎能力之一，但不應預設自動下載整個 collection。

建議安全範圍：

- 使用者可以選取目前可見的 Local Data rows，並 enqueue selected videos。
- 已經 ready、queued 或 downloading 的影片會被略過。
- Failed 與 missing 影片可以被包含為 retry。
- Queue concurrency 由既有的「最大同時下載數」使用者設定控制。
- UI 清楚顯示將排入幾支影片。

整個 collection 自動下載仍建議留到後續 enhancement，因為需要更完整的儲存空間、意外排入大量影片、CDN 負載與取消流程 guardrails。

## 播放時觸發下載

想法：當使用者已經在 embedded browser 播放影片時，App 可能已知道 active playlist URL 與 request headers。第二版應研究這是否能減少下載前的重複準備工作。

重要限制：

- Browser playback 確實會把 media segments 下載到 Chromium 內部，但那些 cached bytes 不是穩定、可由 App 管理的 MP4 檔案。
- 第二版不應假設 App 可以安全地把 Chromium cache 當成正式下載資產。

建議方向：

- 未來可加入選項，例如「播放中影片提供下載」。
- 偵測目前播放中的 trusted Jable video page 與 observed HLS playlist URL。
- 使用 observed playlist URL 與 headers 排入一般受管理下載。
- 如果未來研究證明 segment cache reuse 安全，再作為獨立最佳化加入，且必須有明確驗證。

這樣使用者容易理解：播放可以幫忙發現媒體來源，但 Download Manager 仍負責產生受管理的本機檔案。

## 安全與隱私

- Renderer 仍不得取得不受限制的 filesystem access。
- Renderer 仍不得提交本機路徑給 download、open、reveal 或 delete operations。
- Error details 必須持續遮蔽：
  - Jable cookies
  - signed playlist 或 segment URLs
  - HLS keys
  - 完整本機受管理絕對路徑
- Batch actions 不得改變 Jable remote collection state。
- 播放時觸發下載只適用 trusted Jable video URLs 與既有隔離 Jable session。

## 實作里程碑

1. UI audit 與互動整理
   - 收斂來源卡片下載按鈕狀態
   - 改善 Download List row density、action placement 與 error presentation
   - 降低一般狀態變更 toast 噪音

2. 下載清單篩選與安全 bulk actions
   - 加入 status filters 或 grouping
   - 加入 retry failed 與 cancel queued
   - 可選加入 selected-row actions

3. 下載速度模式
   - 新增持久化 `downloadSpeedMode`
   - 將 Stable/Balanced/Fast map 到 Rust min/max concurrency
   - Balanced 維持預設

4. Pause/resume 與 shutdown recovery
   - 加入 `paused` asset state
   - 加入 pause/resume IPC 與 renderer actions
   - 為 paused downloads 保留 `.segments` working directories
   - resume 時驗證 segment manifest
   - graceful quit 時提示並暫停 downloads
   - 啟動時將 orphaned queued/downloading records reconcile 成 paused

5. Failure metadata 與 retry hints
   - 視需要加入穩定 failure phase/code
   - 更新本地化錯誤顯示
   - 增加 sanitized details 測試

6. Playlist refresh retry
   - 在相容的 segment rejection 或 expiration 後重新抓 page/playlist 一次
   - 只在安全時 retry unfinished segments
   - 保留 cancellation 行為

7. 播放時觸發下載 research spike
   - 檢查 observed media request 可用性
   - 驗證 playlist/header reuse 是否足夠
   - 未驗證前明確延後 Chromium cache byte reuse

## 測試計畫

- Rust tests：speed mode mapping 與 concurrency fallback behavior。
- Node tests：新 settings normalization 與 data-engine migration fields。
- Node tests：error classification 與 sanitization。
- Renderer tests：Download List filters、bulk actions、source-card state display。
- Electron tests：FFmpeg missing、queue/pause/resume/cancel/retry、graceful quit recovery、open/reveal、download-root safety。
- macOS 與 Windows manual tests：
  - Stable/Balanced/Fast modes
  - pause active download 並 resume，不從零開始
  - active downloads 存在時 graceful quit
  - force quit/crash 後復原為 paused state
  - failed retry
  - cancel active download
  - retry failed batch
  - delete local file
  - missing-file reconciliation

## 決策

- 第二版包含 selected-row batch download。
- 第二版包含可設定最大同時下載數。
- 第二版包含 segment-level pause/resume。
- Resume 會重用已完成的 HLS segment files，但不 resume `.mp4.part` output。
- Graceful app close 會在使用者確認後暫停 active 與 queued downloads。

## 待確認問題

- Speed mode 是否只做 Stable/Balanced/Fast，還是同時提供 Advanced custom min/max UI？
- Ready source-card click 要開啟本機檔案，還是來源卡片只顯示狀態，開啟保留給 Download List？
- 播放時觸發下載要放進第二版交付，還是只做 V3 前的 research spike？
