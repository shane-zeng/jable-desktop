use napi::bindgen_prelude::*;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::payload::{normalize_video_url, object_field, value_string};
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

struct DownloadAssetRow {
    video_url: String,
    collection_keys: Vec<String>,
    title: Option<String>,
    img: Option<String>,
    preview: Option<String>,
    source_page_chinese_subtitle_notice: bool,
    source_page_subtitle_notice_text: Option<String>,
    download_source: String,
    local_path: Option<String>,
    state: String,
    progress: Option<f64>,
    playback_auto_resume_blocked: bool,
    file_size_bytes: Option<i64>,
    error: Option<String>,
    failure_phase: Option<String>,
    failure_code: Option<String>,
    attempt_count: i64,
    last_started_at: Option<String>,
    last_error_at: Option<String>,
    created_at: String,
    updated_at: String,
    completed_at: Option<String>,
}

fn field<'a>(value: &'a Value, keys: &[&str]) -> Option<&'a Value> {
    for key in keys {
        if let Some(field) = object_field(value, key) {
            return Some(field);
        }
    }
    None
}

fn has_field(value: &Value, keys: &[&str]) -> bool {
    keys.iter().any(|key| object_field(value, key).is_some())
}

fn value_f64(value: Option<&Value>) -> Option<f64> {
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

fn value_i64(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(number)) => number
            .as_i64()
            .or_else(|| number.as_f64().map(|number| number as i64)),
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                trimmed.parse::<f64>().ok().map(|number| number as i64)
            }
        }
        _ => None,
    }
}

fn value_bool(value: Option<&Value>) -> Option<bool> {
    match value {
        Some(Value::Bool(value)) => Some(*value),
        Some(Value::Number(number)) => number
            .as_i64()
            .or_else(|| number.as_f64().map(|number| number as i64))
            .map(|number| number != 0),
        Some(Value::String(text)) => match text.trim().to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" => Some(true),
            "false" | "0" | "no" | "" => Some(false),
            _ => None,
        },
        _ => None,
    }
}

fn patch_string(value: &Value, keys: &[&str], existing: Option<String>) -> Option<String> {
    if has_field(value, keys) {
        value_string(field(value, keys))
    } else {
        existing
    }
}

fn file_relative_path_is_safe(value: &str) -> bool {
    if value.contains('\0') || value.starts_with('/') || value.starts_with('\\') {
        return false;
    }

    let bytes = value.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return false;
    }

    value.split(['/', '\\']).all(|part| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && !part.contains(':')
            && file_relative_path_part_is_windows_safe(part)
    })
}

fn file_relative_path_part_is_windows_safe(part: &str) -> bool {
    if part.ends_with(' ') || part.ends_with('.') {
        return false;
    }

    let stem = part.split('.').next().unwrap_or(part);
    if stem.ends_with(' ') || stem.ends_with('.') {
        return false;
    }
    if stem.is_empty() {
        return true;
    }

    !matches!(
        stem.to_ascii_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

pub(crate) fn normalize_file_relative_path(value: Option<String>) -> Result<Option<String>> {
    match value {
        Some(path) if file_relative_path_is_safe(&path) => Ok(Some(path)),
        Some(_) => Err(Error::from_reason(
            "Download file path must be relative to the download root".to_string(),
        )),
        None => Ok(None),
    }
}

fn patch_f64(value: &Value, keys: &[&str], existing: Option<f64>) -> Option<f64> {
    if has_field(value, keys) {
        value_f64(field(value, keys)).map(|number| number.clamp(0.0, 1.0))
    } else {
        existing
    }
}

fn patch_i64(value: &Value, keys: &[&str], existing: Option<i64>) -> Option<i64> {
    if has_field(value, keys) {
        value_i64(field(value, keys))
    } else {
        existing
    }
}

fn patch_bool(value: &Value, keys: &[&str], existing: Option<bool>) -> bool {
    if has_field(value, keys) {
        value_bool(field(value, keys)).unwrap_or(false)
    } else {
        existing.unwrap_or(false)
    }
}

fn patch_state(value: &Value, existing: Option<String>) -> String {
    if has_field(value, &["state", "status"]) {
        if let Some(state) = value_string(field(value, &["state", "status"])) {
            if DOWNLOAD_STATES.iter().any(|candidate| candidate == &state) {
                return state;
            }
        }
        return "queued".to_string();
    }

    existing.unwrap_or_else(|| "queued".to_string())
}

fn patch_download_source(value: &Value, existing: Option<String>) -> String {
    if has_field(value, &["downloadSource", "download_source"]) {
        if let Some(source) = value_string(field(value, &["downloadSource", "download_source"])) {
            if DOWNLOAD_SOURCES
                .iter()
                .any(|candidate| candidate == &source)
            {
                return source;
            }
        }
        return "normal".to_string();
    }

    existing.unwrap_or_else(|| "normal".to_string())
}

fn asset_video_url(value: &Value, method: &str) -> Result<String> {
    let url = if value.is_string() {
        normalize_video_url(Some(value))
    } else {
        normalize_video_url(field(value, &["videoUrl", "video_url", "url"]))
    };

    url.ok_or_else(|| Error::from_reason(format!("{method} requires videoUrl")))
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<DownloadAssetRow> {
    Ok(DownloadAssetRow {
        video_url: row.get(0)?,
        collection_keys: Vec::new(),
        title: row.get(1)?,
        img: row.get(2)?,
        preview: row.get(3)?,
        source_page_chinese_subtitle_notice: row.get(4)?,
        source_page_subtitle_notice_text: row.get(5)?,
        download_source: row.get(6)?,
        local_path: row.get(7)?,
        state: row.get(8)?,
        progress: row.get(9)?,
        playback_auto_resume_blocked: row.get(10)?,
        file_size_bytes: row.get(11)?,
        error: row.get(12)?,
        failure_phase: row.get(13)?,
        failure_code: row.get(14)?,
        attempt_count: row.get(15)?,
        last_started_at: row.get(16)?,
        last_error_at: row.get(17)?,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
        completed_at: row.get(20)?,
    })
}

fn record_json(record: DownloadAssetRow) -> Value {
    json!({
      "videoUrl": record.video_url,
      "collectionKeys": record.collection_keys,
      "title": record.title,
      "img": record.img,
      "preview": record.preview,
      "sourcePageChineseSubtitleNotice": record.source_page_chinese_subtitle_notice,
      "sourcePageSubtitleNoticeText": record.source_page_subtitle_notice_text,
      "downloadSource": record.download_source,
      "localPath": record.local_path,
      "state": record.state,
      "progress": record.progress,
      "playbackAutoResumeBlocked": record.playback_auto_resume_blocked,
      "fileSizeBytes": record.file_size_bytes,
      "error": record.error,
      "failurePhase": record.failure_phase,
      "failureCode": record.failure_code,
      "attemptCount": record.attempt_count,
      "lastStartedAt": record.last_started_at,
      "lastErrorAt": record.last_error_at,
      "createdAt": record.created_at,
      "updatedAt": record.updated_at,
      "completedAt": record.completed_at
    })
}

impl Engine {
    fn download_asset_collection_keys(&self, video_url: &str) -> Result<Vec<String>> {
        let binding = self.conn()?;
        let mut statement = binding
            .prepare(
                "SELECT collection_key
         FROM collection_items
         WHERE video_url = ? AND is_visible = 1
         ORDER BY CASE collection_key
           WHEN 'favourites' THEN 0
           WHEN 'watch_later' THEN 1
           ELSE 2
         END, collection_key ASC",
            )
            .map_err(to_napi_error)?;

        let rows = statement
            .query_map(params![video_url], |row| row.get::<_, String>(0))
            .map_err(to_napi_error)?
            .collect::<std::result::Result<Vec<String>, _>>()
            .map_err(to_napi_error)?;

        Ok(rows)
    }

    fn download_asset_collection_keys_by_url(&self) -> Result<HashMap<String, Vec<String>>> {
        let binding = self.conn()?;
        let mut statement = binding
            .prepare(
                "SELECT ci.video_url, ci.collection_key
         FROM collection_items ci
         JOIN download_assets da ON da.video_url = ci.video_url
         WHERE ci.is_visible = 1
         ORDER BY ci.video_url ASC, CASE ci.collection_key
           WHEN 'favourites' THEN 0
           WHEN 'watch_later' THEN 1
           ELSE 2
         END, ci.collection_key ASC",
            )
            .map_err(to_napi_error)?;

        let mut rows = statement.query([]).map_err(to_napi_error)?;
        let mut collection_keys_by_url: HashMap<String, Vec<String>> = HashMap::new();
        while let Some(row) = rows.next().map_err(to_napi_error)? {
            let video_url: String = row.get(0).map_err(to_napi_error)?;
            let collection_key: String = row.get(1).map_err(to_napi_error)?;
            collection_keys_by_url
                .entry(video_url)
                .or_default()
                .push(collection_key);
        }

        Ok(collection_keys_by_url)
    }

    fn get_download_asset_row(&self, video_url: &str) -> Result<Option<DownloadAssetRow>> {
        let row = self
            .conn()?
            .query_row(
                "SELECT da.video_url, COALESCE(da.title, v.title), COALESCE(da.img, v.img), COALESCE(da.preview, v.preview),
           da.source_page_chinese_subtitle_notice, da.source_page_subtitle_notice_text, da.download_source,
           da.file_relative_path, da.status, da.progress, da.playback_auto_resume_blocked,
           da.size_bytes, da.error, da.failure_phase, da.failure_code, da.attempt_count, da.last_started_at, da.last_error_at,
           da.created_at, da.updated_at, da.downloaded_at
         FROM download_assets da
         LEFT JOIN videos v ON v.url = da.video_url
         WHERE da.video_url = ?",
                params![video_url],
                row_to_record,
            )
            .optional()
            .map_err(to_napi_error)?;

        row.map(|mut record| {
            record.collection_keys = self.download_asset_collection_keys(&record.video_url)?;
            Ok(record)
        })
        .transpose()
    }

    pub(crate) fn list_download_assets(&self) -> Result<Value> {
        let mut statement = self
            .conn()?
            .prepare(
                "SELECT da.video_url, COALESCE(da.title, v.title), COALESCE(da.img, v.img), COALESCE(da.preview, v.preview),
           da.source_page_chinese_subtitle_notice, da.source_page_subtitle_notice_text, da.download_source,
           da.file_relative_path, da.status, da.progress, da.playback_auto_resume_blocked,
           da.size_bytes, da.error, da.failure_phase, da.failure_code, da.attempt_count, da.last_started_at, da.last_error_at,
           da.created_at, da.updated_at, da.downloaded_at
         FROM download_assets da
         LEFT JOIN videos v ON v.url = da.video_url
         ORDER BY da.updated_at DESC, da.video_url ASC",
            )
            .map_err(to_napi_error)?;
        let mut records = statement
            .query_map([], row_to_record)
            .map_err(to_napi_error)?
            .collect::<std::result::Result<Vec<DownloadAssetRow>, _>>()
            .map_err(to_napi_error)?;
        let mut collection_keys_by_url = self.download_asset_collection_keys_by_url()?;
        for record in &mut records {
            record.collection_keys = collection_keys_by_url
                .remove(&record.video_url)
                .unwrap_or_default();
        }
        let records = records.into_iter().map(record_json).collect();

        Ok(Value::Array(records))
    }

    pub(crate) fn get_download_asset(&self, payload: Value) -> Result<Value> {
        let video_url = asset_video_url(&payload, "getDownloadAsset")?;
        Ok(self
            .get_download_asset_row(&video_url)?
            .map(record_json)
            .unwrap_or(Value::Null))
    }

    pub(crate) fn upsert_download_asset(&self, payload: Value) -> Result<Value> {
        let video_url = asset_video_url(&payload, "upsertDownloadAsset")?;
        let existing = self.get_download_asset_row(&video_url)?;
        let timestamp = now_iso();
        let created_at = existing
            .as_ref()
            .map(|record| record.created_at.clone())
            .or_else(|| value_string(field(&payload, &["createdAt", "created_at"])))
            .unwrap_or_else(|| timestamp.clone());
        let title = patch_string(
            &payload,
            &["title"],
            existing.as_ref().and_then(|record| record.title.clone()),
        );
        let img = patch_string(
            &payload,
            &["img"],
            existing.as_ref().and_then(|record| record.img.clone()),
        );
        let preview = patch_string(
            &payload,
            &["preview"],
            existing.as_ref().and_then(|record| record.preview.clone()),
        );
        let source_page_chinese_subtitle_notice = patch_bool(
            &payload,
            &[
                "sourcePageChineseSubtitleNotice",
                "source_page_chinese_subtitle_notice",
            ],
            existing
                .as_ref()
                .map(|record| record.source_page_chinese_subtitle_notice),
        );
        let source_page_subtitle_notice_text = patch_string(
            &payload,
            &[
                "sourcePageSubtitleNoticeText",
                "source_page_subtitle_notice_text",
            ],
            existing
                .as_ref()
                .and_then(|record| record.source_page_subtitle_notice_text.clone()),
        );
        let download_source = patch_download_source(
            &payload,
            existing
                .as_ref()
                .map(|record| record.download_source.clone()),
        );
        let local_path = normalize_file_relative_path(patch_string(
            &payload,
            &[
                "localPath",
                "local_path",
                "fileRelativePath",
                "file_relative_path",
            ],
            existing
                .as_ref()
                .and_then(|record| record.local_path.clone()),
        ))?;
        let state = patch_state(
            &payload,
            existing.as_ref().map(|record| record.state.clone()),
        );
        let progress = patch_f64(
            &payload,
            &["progress"],
            existing.as_ref().and_then(|record| record.progress),
        );
        let playback_auto_resume_blocked = patch_bool(
            &payload,
            &["playbackAutoResumeBlocked", "playback_auto_resume_blocked"],
            existing
                .as_ref()
                .map(|record| record.playback_auto_resume_blocked),
        );
        let file_size_bytes = patch_i64(
            &payload,
            &[
                "fileSizeBytes",
                "file_size_bytes",
                "sizeBytes",
                "size_bytes",
            ],
            existing.as_ref().and_then(|record| record.file_size_bytes),
        );
        let error = patch_string(
            &payload,
            &["error"],
            existing.as_ref().and_then(|record| record.error.clone()),
        );
        let failure_phase = patch_string(
            &payload,
            &["failurePhase", "failure_phase"],
            existing
                .as_ref()
                .and_then(|record| record.failure_phase.clone()),
        );
        let failure_code = patch_string(
            &payload,
            &["failureCode", "failure_code"],
            existing
                .as_ref()
                .and_then(|record| record.failure_code.clone()),
        );
        let attempt_count = patch_i64(
            &payload,
            &["attemptCount", "attempt_count"],
            existing.as_ref().map(|record| record.attempt_count),
        )
        .unwrap_or(0)
        .max(0);
        let last_started_at = patch_string(
            &payload,
            &["lastStartedAt", "last_started_at"],
            existing
                .as_ref()
                .and_then(|record| record.last_started_at.clone()),
        );
        let last_error_at = patch_string(
            &payload,
            &["lastErrorAt", "last_error_at"],
            existing
                .as_ref()
                .and_then(|record| record.last_error_at.clone()),
        );
        let completed_at = patch_string(
            &payload,
            &[
                "completedAt",
                "completed_at",
                "downloadedAt",
                "downloaded_at",
            ],
            existing
                .as_ref()
                .and_then(|record| record.completed_at.clone()),
        );

        self.conn()?
            .execute(
                "INSERT INTO download_assets (
           video_url, status, file_relative_path, format, title, img, preview,
           source_page_chinese_subtitle_notice, source_page_subtitle_notice_text, download_source,
           size_bytes, duration_seconds, progress, playback_auto_resume_blocked, error, failure_phase, failure_code, attempt_count,
           last_started_at, last_error_at, downloaded_at, last_checked_at, created_at, updated_at
         )
         VALUES (?, ?, ?, 'mp4', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_url) DO UPDATE SET
           status = excluded.status,
           file_relative_path = excluded.file_relative_path,
           title = excluded.title,
           img = excluded.img,
           preview = excluded.preview,
           source_page_chinese_subtitle_notice = excluded.source_page_chinese_subtitle_notice,
           source_page_subtitle_notice_text = excluded.source_page_subtitle_notice_text,
           download_source = excluded.download_source,
           size_bytes = excluded.size_bytes,
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
                    title,
                    img,
                    preview,
                    source_page_chinese_subtitle_notice,
                    source_page_subtitle_notice_text,
                    download_source,
                    file_size_bytes,
                    progress,
                    playback_auto_resume_blocked,
                    error,
                    failure_phase,
                    failure_code,
                    attempt_count,
                    last_started_at,
                    last_error_at,
                    completed_at,
                    timestamp,
                    created_at,
                    timestamp
                ],
            )
            .map_err(to_napi_error)?;

        self.get_download_asset(json!({ "videoUrl": video_url }))
    }

    pub(crate) fn remove_download_asset(&self, payload: Value) -> Result<Value> {
        let video_url = asset_video_url(&payload, "removeDownloadAsset")?;
        let changed = self
            .conn()?
            .execute(
                "DELETE FROM download_assets WHERE video_url = ?",
                params![video_url],
            )
            .map_err(to_napi_error)?
            > 0;

        Ok(json!(changed))
    }
}
