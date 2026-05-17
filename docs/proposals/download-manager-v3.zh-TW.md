# 下載清單 V3 Proposal

Status: finalized

Created: 2026-05-17

Finalized: 2026-05-17

基準：`docs/specs/download-manager.md`，最後於 2026-05-17 對照實作確認。

這份文件集中整理 Download Manager 在 V1/V2 後尚未完成的 V3 工作。已經實作完成的行為應放在 `docs/specs/download-manager.md`；這份 proposal 只描述已定稿的 V3 產品與工程方向，以及明確留到 V3 之後的 future research。

## Summary

Download Manager 目前已支援受管理 MP4 下載、SQLite `download_assets` 紀錄、指定資料列批次下載、可設定同時下載數、Rust 併發下載 segments、FFmpeg remux、Download List UI、pause/resume，以及安全關閉復原。

V3 聚焦剩下的管理與復原能力：

- 讓 Download List 更容易掃描 queue 與狀態。
- 加入安全的批次操作。
- 加入使用者看得懂的速度/穩定性模式。
- 持久化足夠的失敗 metadata，支援 retry decision 與 sanitized error log。
- 改善 signed playlist 或 segment URL 過期/被拒絕後的 retry recovery。
- 卡片維持簡短錯誤提示，技術細節集中到可選的 Download Error Log。
- 播放時觸發下載 discovery 不納入 V3 delivery，僅保留為 future research。

## Goals

- 讓 Download List 在 queued、downloading、paused、failed、ready、missing 混在一起時更容易掃描。
- 加入安全的批次暫停、取消、重試與刪除操作。
- 加入簡單的 download speed modes，不暴露底層 Rust downloader min/max 參數。
- 持久化足夠的 attempt metadata，用於解釋失敗、建立錯誤紀錄與支援 retry policy。
- 改善 signed playlist 或 segment URLs 過期時的 retry recovery。
- Download List 卡片維持目前簡短、使用者可讀的錯誤提示，不在卡片上顯示技術細節。
- 保留目前架構：main process orchestration、Rust HLS key/segment fetching、外部 FFmpeg remux。
- 維持明確使用者操作；不預設啟用整個 collection 自動下載。

## Non-Goals

- V3 不加入內建影片播放器。
- V3 不 bundle FFmpeg。
- V3 不交付 playback-triggered download。
- 不同步下載檔案到雲端。
- 不改 Favourites 或 Watch Later JSON import/export backup 格式。
- 不把 Chromium HTTP cache 當成 canonical downloaded media store。
- 不預設啟用整個 collection 自動下載。
- 不 resume 部分寫入的 MP4 output file。Resume 仍維持 segment-level。
- 不加入 Advanced custom segment concurrency min/max UI。
- 不加入 Clear Completed Records。

## Current Baseline

以下行為已經實作，除非 V3 要變更，否則不在這份 proposal 重新規格化：

- Download records 持久化在 SQLite `download_assets`。
- 下載檔案放在使用者可選的 managed root。
- 檔案路徑以 managed-root-relative path 儲存。
- Downloaded assets 獨立於 Favourites / Watch Later membership。
- Download List 顯示受管理下載紀錄，並有 search、state filter、sort controls。
- Download List 已顯示 `queued` records，中文狀態為「等待中」。
- Local Data cards 有 compact per-video download actions。
- 使用者可以勾選 visible Local Data rows 並批次排入下載。
- Settings 有 maximum active video downloads。
- Rust 用 sampled adaptive concurrency 與 connection reuse 下載 HLS keys / segments。
- FFmpeg 將 local HLS media remux 成 MP4。
- Pause/resume 會保留可重用的 completed segment files。
- 正常關閉 App 時，確認後會暫停 queued/active downloads。
- Crash 或 force quit 後會把 orphaned queued/downloading records reconcile 成 `paused`。

## Final Decisions

- Source cards 保持 compact。Ready source-card click 不開啟本機檔案；只有 Download List 可以 open/reveal downloaded file。
- Download List 卡片上的 failed/missing 提示暫時不改。卡片只顯示簡短 localized reason，不顯示 raw technical details。
- Download Error Log 放在 Local Data / Download List 的右上角入口，位置概念類似 collection 的完整同步 action。
- Speed mode 只提供 Stable、Balanced、Fast。
- V3 加入 Pause All，作用於 queued 與 downloading records。
- V3 加入 Cancel All Queued，只取消 queued records。
- V3 不加入 Clear Completed Records。
- 批次刪除命名為 Delete Selected Downloads，不命名為 Delete Selected Local Files。
- 舊 proposal 提過的 dedicated download state IPC、separate progress/error events、download row context menu、source URL 直接顯示皆維持目前做法。
- Persisted `deleting` state 不納入 V3；如果文件或 dead code 仍有殘留，後續可移除。

## Download List UX

V3 應改善掃描與日常操作，但不要讓每張卡片變得太吵。

State filtering 應支援更清楚的狀態切換：

- All
- Active (`queued` + `downloading`)
- Queued
- Downloading
- Paused
- Failed
- Ready
- Missing

規則：

- `queued` records 必須可見，並且在 state chip 上顯示等待中狀態。
- Download List 可以用 filter 或 grouping 改善掃描，但 V3 不加入獨立的 compact active queue section。
- Source cards 維持 compact；詳細進度、錯誤、bulk actions、cleanup controls 留在 Download List。
- 當使用者已在 Download List 時，routine queue/state transition 不需要額外增加干擾性 toast；完成、失敗、使用者明確操作結果仍可提示。
- Ready source-card click 不開啟本機檔案，仍保留在 Download List 才能 open/reveal。

## Bulk Actions

安全批次操作應放在 Download List，不放在 source cards。

V3 actions：

- Retry Failed
- Pause All
- Cancel All Queued
- Delete Selected Downloads

規則：

- Retry Failed 應處理 failed 與 missing records，但不得 duplicate existing ready、queued、downloading assets。
- Pause All 作用於 queued 與 downloading records，結果應是 `paused`，並盡可能保留可 resume 的 completed segment files。
- Cancel All Queued 只作用於 queued records，不取消 active downloads。
- Cancel All Queued 會移除等待佇列中的項目，並可清理該項目的暫存工作檔；它不得刪除任何已完成的 ready MP4。
- Delete Selected Downloads 只應對 ready、paused、failed、missing records 開放。
- Delete Selected Downloads 必須跳確認。
- Delete Selected Downloads 有 managed 本機檔案時刪除檔案並移除資料庫 download record；沒有 managed 本機檔案時只移除 download record 與可安全清理的暫存工作檔。
- Delete Selected Downloads 不得移除 Favourites、Watch Later 或 Jable remote state。
- Clear Completed Records 不做，因為它與下載清單作為本機檔案管理入口的目的衝突。

## Speed Modes

V3 應在 Settings > Downloads 加入使用者看得懂的 speed/stability setting。

第一版 UI 只提供三個模式：

| Mode     | Behavior                                                  |
| -------- | --------------------------------------------------------- |
| Stable   | 較低 segment concurrency，降低 CDN 拒絕風險。             |
| Balanced | 目前預設行為。                                            |
| Fast     | 較高 initial concurrency，部分 CDN session 可能比較不穩。 |

Mapping：

| Mode     | Segment min | Segment max |
| -------- | ----------- | ----------- |
| Stable   | 4           | 8           |
| Balanced | 8           | 32          |
| Fast     | 16          | 32          |

規則：

- Balanced 維持預設。
- Settings 只存 `downloadSpeedMode`，不讓使用者直接設定 min/max。
- 不加入 Advanced custom min/max UI。

## Failure Metadata

V3 可以擴充 `download_assets` attempt 欄位：

```sql
ALTER TABLE download_assets ADD COLUMN failure_phase TEXT;
ALTER TABLE download_assets ADD COLUMN failure_code TEXT;
ALTER TABLE download_assets ADD COLUMN attempt_count INTEGER;
ALTER TABLE download_assets ADD COLUMN last_started_at TEXT;
ALTER TABLE download_assets ADD COLUMN last_error_at TEXT;
```

語意：

| Field             | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `failure_phase`   | `ffmpeg_check`、`video_page`、`playlist`、`segments`、`remux`、`file`。 |
| `failure_code`    | App 自有穩定代碼，例如 `segment_http_428` 或 `ffmpeg_exit`。            |
| `attempt_count`   | 此 asset 已開始嘗試的次數。                                             |
| `last_started_at` | 最近一次 attempt start timestamp。                                      |
| `last_error_at`   | 最近一次 failure timestamp。                                            |

用途：

- 讓 retry policy 可以根據失敗階段與 stable code 做決策，而不是解析 localized error text。
- 讓 Download Error Log 能顯示「在哪個階段失敗」、「失敗代碼」、「最後失敗時間」、「嘗試次數」。
- 讓 playlist refresh retry 能辨識 signed playlist/segment URL 過期或被 CDN 拒絕的模式。
- 讓未來 telemetry-free troubleshooting 可以只依賴本機 sanitized metadata。
- 減少 renderer 以 regex 推論錯誤分類的責任。

規則：

- 不儲存 cookies、signed URLs、HLS keys、或 absolute local paths。
- Stable codes 應支援 UI labels 與 retry decisions。
- Raw external command output 顯示前仍必須 sanitized。
- Failure metadata 不需要直接顯示在一般 Download List 卡片上。

## Error Details UX

Failed/missing rows 在卡片上繼續顯示目前的簡短 localized reason。V3 不重新設計卡片上的失敗提示文案。

V3 應新增 Download Error Log：

- 入口放在 Local Data / Download List 右上角。
- Log 可以用 modal、drawer 或同等不佔卡片版面的方式呈現。
- Log 顯示 failed/missing records 的 sanitized troubleshooting details。
- Log 可顯示 title、video URL、state、short reason、failure phase、failure code、attempt count、last started time、last error time。
- Technical details 必須遮蔽 cookies、signed playlist/segment URLs、HLS keys、managed absolute paths。
- 使用者不需要在一般卡片上看到技術細節；Error Log 是需要排查問題時才打開的入口。

## Playlist Refresh Retry

V3 應改善 signed playlist 或 segment URLs 過期/被拒絕時的 recovery。

行為：

- Rust 保留對 HTTP 403、428、429、503、504 等 CDN-sensitive statuses 的 concurrency fallback。
- 如果 concurrency fallback 後仍出現相容的 segment rejection 或 expiration pattern，main process 可以重新抓 video page 與 playlist 一次。
- Refresh 後，只在 refreshed playlist 與本機保留 segment structure 相容時 retry unfinished segment work。
- Refresh 與 retry 期間 cancellation 必須維持快速反應。
- Retry path 不得 duplicate completed local segments，也不得破壞 resumable state。

## Future: Playback-Triggered Download Research

Playback-triggered download 不納入 V3 delivery。V3 只保留以下 future research notes，後續版本若要實作，需要另開 proposal 或 spec update。

未來研究方向：

- 研究 embedded browser 是否能穩定提供 currently playing trusted Jable video page 與 observed HLS playlist URL。
- 如果可靠，可以加入 opt-in setting，例如 "Offer download for currently playing video"。
- Setting 必須預設關閉。
- Playback 可以協助發現 media source，但 Download Manager 仍負責產生受管理本機檔案。
- 不假設 Chromium cache bytes 可以重用成最終 downloaded asset。

未來若實作，限制仍應包含：

- 只在 trusted Jable video detail pages 觸發。
- 不從 hover previews 觸發。
- 不 duplicate existing ready、queued、downloading assets。
- Missing FFmpeg 仍用與 manual downloads 相同的 setup-required 行為阻擋 MP4 assembly。
- 不記錄 cookies、signed tokens、HLS keys、segment URLs 或完整 local paths。

## Carry-Over Cleanup

舊 proposal 提過一些目前未照原文實作的行為。V3 定稿決策如下：

- 維持目前 `listDownloads()` 加 renderer filtering，不加入 dedicated `getDownloadStates(videoUrls)` / `countDownloads(options)` IPC methods。
- 維持目前 consolidated `downloads-changed` event，不拆成 separate `download-state-changed`、`download-progress`、`download-error` events。
- 維持目前 in-card buttons，不加入 Download row context menu actions。
- 不使用 persisted `deleting` state；如果後續發現文件或 dead code 殘留，可移除。
- Download List cards 不直接顯示 source URL，維持用 Open Page action 代表。

## Implementation Milestones

1. Download List state scanning
   - 加入 finalized state filters。
   - 確認 queued records 可見且標示清楚。
   - 維持 source-card ready click 不開啟本機檔案。
   - persisted filter behavior 與 settings 保持一致。

2. Bulk actions
   - 加入 Retry Failed。
   - 加入 Pause All。
   - 加入 Cancel All Queued。
   - 加入 Delete Selected Downloads 與 confirmation。
   - 確認所有 bulk actions 不影響 Favourites、Watch Later 或 Jable remote state。

3. Speed modes
   - 加入 persisted `downloadSpeedMode`。
   - 將 Stable/Balanced/Fast map 到 Rust min/max segment concurrency。
   - Balanced 維持 default。
   - 加入 settings normalization 與 Rust request options tests。

4. Failure metadata and Download Error Log
   - 加入 stable failure phase/code。
   - 持久化 attempt timestamps/counts。
   - 加入 sanitized Download Error Log。
   - 卡片錯誤提示維持目前短文案。

5. Playlist refresh retry
   - 分類相容的 expiration/rejection failures。
   - 重新抓 video page 與 playlist 一次。
   - 只在相容時 retry unfinished segment work。

6. Carry-over cleanup
   - 移除或忽略 stale `deleting` state 相關殘留。
   - 確認舊 proposal 中未採納的 IPC/event/context-menu/source-URL 行為不進 V3。

## Test Plan

- Rust tests：speed mode mapping 與 concurrency fallback behavior。
- Node tests：settings normalization 與新的 migration fields。
- Node tests：failure classification、stable failure codes、sanitization。
- Renderer tests：Download List filters/grouping、bulk actions、Download Error Log、source-card state behavior。
- Electron tests：graceful quit with active downloads、pause/resume/cancel/retry、Pause All、Cancel All Queued、open/reveal、download-root safety。
- macOS / Windows manual tests：
  - Stable/Balanced/Fast modes
  - Retry Failed
  - Pause All
  - Cancel All Queued
  - Delete Selected Downloads
  - Download Error Log sanitization
  - segment URL rejection 後 failed retry
