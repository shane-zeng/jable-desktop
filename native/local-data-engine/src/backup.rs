use napi::bindgen_prelude::*;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

use crate::collections::ensure_collection;
use crate::downloads::normalize_file_relative_path;
use crate::payload::{normalize_video_url, object_field, value_i64, value_string};
use crate::search::build_video_search_text;
use crate::{now_iso, to_napi_error, Engine};

const DOWNLOAD_STATES: [&str; 6] = [
    "queued",
    "downloading",
    "paused",
    "failed",
    "ready",
    "missing",
];
const DOWNLOAD_SOURCES: [&str; 2] = ["normal", "playback_auto"];

fn array_field(value: &Value, key: &str) -> Vec<Value> {
    object_field(value, key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn backup_rows(payload: &Value, key: &str) -> Vec<Value> {
    if object_field(payload, "data").is_some() {
        object_field(payload, "data")
            .map(|data| array_field(data, key))
            .unwrap_or_default()
    } else {
        array_field(payload, key)
    }
}

fn field<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    for key in keys {
        if let Some(field) = object_field(value, key) {
            return Some(field);
        }
    }
    None
}

fn bool_i64(value: Option<&Value>, fallback: bool) -> i64 {
    match value {
        Some(Value::Bool(flag)) => i64::from(*flag),
        Some(Value::Number(number)) => number
            .as_i64()
            .or_else(|| number.as_f64().map(|value| value as i64))
            .map(|value| i64::from(value != 0))
            .unwrap_or_else(|| i64::from(fallback)),
        Some(Value::String(text)) => match text.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" => 1,
            "false" | "0" | "no" | "" => 0,
            _ => i64::from(fallback),
        },
        _ => i64::from(fallback),
    }
}

fn optional_f64(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(number)) => number.as_f64(),
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                trimmed.parse::<f64>().ok()
            }
        }
        _ => None,
    }
}

fn required_video_url(value: &Value, keys: &[&str], method: &str) -> Result<String> {
    normalize_video_url(field(value, keys))
        .ok_or_else(|| Error::from_reason(format!("{method} requires a valid video URL")))
}

fn timestamp_field(value: &Value, keys: &[&str], fallback: &str) -> String {
    value_string(field(value, keys)).unwrap_or_else(|| fallback.to_string())
}

fn nullable_string_field(value: &Value, keys: &[&str]) -> Option<String> {
    value_string(field(value, keys))
}

fn normalize_download_state(value: Option<String>) -> Result<String> {
    let state = value.unwrap_or_else(|| "paused".to_string());
    if !DOWNLOAD_STATES.iter().any(|candidate| candidate == &state) {
        return Err(Error::from_reason(format!(
            "Unknown download backup state: {state}"
        )));
    }
    if state == "queued" || state == "downloading" {
        return Ok("paused".to_string());
    }
    Ok(state)
}

fn normalize_download_source(value: Option<String>) -> Result<String> {
    let source = value.unwrap_or_else(|| "normal".to_string());
    if DOWNLOAD_SOURCES
        .iter()
        .any(|candidate| candidate == &source)
    {
        return Ok(source);
    }
    Err(Error::from_reason(format!(
        "Unknown download backup source: {source}"
    )))
}

fn export_videos(engine: &Engine) -> Result<Vec<Value>> {
    let mut statement = engine
        .conn()?
        .prepare(
            "SELECT url, title, views, likes, img, preview, created_at, updated_at
       FROM videos
       ORDER BY url ASC",
        )
        .map_err(to_napi_error)?;

    let rows = statement
        .query_map([], |row| {
            Ok(json!({
              "url": row.get::<_, String>(0)?,
              "title": row.get::<_, Option<String>>(1)?,
              "views": row.get::<_, Option<i64>>(2)?,
              "likes": row.get::<_, Option<i64>>(3)?,
              "img": row.get::<_, Option<String>>(4)?,
              "preview": row.get::<_, Option<String>>(5)?,
              "created_at": row.get::<_, String>(6)?,
              "updated_at": row.get::<_, String>(7)?
            }))
        })
        .map_err(to_napi_error)?
        .collect::<std::result::Result<Vec<Value>, _>>()
        .map_err(to_napi_error)?;
    Ok(rows)
}

fn export_collection_items(engine: &Engine) -> Result<Vec<Value>> {
    let mut statement = engine
        .conn()?
        .prepare(
            "SELECT collection_key, video_url, first_seen_at, last_seen_at, site_order,
              is_visible, missing_at, last_sync_run_id
       FROM collection_items
       ORDER BY collection_key ASC, video_url ASC",
        )
        .map_err(to_napi_error)?;

    let rows = statement
        .query_map([], |row| {
            Ok(json!({
              "collection_key": row.get::<_, String>(0)?,
              "video_url": row.get::<_, String>(1)?,
              "first_seen_at": row.get::<_, String>(2)?,
              "last_seen_at": row.get::<_, String>(3)?,
              "site_order": row.get::<_, Option<i64>>(4)?,
              "is_visible": row.get::<_, i64>(5)? != 0,
              "missing_at": row.get::<_, Option<String>>(6)?,
              "last_sync_run_id": row.get::<_, Option<String>>(7)?
            }))
        })
        .map_err(to_napi_error)?
        .collect::<std::result::Result<Vec<Value>, _>>()
        .map_err(to_napi_error)?;
    Ok(rows)
}

fn export_sync_states(engine: &Engine) -> Result<Vec<Value>> {
    let mut statement = engine
        .conn()?
        .prepare(
            "SELECT collection_key, completed, last_scraped_page, last_known_url, updated_at
       FROM sync_states
       ORDER BY collection_key ASC",
        )
        .map_err(to_napi_error)?;

    let rows = statement
        .query_map([], |row| {
            Ok(json!({
              "collection_key": row.get::<_, String>(0)?,
              "completed": row.get::<_, i64>(1)? != 0,
              "last_scraped_page": row.get::<_, Option<i64>>(2)?,
              "last_known_url": row.get::<_, Option<String>>(3)?,
              "updated_at": row.get::<_, String>(4)?
            }))
        })
        .map_err(to_napi_error)?
        .collect::<std::result::Result<Vec<Value>, _>>()
        .map_err(to_napi_error)?;
    Ok(rows)
}

fn export_download_assets(engine: &Engine) -> Result<Vec<Value>> {
    let mut statement = engine
        .conn()?
        .prepare(
            "SELECT video_url, status, file_relative_path, format, title, img, preview,
              source_page_chinese_subtitle_notice, source_page_subtitle_notice_text,
              download_source, size_bytes, duration_seconds, progress,
              playback_auto_resume_blocked, error, failure_phase, failure_code,
              attempt_count, last_started_at, last_error_at, downloaded_at,
              last_checked_at, created_at, updated_at
       FROM download_assets
       ORDER BY video_url ASC",
        )
        .map_err(to_napi_error)?;

    let rows = statement
        .query_map([], |row| {
            Ok(json!({
              "video_url": row.get::<_, String>(0)?,
              "status": row.get::<_, String>(1)?,
              "file_relative_path": row.get::<_, Option<String>>(2)?,
              "format": row.get::<_, Option<String>>(3)?,
              "title": row.get::<_, Option<String>>(4)?,
              "img": row.get::<_, Option<String>>(5)?,
              "preview": row.get::<_, Option<String>>(6)?,
              "source_page_chinese_subtitle_notice": row.get::<_, i64>(7)? != 0,
              "source_page_subtitle_notice_text": row.get::<_, Option<String>>(8)?,
              "download_source": row.get::<_, String>(9)?,
              "size_bytes": row.get::<_, Option<i64>>(10)?,
              "duration_seconds": row.get::<_, Option<f64>>(11)?,
              "progress": row.get::<_, Option<f64>>(12)?,
              "playback_auto_resume_blocked": row.get::<_, i64>(13)? != 0,
              "error": row.get::<_, Option<String>>(14)?,
              "failure_phase": row.get::<_, Option<String>>(15)?,
              "failure_code": row.get::<_, Option<String>>(16)?,
              "attempt_count": row.get::<_, i64>(17)?,
              "last_started_at": row.get::<_, Option<String>>(18)?,
              "last_error_at": row.get::<_, Option<String>>(19)?,
              "downloaded_at": row.get::<_, Option<String>>(20)?,
              "last_checked_at": row.get::<_, Option<String>>(21)?,
              "created_at": row.get::<_, String>(22)?,
              "updated_at": row.get::<_, String>(23)?
            }))
        })
        .map_err(to_napi_error)?
        .collect::<std::result::Result<Vec<Value>, _>>()
        .map_err(to_napi_error)?;
    Ok(rows)
}

impl Engine {
    pub(crate) fn export_backup_data(&self) -> Result<Value> {
        let videos = export_videos(self)?;
        let collection_items = export_collection_items(self)?;
        let sync_states = export_sync_states(self)?;
        let download_assets = export_download_assets(self)?;

        Ok(json!({
          "videos": videos,
          "collection_items": collection_items,
          "sync_states": sync_states,
          "download_assets": download_assets
        }))
    }

    pub(crate) fn import_backup_data(&self, payload: Value) -> Result<Value> {
        let videos = backup_rows(&payload, "videos");
        let collection_items = backup_rows(&payload, "collection_items");
        let sync_states = backup_rows(&payload, "sync_states");
        let download_assets = backup_rows(&payload, "download_assets");
        let timestamp = now_iso();
        let mut warnings: Vec<Value> = Vec::new();

        let imported = self.with_immediate_transaction(|| {
            let mut imported_videos = 0usize;
            for video in &videos {
                let url = required_video_url(video, &["url", "video_url"], "importBackupData video")?;
                let title = nullable_string_field(video, &["title"]);
                let search_text = build_video_search_text(title.as_deref(), Some(&url));
                self.conn()?
                    .execute(
                        "INSERT INTO videos (url, title, views, likes, img, preview, search_text, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(url) DO UPDATE SET
                   title = excluded.title,
                   views = excluded.views,
                   likes = excluded.likes,
                   img = excluded.img,
                   preview = excluded.preview,
                   search_text = excluded.search_text,
                   updated_at = excluded.updated_at",
                        params![
                            url,
                            title,
                            value_i64(field(video, &["views"])),
                            value_i64(field(video, &["likes"])),
                            nullable_string_field(video, &["img"]),
                            nullable_string_field(video, &["preview"]),
                            search_text,
                            timestamp_field(video, &["created_at", "createdAt"], &timestamp),
                            timestamp_field(video, &["updated_at", "updatedAt"], &timestamp)
                        ],
                    )
                    .map_err(to_napi_error)?;
                imported_videos += 1;
            }

            let mut imported_collection_items = 0usize;
            for item in &collection_items {
                let Some(collection_key) =
                    value_string(field(item, &["collection_key", "collectionKey"]))
                else {
                    warnings.push(json!({
                      "code": "backup.collection_item_missing_collection",
                      "message": "A collection item was skipped because it has no collection key."
                    }));
                    continue;
                };
                if ensure_collection(&collection_key).is_err() {
                    warnings.push(json!({
                      "code": "backup.unknown_collection",
                      "collectionKey": collection_key
                    }));
                    continue;
                }
                let video_url = required_video_url(
                    item,
                    &["video_url", "videoUrl", "url"],
                    "importBackupData collection item",
                )?;
                self.conn()?
                    .execute(
                        "INSERT INTO collection_items (
                   collection_key, video_url, first_seen_at, last_seen_at,
                   site_order, is_visible, missing_at, last_sync_run_id
                 )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(collection_key, video_url) DO UPDATE SET
                   first_seen_at = excluded.first_seen_at,
                   last_seen_at = excluded.last_seen_at,
                   site_order = excluded.site_order,
                   is_visible = excluded.is_visible,
                   missing_at = excluded.missing_at,
                   last_sync_run_id = excluded.last_sync_run_id",
                        params![
                            collection_key,
                            video_url,
                            timestamp_field(item, &["first_seen_at", "firstSeenAt"], &timestamp),
                            timestamp_field(item, &["last_seen_at", "lastSeenAt"], &timestamp),
                            value_i64(field(item, &["site_order", "siteOrder"])),
                            bool_i64(field(item, &["is_visible", "isVisible"]), true),
                            nullable_string_field(item, &["missing_at", "missingAt"]),
                            nullable_string_field(item, &["last_sync_run_id", "lastSyncRunId"])
                        ],
                    )
                    .map_err(to_napi_error)?;
                imported_collection_items += 1;
            }

            let mut imported_sync_states = 0usize;
            for state in &sync_states {
                let Some(collection_key) =
                    value_string(field(state, &["collection_key", "collectionKey"]))
                else {
                    warnings.push(json!({
                      "code": "backup.sync_state_missing_collection",
                      "message": "A sync state was skipped because it has no collection key."
                    }));
                    continue;
                };
                if ensure_collection(&collection_key).is_err() {
                    warnings.push(json!({
                      "code": "backup.unknown_collection",
                      "collectionKey": collection_key
                    }));
                    continue;
                }
                let last_known_url = match field(state, &["last_known_url", "lastKnownUrl"]) {
                    Some(Value::Null) | None => None,
                    value => normalize_video_url(value).or_else(|| nullable_string_field(state, &["last_known_url", "lastKnownUrl"])),
                };
                self.conn()?
                    .execute(
                        "INSERT INTO sync_states (
                   collection_key, completed, last_scraped_page, last_known_url, updated_at
                 )
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(collection_key) DO UPDATE SET
                   completed = excluded.completed,
                   last_scraped_page = excluded.last_scraped_page,
                   last_known_url = excluded.last_known_url,
                   updated_at = excluded.updated_at",
                        params![
                            collection_key,
                            bool_i64(field(state, &["completed"]), false),
                            value_i64(field(state, &["last_scraped_page", "lastScrapedPage"])),
                            last_known_url,
                            timestamp_field(state, &["updated_at", "updatedAt"], &timestamp)
                        ],
                    )
                    .map_err(to_napi_error)?;
                imported_sync_states += 1;
            }

            let mut imported_download_assets = 0usize;
            for asset in &download_assets {
                let video_url = required_video_url(
                    asset,
                    &["video_url", "videoUrl", "url"],
                    "importBackupData download asset",
                )?;
                let local_path = normalize_file_relative_path(nullable_string_field(
                    asset,
                    &[
                        "file_relative_path",
                        "fileRelativePath",
                        "localPath",
                        "local_path",
                    ],
                ))?;
                let state =
                    normalize_download_state(nullable_string_field(asset, &["status", "state"]))?;
                let download_source =
                    normalize_download_source(nullable_string_field(asset, &["download_source", "downloadSource"]))?;
                self.conn()?
                    .execute(
                        "INSERT INTO download_assets (
                   video_url, status, file_relative_path, format, title, img, preview,
                   source_page_chinese_subtitle_notice, source_page_subtitle_notice_text,
                   download_source, size_bytes, duration_seconds, progress,
                   playback_auto_resume_blocked, error, failure_phase, failure_code,
                   attempt_count, last_started_at, last_error_at, downloaded_at,
                   last_checked_at, created_at, updated_at
                 )
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(video_url) DO UPDATE SET
                   status = excluded.status,
                   file_relative_path = excluded.file_relative_path,
                   format = excluded.format,
                   title = excluded.title,
                   img = excluded.img,
                   preview = excluded.preview,
                   source_page_chinese_subtitle_notice = excluded.source_page_chinese_subtitle_notice,
                   source_page_subtitle_notice_text = excluded.source_page_subtitle_notice_text,
                   download_source = excluded.download_source,
                   size_bytes = excluded.size_bytes,
                   duration_seconds = excluded.duration_seconds,
                   progress = excluded.progress,
                   playback_auto_resume_blocked = excluded.playback_auto_resume_blocked,
                   error = excluded.error,
                   failure_phase = excluded.failure_phase,
                   failure_code = excluded.failure_code,
                   attempt_count = excluded.attempt_count,
                   last_started_at = excluded.last_started_at,
                   last_error_at = excluded.last_error_at,
                   downloaded_at = excluded.downloaded_at,
                   last_checked_at = excluded.last_checked_at,
                   updated_at = excluded.updated_at",
                        params![
                            video_url,
                            state,
                            local_path,
                            nullable_string_field(asset, &["format"]).unwrap_or_else(|| "mp4".to_string()),
                            nullable_string_field(asset, &["title"]),
                            nullable_string_field(asset, &["img"]),
                            nullable_string_field(asset, &["preview"]),
                            bool_i64(
                                field(
                                    asset,
                                    &[
                                        "source_page_chinese_subtitle_notice",
                                        "sourcePageChineseSubtitleNotice",
                                    ],
                                ),
                                false,
                            ),
                            nullable_string_field(
                                asset,
                                &[
                                    "source_page_subtitle_notice_text",
                                    "sourcePageSubtitleNoticeText",
                                ],
                            ),
                            download_source,
                            value_i64(field(asset, &["size_bytes", "sizeBytes", "fileSizeBytes"])),
                            optional_f64(field(asset, &["duration_seconds", "durationSeconds"])),
                            optional_f64(field(asset, &["progress"])).map(|value| value.clamp(0.0, 1.0)),
                            bool_i64(
                                field(
                                    asset,
                                    &["playback_auto_resume_blocked", "playbackAutoResumeBlocked"],
                                ),
                                false,
                            ),
                            nullable_string_field(asset, &["error"]),
                            nullable_string_field(asset, &["failure_phase", "failurePhase"]),
                            nullable_string_field(asset, &["failure_code", "failureCode"]),
                            value_i64(field(asset, &["attempt_count", "attemptCount"]))
                                .unwrap_or(0)
                                .max(0),
                            nullable_string_field(asset, &["last_started_at", "lastStartedAt"]),
                            nullable_string_field(asset, &["last_error_at", "lastErrorAt"]),
                            nullable_string_field(asset, &["downloaded_at", "downloadedAt", "completedAt"]),
                            nullable_string_field(asset, &["last_checked_at", "lastCheckedAt"]),
                            timestamp_field(asset, &["created_at", "createdAt"], &timestamp),
                            timestamp_field(asset, &["updated_at", "updatedAt"], &timestamp)
                        ],
                    )
                    .map_err(to_napi_error)?;
                imported_download_assets += 1;
            }

            let cleared_sync_operations = self
                .conn()?
                .query_row("SELECT COUNT(*) FROM sync_operations", [], |row| {
                    row.get::<_, i64>(0)
                })
                .optional()
                .map_err(to_napi_error)?
                .unwrap_or(0);
            self.conn()?
                .execute("DELETE FROM sync_operations", [])
                .map_err(to_napi_error)?;

            Ok(json!({
              "videos": imported_videos,
              "collectionItems": imported_collection_items,
              "syncStates": imported_sync_states,
              "downloadAssets": imported_download_assets,
              "clearedSyncOperations": cleared_sync_operations
            }))
        })?;

        Ok(json!({
          "imported": imported,
          "warnings": warnings
        }))
    }
}
