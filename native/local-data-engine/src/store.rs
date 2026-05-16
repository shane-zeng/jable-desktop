use napi::bindgen_prelude::*;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};

use crate::collections::ensure_collection;
use crate::payload::{
    normalize_video_url, object_field, value_bool, value_i64, value_string, NormalizedVideo,
};
use crate::rows::{list_row_json, ListRow};
use crate::search::matches_search;
use crate::{to_napi_error, Engine};

impl Engine {
    pub(crate) fn upsert_video(&self, video: &NormalizedVideo, timestamp: &str) -> Result<()> {
        self
      .conn()?
      .execute(
        "INSERT INTO videos (url, title, views, likes, img, preview, search_text, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(url) DO UPDATE SET
           title = COALESCE(excluded.title, videos.title),
           views = COALESCE(excluded.views, videos.views),
           likes = COALESCE(excluded.likes, videos.likes),
           img = COALESCE(excluded.img, videos.img),
           preview = COALESCE(excluded.preview, videos.preview),
           search_text = CASE WHEN excluded.title IS NULL THEN videos.search_text ELSE excluded.search_text END,
           updated_at = excluded.updated_at",
        params![
          video.url,
          video.title,
          video.views,
          video.likes,
          video.img,
          video.preview,
          video.search_text,
          timestamp,
          timestamp
        ],
      )
      .map_err(to_napi_error)?;

        Ok(())
    }

    fn list_rows(&self, collection_key: &str, options: &Value) -> Result<Vec<ListRow>> {
        ensure_collection(collection_key)?;
        let include_hidden = value_bool(object_field(options, "includeHidden"));
        let requested_sort =
            value_string(object_field(options, "sort")).unwrap_or_else(|| "site_order".to_string());
        let sort = match requested_sort.as_str() {
            "title" => "v.title",
            "views" => "v.views",
            "likes" => "v.likes",
            "updated_at" => "v.updated_at",
            "last_seen_at" => "ci.last_seen_at",
            _ => "site_order",
        };
        let direction = match value_string(object_field(options, "direction")).as_deref() {
            Some("asc") => "ASC",
            Some("desc") => "DESC",
            _ if sort == "site_order" => "ASC",
            _ => "DESC",
        };
        let order_by = if sort == "site_order" {
            format!("ci.site_order IS NULL ASC, ci.site_order {direction}, ci.last_seen_at DESC, v.url ASC")
        } else {
            format!("{sort} {direction}, v.url ASC")
        };
        let visibility = if include_hidden {
            ""
        } else {
            "AND ci.is_visible = 1"
        };
        let sql = format!(
            "SELECT v.url, v.title, v.views, v.likes, v.img, v.preview,
              v.created_at, v.updated_at, ci.first_seen_at, ci.last_seen_at,
              ci.site_order, ci.is_visible, ci.missing_at, ci.last_sync_run_id, v.search_text
       FROM collection_items ci
       JOIN videos v ON v.url = ci.video_url
       WHERE ci.collection_key = ? {visibility}
       ORDER BY {order_by}"
        );
        let mut statement = self.conn()?.prepare(&sql).map_err(to_napi_error)?;
        let mut rows = statement
            .query_map(params![collection_key], |row| {
                Ok(ListRow {
                    url: row.get(0)?,
                    title: row.get(1)?,
                    views: row.get(2)?,
                    likes: row.get(3)?,
                    img: row.get(4)?,
                    preview: row.get(5)?,
                    created_at: row.get(6)?,
                    updated_at: row.get(7)?,
                    first_seen_at: row.get(8)?,
                    last_seen_at: row.get(9)?,
                    site_order: row.get(10)?,
                    is_visible: row.get(11)?,
                    missing_at: row.get(12)?,
                    last_sync_run_id: row.get(13)?,
                    search_text: row.get(14)?,
                })
            })
            .map_err(to_napi_error)?
            .collect::<std::result::Result<Vec<ListRow>, _>>()
            .map_err(to_napi_error)?;

        let search = value_string(object_field(options, "search"));
        let search_mode =
            value_string(object_field(options, "searchMode")).unwrap_or_else(|| "any".to_string());
        if search.as_deref().unwrap_or("").trim().is_empty() {
            return Ok(rows);
        }

        rows.retain(|row| {
            matches_search(
                row.search_text.as_deref().unwrap_or(""),
                search.as_deref(),
                &search_mode,
            )
        });
        Ok(rows)
    }

    pub(crate) fn list_videos(&self, payload: Value) -> Result<Value> {
        let collection_key = value_string(object_field(&payload, "collectionKey"))
            .ok_or_else(|| Error::from_reason("listVideos requires collectionKey".to_string()))?;
        let rows = self.list_rows(&collection_key, &payload)?;
        let offset = value_i64(object_field(&payload, "offset"))
            .unwrap_or(0)
            .max(0) as usize;
        let limit = value_i64(object_field(&payload, "limit"))
            .filter(|value| *value > 0)
            .map(|value| value as usize);
        let end = limit
            .map(|limit| offset + limit)
            .unwrap_or(rows.len())
            .min(rows.len());
        let selected = if offset >= rows.len() {
            &[]
        } else {
            &rows[offset..end]
        };

        Ok(Value::Array(selected.iter().map(list_row_json).collect()))
    }

    pub(crate) fn count_videos(&self, payload: Value) -> Result<Value> {
        let collection_key = value_string(object_field(&payload, "collectionKey"))
            .ok_or_else(|| Error::from_reason("countVideos requires collectionKey".to_string()))?;
        Ok(json!(self.list_rows(&collection_key, &payload)?.len()))
    }

    pub(crate) fn get_collection_urls(&self, payload: Value) -> Result<Value> {
        let collection_key = payload
            .as_str()
            .map(|value| value.to_string())
            .or_else(|| value_string(object_field(&payload, "collectionKey")))
            .ok_or_else(|| {
                Error::from_reason("getCollectionUrls requires collectionKey".to_string())
            })?;
        ensure_collection(&collection_key)?;
        let mut statement = self
      .conn()?
      .prepare("SELECT video_url FROM collection_items WHERE collection_key = ? ORDER BY last_seen_at DESC")
      .map_err(to_napi_error)?;
        let rows = statement
            .query_map(params![collection_key], |row| row.get::<_, String>(0))
            .map_err(to_napi_error)?
            .collect::<std::result::Result<Vec<String>, _>>()
            .map_err(to_napi_error)?;

        Ok(Value::Array(rows.into_iter().map(Value::String).collect()))
    }

    pub(crate) fn all_collection_urls_known(&self, payload: Value) -> Result<Value> {
        let collection_key =
            value_string(object_field(&payload, "collectionKey")).ok_or_else(|| {
                Error::from_reason("allCollectionUrlsKnown requires collectionKey".to_string())
            })?;
        ensure_collection(&collection_key)?;
        let urls = object_field(&payload, "urls").and_then(|value| value.as_array());
        let Some(urls) = urls else {
            return Ok(json!(false));
        };
        if urls.is_empty() {
            return Ok(json!(false));
        }

        let mut normalized = Vec::new();
        for url in urls {
            let Some(url) = normalize_video_url(Some(url)) else {
                return Ok(json!(false));
            };
            if !normalized.iter().any(|entry| entry == &url) {
                normalized.push(url);
            }
        }

        if normalized.is_empty() {
            return Ok(json!(false));
        }

        let mut known = 0;
        let mut statement = self
            .conn()?
            .prepare(
                "SELECT 1 FROM collection_items WHERE collection_key = ? AND video_url = ? LIMIT 1",
            )
            .map_err(to_napi_error)?;
        for url in &normalized {
            let row: Option<i64> = statement
                .query_row(params![collection_key, url], |row| row.get(0))
                .optional()
                .map_err(to_napi_error)?;
            if row.is_some() {
                known += 1;
            }
        }

        Ok(json!(known == normalized.len()))
    }

    pub(crate) fn visible_urls_for_resequence(&self, collection_key: &str) -> Result<Vec<String>> {
        let mut statement = self
            .conn()?
            .prepare(
                "SELECT video_url
         FROM collection_items
         WHERE collection_key = ?
           AND is_visible = 1
         ORDER BY site_order IS NULL ASC, site_order ASC, last_seen_at DESC, video_url ASC",
            )
            .map_err(to_napi_error)?;
        let rows = statement
            .query_map(params![collection_key], |row| row.get::<_, String>(0))
            .map_err(to_napi_error)?
            .collect::<std::result::Result<Vec<String>, _>>()
            .map_err(to_napi_error)?;
        Ok(rows)
    }

    pub(crate) fn resequence_visible_items(&self, collection_key: &str) -> Result<()> {
        let visible_urls = self.visible_urls_for_resequence(collection_key)?;
        for (index, url) in visible_urls.iter().enumerate() {
            self.conn()?
                .execute(
                    "UPDATE collection_items SET site_order = ? WHERE collection_key = ? AND video_url = ?",
                    params![index as i64 + 1, collection_key, url],
                )
                .map_err(to_napi_error)?;
        }

        Ok(())
    }
}
