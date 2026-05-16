use napi::bindgen_prelude::*;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

use crate::payload::{normalize_video_url, object_field, value_string};
use crate::{now_iso, to_napi_error, Engine};

const DOWNLOAD_STATES: [&str; 5] = ["queued", "downloading", "failed", "ready", "missing"];

struct DownloadAssetRow {
    video_url: String,
    collection_key: Option<String>,
    collection_keys: Vec<String>,
    title: Option<String>,
    img: Option<String>,
    local_path: Option<String>,
    state: String,
    progress: Option<f64>,
    file_size_bytes: Option<i64>,
    error: Option<String>,
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

    value
        .split(['/', '\\'])
        .all(|part| !part.is_empty() && part != "." && part != ".." && !part.contains(':'))
}

fn normalize_file_relative_path(value: Option<String>) -> Result<Option<String>> {
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

fn patch_collection_key(value: &Value, existing: Option<String>) -> Option<String> {
    if !has_field(value, &["collectionKey", "collection_key"]) {
        return existing;
    }

    match value_string(field(value, &["collectionKey", "collection_key"])).as_deref() {
        Some("favourites") => Some("favourites".to_string()),
        Some("watch_later") => Some("watch_later".to_string()),
        _ => None,
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
        collection_key: row.get(1)?,
        collection_keys: Vec::new(),
        title: row.get(2)?,
        img: row.get(3)?,
        local_path: row.get(4)?,
        state: row.get(5)?,
        progress: row.get(6)?,
        file_size_bytes: row.get(7)?,
        error: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        completed_at: row.get(11)?,
    })
}

fn record_json(record: DownloadAssetRow) -> Value {
    json!({
      "videoUrl": record.video_url,
      "collectionKey": record.collection_key,
      "collectionKeys": record.collection_keys,
      "title": record.title,
      "img": record.img,
      "localPath": record.local_path,
      "state": record.state,
      "progress": record.progress,
      "fileSizeBytes": record.file_size_bytes,
      "error": record.error,
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

    fn get_download_asset_row(&self, video_url: &str) -> Result<Option<DownloadAssetRow>> {
        let row = self
            .conn()?
            .query_row(
                "SELECT video_url, collection_key, title, img, file_relative_path, status, progress, size_bytes, error, created_at, updated_at, downloaded_at
         FROM download_assets
         WHERE video_url = ?",
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
                "SELECT video_url, collection_key, title, img, file_relative_path, status, progress, size_bytes, error, created_at, updated_at, downloaded_at
         FROM download_assets
         ORDER BY updated_at DESC, video_url ASC",
            )
            .map_err(to_napi_error)?;
        let records = statement
            .query_map([], row_to_record)
            .map_err(to_napi_error)?
            .collect::<std::result::Result<Vec<DownloadAssetRow>, _>>()
            .map_err(to_napi_error)?
            .into_iter()
            .map(|mut record| {
                record.collection_keys = self.download_asset_collection_keys(&record.video_url)?;
                Ok(record)
            })
            .collect::<Result<Vec<DownloadAssetRow>>>()?
            .into_iter()
            .map(record_json)
            .collect();

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
        let collection_key = patch_collection_key(
            &payload,
            existing
                .as_ref()
                .and_then(|record| record.collection_key.clone()),
        );
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
           video_url, collection_key, status, file_relative_path, format, title, img, preview,
           size_bytes, duration_seconds, progress, error, downloaded_at, last_checked_at, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, 'mp4', ?, ?, NULL, ?, NULL, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(video_url) DO UPDATE SET
           collection_key = excluded.collection_key,
           status = excluded.status,
           file_relative_path = excluded.file_relative_path,
           title = excluded.title,
           img = excluded.img,
           size_bytes = excluded.size_bytes,
           progress = excluded.progress,
           error = excluded.error,
           downloaded_at = excluded.downloaded_at,
           last_checked_at = excluded.last_checked_at,
           updated_at = excluded.updated_at",
                params![
                    video_url,
                    collection_key,
                    state,
                    local_path,
                    title,
                    img,
                    file_size_bytes,
                    progress,
                    error,
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
