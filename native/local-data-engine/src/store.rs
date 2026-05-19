use napi::bindgen_prelude::*;
use rusqlite::types::Value as SqlValue;
use rusqlite::{params, params_from_iter, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashSet;

use crate::collections::{ensure_collection, PRIMARY_ORIGIN};
use crate::payload::{
    normalize_video, normalize_video_url, object_field, value_bool, value_i64, value_string,
    NormalizedVideo,
};
use crate::rows::{list_row_json, ListRow};
use crate::search::matches_search;
use crate::{now_iso, to_napi_error, Engine};

const COLLECTION_URLS_KNOWN_QUERY_CHUNK_SIZE: usize = 500;

struct ListQueryOptions {
    order_by: String,
    visibility: &'static str,
    download_join: &'static str,
    download_visibility: &'static str,
    search: Option<String>,
    search_mode: String,
}

impl ListQueryOptions {
    fn from_value(options: &Value) -> Self {
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
        let download_filter = value_string(object_field(options, "downloadFilter"))
            .unwrap_or_else(|| "all".to_string());
        let download_join = match download_filter.as_str() {
            "downloadable" => "LEFT JOIN download_assets da ON da.video_url = v.url",
            "downloaded" => "JOIN download_assets da ON da.video_url = v.url",
            _ => "",
        };
        let download_visibility = match download_filter.as_str() {
            "downloadable" => {
                "AND (da.video_url IS NULL OR da.status IN ('paused', 'failed', 'missing'))"
            }
            "downloaded" => "AND da.status = 'ready'",
            _ => "",
        };

        Self {
            order_by,
            visibility,
            download_join,
            download_visibility,
            search: value_string(object_field(options, "search")),
            search_mode: value_string(object_field(options, "searchMode"))
                .unwrap_or_else(|| "any".to_string()),
        }
    }

    fn has_search(&self) -> bool {
        !self.search.as_deref().unwrap_or("").trim().is_empty()
    }
}

fn row_to_list_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ListRow> {
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
}

fn pagination_sql(limit: Option<usize>, offset: usize) -> String {
    match limit {
        Some(limit) => format!(" LIMIT {limit} OFFSET {offset}"),
        None if offset > 0 => format!(" LIMIT -1 OFFSET {offset}"),
        None => String::new(),
    }
}

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

    pub(crate) fn refresh_video_metadata(&self, payload: Value) -> Result<Value> {
        let video = normalize_video(&payload).ok_or_else(|| {
            Error::from_reason("Video metadata refresh requires a video URL".to_string())
        })?;
        let trusted_prefix = format!("{PRIMARY_ORIGIN}/videos/");
        if !video.url.starts_with(&trusted_prefix) {
            return Err(Error::from_reason(
                "Video metadata refresh requires a trusted Jable video URL".to_string(),
            ));
        }

        let known = self
            .conn()?
            .query_row(
                "SELECT 1 FROM collection_items WHERE video_url = ? LIMIT 1",
                params![&video.url],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(to_napi_error)?
            .is_some();

        if !known {
            return Ok(json!({
              "known": false,
              "updated": false,
              "url": video.url
            }));
        }

        if video.title.is_none()
            && video.views.is_none()
            && video.likes.is_none()
            && video.img.is_none()
            && video.preview.is_none()
        {
            return Ok(json!({
              "known": true,
              "updated": false,
              "url": video.url
            }));
        }

        self.upsert_video(&video, &now_iso())?;

        Ok(json!({
          "known": true,
          "updated": true,
          "url": video.url
        }))
    }

    pub(crate) fn upsert_video_metadata(&self, payload: Value) -> Result<Value> {
        let video = normalize_video(&payload).ok_or_else(|| {
            Error::from_reason("Video metadata upsert requires a video URL".to_string())
        })?;
        let trusted_prefix = format!("{PRIMARY_ORIGIN}/videos/");
        if !video.url.starts_with(&trusted_prefix) {
            return Err(Error::from_reason(
                "Video metadata upsert requires a trusted Jable video URL".to_string(),
            ));
        }

        self.upsert_video(&video, &now_iso())?;

        Ok(json!({
          "updated": true,
          "url": video.url
        }))
    }

    fn list_rows(
        &self,
        collection_key: &str,
        query: &ListQueryOptions,
        limit: Option<usize>,
        offset: usize,
    ) -> Result<Vec<ListRow>> {
        ensure_collection(collection_key)?;
        let pagination = if query.has_search() {
            String::new()
        } else {
            pagination_sql(limit, offset)
        };
        let sql = format!(
            "SELECT v.url, v.title, v.views, v.likes, v.img, v.preview,
              v.created_at, v.updated_at, ci.first_seen_at, ci.last_seen_at,
              ci.site_order, ci.is_visible, ci.missing_at, ci.last_sync_run_id, v.search_text
       FROM collection_items ci
       JOIN videos v ON v.url = ci.video_url
       {download_join}
       WHERE ci.collection_key = ? {visibility} {download_visibility}
       ORDER BY {order_by}{pagination}",
            download_join = query.download_join,
            visibility = query.visibility,
            download_visibility = query.download_visibility,
            order_by = query.order_by,
        );
        let mut statement = self.conn()?.prepare(&sql).map_err(to_napi_error)?;
        let mut rows = statement
            .query_map(params![collection_key], row_to_list_row)
            .map_err(to_napi_error)?
            .collect::<std::result::Result<Vec<ListRow>, _>>()
            .map_err(to_napi_error)?;

        if !query.has_search() {
            return Ok(rows);
        }

        rows.retain(|row| {
            matches_search(
                row.search_text.as_deref().unwrap_or(""),
                query.search.as_deref(),
                &query.search_mode,
            )
        });
        Ok(rows)
    }

    fn count_rows(&self, collection_key: &str, query: &ListQueryOptions) -> Result<usize> {
        ensure_collection(collection_key)?;
        let sql = format!(
            "SELECT COUNT(*)
       FROM collection_items ci
       JOIN videos v ON v.url = ci.video_url
       {download_join}
       WHERE ci.collection_key = ? {visibility} {download_visibility}",
            download_join = query.download_join,
            visibility = query.visibility,
            download_visibility = query.download_visibility,
        );

        self.conn()?
            .query_row(&sql, params![collection_key], |row| row.get::<_, i64>(0))
            .map(|count| count as usize)
            .map_err(to_napi_error)
    }

    fn count_search_rows(&self, collection_key: &str, query: &ListQueryOptions) -> Result<usize> {
        ensure_collection(collection_key)?;
        let sql = format!(
            "SELECT v.search_text
       FROM collection_items ci
       JOIN videos v ON v.url = ci.video_url
       {download_join}
       WHERE ci.collection_key = ? {visibility} {download_visibility}",
            download_join = query.download_join,
            visibility = query.visibility,
            download_visibility = query.download_visibility,
        );
        let conn = self.conn()?;
        let mut statement = conn.prepare(&sql).map_err(to_napi_error)?;
        let rows = statement
            .query_map(params![collection_key], |row| {
                row.get::<_, Option<String>>(0)
            })
            .map_err(to_napi_error)?;
        let mut count = 0;

        for search_text in rows {
            let search_text = search_text.map_err(to_napi_error)?;
            if matches_search(
                search_text.as_deref().unwrap_or(""),
                query.search.as_deref(),
                &query.search_mode,
            ) {
                count += 1;
            }
        }

        Ok(count)
    }

    pub(crate) fn list_videos(&self, payload: Value) -> Result<Value> {
        let collection_key = value_string(object_field(&payload, "collectionKey"))
            .ok_or_else(|| Error::from_reason("listVideos requires collectionKey".to_string()))?;
        let query = ListQueryOptions::from_value(&payload);
        let offset = value_i64(object_field(&payload, "offset"))
            .unwrap_or(0)
            .max(0) as usize;
        let limit = value_i64(object_field(&payload, "limit"))
            .filter(|value| *value > 0)
            .map(|value| value as usize);
        let rows = self.list_rows(&collection_key, &query, limit, offset)?;
        if !query.has_search() {
            return Ok(Value::Array(rows.iter().map(list_row_json).collect()));
        }

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
        let query = ListQueryOptions::from_value(&payload);
        if query.has_search() {
            return Ok(json!(self.count_search_rows(&collection_key, &query)?));
        }

        Ok(json!(self.count_rows(&collection_key, &query)?))
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

        let mut normalized = HashSet::new();
        for url in urls {
            let Some(url) = normalize_video_url(Some(url)) else {
                return Ok(json!(false));
            };
            normalized.insert(url);
        }

        if normalized.is_empty() {
            return Ok(json!(false));
        }
        let normalized = normalized.into_iter().collect::<Vec<String>>();
        let known = self.known_collection_url_count(&collection_key, &normalized)?;

        Ok(json!(known == normalized.len()))
    }

    fn known_collection_url_count(&self, collection_key: &str, urls: &[String]) -> Result<usize> {
        let mut known = 0;
        for chunk in urls.chunks(COLLECTION_URLS_KNOWN_QUERY_CHUNK_SIZE) {
            let placeholders = std::iter::repeat_n("?", chunk.len())
                .collect::<Vec<&str>>()
                .join(", ");
            let sql = format!(
                "SELECT COUNT(DISTINCT video_url)
         FROM collection_items
         WHERE collection_key = ? AND video_url IN ({placeholders})"
            );
            let mut query_params = Vec::with_capacity(chunk.len() + 1);
            query_params.push(SqlValue::Text(collection_key.to_string()));
            query_params.extend(chunk.iter().cloned().map(SqlValue::Text));
            let count = self
                .conn()?
                .query_row(&sql, params_from_iter(query_params.iter()), |row| {
                    row.get::<_, i64>(0)
                })
                .map_err(to_napi_error)?;
            known += count as usize;
        }

        Ok(known)
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
