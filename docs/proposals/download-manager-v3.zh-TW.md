# 下載清單 V3 Proposal

Status: draft, not finalized

Created: 2026-05-17

基準：`docs/specs/download-manager.md`，最後於 2026-05-17 對照實作確認。

這份文件集中整理 Download Manager 在 V1/V2 後尚未完成的工作。已經實作完成的行為應放在 `docs/specs/download-manager.md`；這份 proposal 只描述未來產品與工程方向。

## Summary

Download Manager 目前已支援受管理 MP4 下載、SQLite `download_assets` 紀錄、指定資料列批次下載、可設定同時下載數、Rust 併發下載 segments、FFmpeg remux、Download List UI、pause/resume，以及安全關閉復原。

V3 應聚焦剩下的管理與復原能力：

- 讓 Download List 更容易掃描 queue 與狀態
- 安全的批次操作
- 使用者看得懂的速度/穩定性模式
- 結構化失敗 metadata
- signed playlist 或 segment URL 過期/被拒絕後的更好 retry
- 簡潔但可追查的錯誤詳情
- 播放時觸發下載 discovery 的研究路徑

## Goals

- 讓 Download List 在 active、paused、failed、ready、missing 混在一起時更容易掃描。
- 加入安全的批次清理與復原操作。
- 加入簡單的 download speed modes，不預設暴露底層 Rust downloader 參數。
- 持久化足夠的 attempt metadata，用於解釋失敗與支援未來 retry policy。
- 改善 signed playlist 或 segment URLs 過期時的 retry recovery。
- 卡片上維持簡短使用者可讀錯誤，但保留可選的 sanitized 技術細節。
- 保留目前架構：main process orchestration、Rust HLS key/segment fetching、外部 FFmpeg remux。
- 維持明確使用者操作；不預設啟用整個 collection 自動下載。

## Non-Goals

- V3 不加入內建影片播放器。
- V3 不 bundle FFmpeg。
- 不同步下載檔案到雲端。
- 不改 Favourites 或 Watch Later JSON import/export backup 格式。
- 不把 Chromium HTTP cache 當成 canonical downloaded media store。
- 不預設啟用整個 collection 自動下載。
- 不 resume 部分寫入的 MP4 output file。Resume 仍維持 segment-level。

## Current Baseline

以下行為已經實作，除非 V3 要變更，否則不在這份 proposal 重新規格化：

- Download records 持久化在 SQLite `download_assets`。
- 下載檔案放在使用者可選的 managed root。
- 檔案路徑以 managed-root-relative path 儲存。
- Downloaded assets 獨立於 Favourites / Watch Later membership。
- Download List 顯示受管理下載紀錄，並有 search、state filter、sort controls。
- Local Data cards 有 compact per-video download actions。
- 使用者可以勾選 visible Local Data rows 並批次排入下載。
- Settings 有 maximum active video downloads。
- Rust 用 sampled adaptive concurrency 與 connection reuse 下載 HLS keys / segments。
- FFmpeg 將 local HLS media remux 成 MP4。
- Pause/resume 會保留可重用的 completed segment files。
- 正常關閉 App 時，確認後會暫停 queued/active downloads。
- Crash 或 force quit 後會把 orphaned queued/downloading records reconcile 成 `paused`。

## Download List UX

V3 應改善掃描與日常操作，但不要讓每張卡片變得太吵。

可能改善：

- 加入更清楚的 state filters 或 grouping：
  - All
  - Active
  - Paused
  - Failed
  - Ready
  - Missing

me: 等待中的資料使用者是否能看到？

- 下載中時加入 compact active queue section。

me: 不懂意思
- Source cards 維持 compact；詳細進度、錯誤、bulk actions、cleanup controls 留在 Download List。
- 當使用者已經在 Download List 時，降低 routine transition toasts 的干擾。
- 決定 ready source-card click 是否開啟本機檔案，或繼續保留在 Download List 才能開啟。

## Bulk Actions

安全批次操作應放在 Download List，不放在 source cards。

建議 actions：

- Retry Failed
- Cancel Queued
- ~~Clear Completed Records~~ (不做，與本功能提供本意衝突)
- Delete Selected Local Files (刪資料庫紀錄？ 還是檔案也刪？ 如果沒有檔案呢？)

規則：

- Bulk delete 必須跳確認。
- Bulk delete 不得移除 Favourites、Watch Later 或 Jable remote state。
- ~~Clear Completed Records 應移除 Download List 裡的 ready records。如果它也會刪本機檔案，UI 必須明確說明；否則它應只清除已不存在檔案的 records，或刻意保留檔案不動。這個行為實作前需要產品確認。~~
- Cancel Queued 不得刪除已完成的本機檔案。
- Retry Failed 不得 duplicate existing ready、queued、downloading assets。

## Speed Modes

V3 應在 Settings > Downloads 加入使用者看得懂的 speed/stability setting。

建議第一版 UI：

| Mode     | Behavior                                                  |
| -------- | --------------------------------------------------------- |
| Stable   | 較低 segment concurrency，降低 CDN 拒絕風險。             |
| Balanced | 目前預設行為。                                            |
| Fast     | 較高 initial concurrency，部分 CDN session 可能比較不穩。 |

建議 mapping：

| Mode     | Segment min | Segment max |
| -------- | ----------- | ----------- |
| Stable   | 4           | 8           |
| Balanced | 8           | 32          |
| Fast     | 16          | 32          |

待定：

- V3 是否只提供 Stable/Balanced/Fast，或也加入 Advanced custom min/max UI。

## Failure Metadata

V3 可以視需要擴充 `download_assets` attempt 欄位：

```sql
ALTER TABLE download_assets ADD COLUMN failure_phase TEXT;
ALTER TABLE download_assets ADD COLUMN failure_code TEXT;
ALTER TABLE download_assets ADD COLUMN attempt_count INTEGER;
ALTER TABLE download_assets ADD COLUMN last_started_at TEXT;
ALTER TABLE download_assets ADD COLUMN last_error_at TEXT;
```

建議語意：

| Field             | Meaning                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `failure_phase`   | `ffmpeg_check`、`video_page`、`playlist`、`segments`、`remux`、`file`。 |
| `failure_code`    | App 自有穩定代碼，例如 `segment_http_428` 或 `ffmpeg_exit`。            |
| `attempt_count`   | 此 asset 已開始嘗試的次數。                                             |
| `last_started_at` | 最近一次 attempt start timestamp。                                      |
| `last_error_at`   | 最近一次 failure timestamp。                                            |

規則：

- 不儲存 cookies、signed URLs、HLS keys、或 absolute local paths。
- Stable codes 應支援 UI labels 與 retry decisions。
- Raw external command output 顯示前仍必須 sanitized。

## Error Details UX

Failed rows 在卡片上顯示簡短 localized reason，技術細節只在使用者需要時展開。

建議 short reasons：

- FFmpeg not installed
- Playlist not found
- Segment request rejected
- Segment download failed
- FFmpeg remux failed
- File system error
- Download canceled

建議 details 行為：

- 用 details modal 或 disclosure 顯示 sanitized technical text。
- Technical details 必須遮蔽 cookies、signed playlist/segment URLs、HLS keys、managed absolute paths。
- Details 應該用於 troubleshooting，不應佔據一般卡片版面。

## Playlist Refresh Retry

V3 應改善 signed playlist 或 segment URLs 過期/被拒絕時的 recovery。

建議行為：

- Rust 保留對 HTTP 403、428、429、503、504 等 CDN-sensitive statuses 的 concurrency fallback。
- 如果 concurrency fallback 後仍出現相容的 segment rejection 或 expiration pattern，main process 可以重新抓 video page 與 playlist 一次。
- Refresh 後，只在 refreshed playlist 與本機保留 segment structure 相容時 retry unfinished segment work。
- Refresh 與 retry 期間 cancellation 必須維持快速反應。
- Retry path 不得 duplicate completed local segments，也不得破壞 resumable state。

## Playback-Triggered Download Research

播放時觸發下載仍是 research item。

建議方向：

- 研究 embedded browser 是否能穩定提供 currently playing trusted Jable video page 與 observed HLS playlist URL。
- 如果可靠，可以加入 opt-in setting，例如 "Offer download for currently playing video"。
- Setting 必須預設關閉。
- Playback 可以協助發現 media source，但 Download Manager 仍負責產生受管理本機檔案。
- 不假設 Chromium cache bytes 可以重用成最終 downloaded asset。

明確限制：

- 只在 trusted Jable video detail pages 觸發。
- 不從 hover previews 觸發。
- 不 duplicate existing ready、queued、downloading assets。
- Missing FFmpeg 仍用與 manual downloads 相同的 setup-required 行為阻擋 MP4 assembly。
- 不記錄 cookies、signed tokens、HLS keys、segment URLs 或完整 local paths。

## Carry-Over Cleanup

舊 proposal 提過一些目前未照原文實作的行為。V3 應該刪除或重新決策：

- Dedicated `getDownloadStates(videoUrls)` / `countDownloads(options)` IPC methods，或維持目前 `listDownloads()` 加 renderer filtering。
- Separate `download-state-changed`、`download-progress`、`download-error` events，或維持目前 consolidated `downloads-changed`。
- Download row context menu actions，或維持目前 in-card buttons。
- Persisted `deleting` state for delete-in-progress，目前沒有使用。
- Download List cards 直接顯示 source URL，目前用 Open Page action 代表。

## Implementation Milestones

1. Download List state scanning
   - 加入更細 state filters 或 grouping
   - 可選加入 compact active queue section
   - persisted filter behavior 與 settings 保持一致

2. Bulk actions
   - 加入 Retry Failed
   - 加入 Cancel Queued
   - 決定並實作 Clear Completed Records 語意
   - 設計需要 confirmation 的 Delete Selected Local Files

3. Speed modes
   - 加入 persisted `downloadSpeedMode`
   - 將 Stable/Balanced/Fast map 到 Rust min/max segment concurrency
   - Balanced 維持 default
   - 加入 settings normalization 與 Rust request options tests

4. Failure metadata and error details
   - 視需要加入 stable failure phase/code
   - 視需要持久化 attempt timestamps/counts
   - 加入 localized retry hints
   - 加入 sanitized details modal/disclosure

5. Playlist refresh retry
   - 分類相容的 expiration/rejection failures
   - 重新抓 video page 與 playlist 一次
   - 只在相容時 retry unfinished segment work

6. Playback-triggered download research
   - 檢查 observed media request availability
   - 判斷 playlist/header reuse 是否足夠
   - Chromium cache byte reuse 除非證明安全，否則繼續 defer

## Test Plan

- Rust tests：speed mode mapping 與 concurrency fallback behavior。
- Node tests：settings normalization 與任何新的 migration fields。
- Node tests：failure classification、stable failure codes、sanitization。
- Renderer tests：Download List filters/grouping、bulk actions、error details、source-card state behavior。
- Electron tests：graceful quit with active downloads、pause/resume/cancel/retry、open/reveal、download-root safety。
- macOS / Windows manual tests：
  - Stable/Balanced/Fast modes
  - Retry Failed
  - Cancel Queued
  - Clear Completed Records
  - Delete Selected Local Files
  - segment URL rejection 後 failed retry
  - playback-triggered download research observations

## Open Questions

- Clear Completed Records 應刪除檔案、只移除 missing-file records，還是應改成更精準的命名？
- Speed mode 是否只做 Stable/Balanced/Fast，還是也要 Advanced custom min/max controls？
- Ready source-card click 是否開啟本機檔案，或繼續保留在 Download List？
- Playback-triggered download 應納入 V3 delivery，還是只做 research spike 留到後續版本？
