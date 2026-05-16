use napi::bindgen_prelude::*;
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

use crate::collections::ensure_collection;
use crate::collections::{Collection, PRIMARY_ORIGIN};
use crate::payload::{normalize_video_url, object_field, read_site_order, value_string};
use crate::{now_iso, now_millis, to_napi_error, Engine};

const PAGE_SIZE: usize = 24;

fn flatten_resource(resource: &Value) -> Vec<Value> {
    let mut rows = Vec::new();
    let Some(data) = object_field(resource, "data").and_then(|value| value.as_array()) else {
        return rows;
    };

    for item in data {
        if let Some(page_data) = object_field(item, "data").and_then(|value| value.as_array()) {
            rows.extend(page_data.iter().cloned());
        } else if object_field(item, "url").is_some() {
            rows.push(item.clone());
        }
    }

    rows
}

fn export_video(row: &Value) -> Value {
    json!({
      "title": row.get("title").cloned().unwrap_or(Value::Null),
      "url": row.get("url").cloned().unwrap_or(Value::Null),
      "views": row.get("views").cloned().unwrap_or(Value::Null),
      "likes": row.get("likes").cloned().unwrap_or(Value::Null),
      "img": row.get("img").cloned().unwrap_or(Value::Null),
      "preview": row.get("preview").cloned().unwrap_or(Value::Null),
      "site_order": row.get("site_order").cloned().unwrap_or(Value::Null)
    })
}

fn export_page(rows: &[Value], page_number: usize, exported_at: &str) -> Value {
    let data = rows.iter().map(export_video).collect::<Vec<Value>>();
    json!({
      "data": data,
      "meta": {
        "current_page": page_number,
        "per_page": PAGE_SIZE,
        "count": rows.len(),
        "first_url": rows.first().and_then(|row| row.get("url")).cloned().unwrap_or(Value::Null),
        "last_url": rows.last().and_then(|row| row.get("url")).cloned().unwrap_or(Value::Null),
        "exported_at": exported_at
      }
    })
}

fn export_meta(
    collection: &Collection,
    state: Option<&Value>,
    exported_at: &str,
    total: usize,
    page_count: usize,
) -> Value {
    json!({
      "format_version": 2,
      "source_path": collection.source_path,
      "source_url": format!("{PRIMARY_ORIGIN}{}", collection.source_path),
      "exported_at": exported_at,
      "completed": state
        .and_then(|state| state.get("completed"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false),
      "per_page": PAGE_SIZE,
      "page_count": page_count,
      "total": total,
      "last_page": if page_count == 0 { Value::Null } else { json!(page_count) },
      "last_scraped_page": state
        .and_then(|state| state.get("last_scraped_page"))
        .cloned()
        .unwrap_or(Value::Null)
    })
}

impl Engine {
    pub(crate) fn import_resource(&self, payload: Value) -> Result<Value> {
        let collection_key =
            value_string(object_field(&payload, "collectionKey")).ok_or_else(|| {
                Error::from_reason("importResource requires collectionKey".to_string())
            })?;
        let resource = object_field(&payload, "resource")
            .cloned()
            .unwrap_or(Value::Null);
        let mut rows = flatten_resource(&resource);

        for (index, row) in rows.iter_mut().enumerate() {
            if read_site_order(row).is_none() {
                if let Some(object) = row.as_object_mut() {
                    object.insert("siteOrder".to_string(), json!(index + 1));
                }
            }
        }

        let saved = self.save_sync_page(json!({
      "collectionKey": collection_key,
      "page": object_field(&resource, "meta").and_then(|meta| object_field(meta, "last_scraped_page")).cloned().unwrap_or(Value::Null),
      "rows": rows
    }))?;
        let imported = saved
            .get("saved")
            .and_then(|value| value.as_u64())
            .unwrap_or(0);

        if object_field(&resource, "meta")
            .and_then(|meta| object_field(meta, "completed"))
            .and_then(|value| value.as_bool())
            == Some(true)
        {
            let last_known_url = flatten_resource(&resource)
                .last()
                .and_then(|row| normalize_video_url(object_field(row, "url")));
            self.finish_sync(json!({
        "collectionKey": collection_key,
        "result": {
          "lastScrapedPage": object_field(&resource, "meta").and_then(|meta| object_field(meta, "last_scraped_page")).cloned().unwrap_or(Value::Null),
          "lastKnownUrl": last_known_url
        }
      }))?;
        }

        Ok(json!({ "imported": imported, "collectionKey": collection_key }))
    }

    pub(crate) fn export_resource(&self, payload: Value) -> Result<Value> {
        let collection_key = payload
            .as_str()
            .map(|value| value.to_string())
            .or_else(|| value_string(object_field(&payload, "collectionKey")))
            .ok_or_else(|| {
                Error::from_reason("exportResource requires collectionKey".to_string())
            })?;
        let collection = ensure_collection(&collection_key)?;
        let rows_value = self.list_videos(json!({
          "collectionKey": collection_key,
          "sort": "site_order",
          "direction": "asc"
        }))?;
        let rows = rows_value.as_array().cloned().unwrap_or_default();
        let state = self.get_sync_state(&collection_key)?;
        let exported_at = now_iso();
        let page_count = rows.len().div_ceil(PAGE_SIZE);
        let pages = rows
            .chunks(PAGE_SIZE)
            .enumerate()
            .map(|(index, chunk)| export_page(chunk, index + 1, &exported_at))
            .collect::<Vec<Value>>();

        Ok(json!({
          "data": pages,
          "meta": export_meta(&collection, state.as_ref(), &exported_at, rows.len(), page_count)
        }))
    }

    pub(crate) fn export_resource_to_file(&self, payload: Value) -> Result<Value> {
        let collection_key =
            value_string(object_field(&payload, "collectionKey")).ok_or_else(|| {
                Error::from_reason("exportResourceToFile requires collectionKey".to_string())
            })?;
        let file_path = value_string(object_field(&payload, "filePath"))
            .ok_or_else(|| Error::from_reason("Export file path is required".to_string()))?;
        if let Some(parent) = Path::new(&file_path).parent() {
            fs::create_dir_all(parent).map_err(to_napi_error)?;
        }

        let resource = self.export_resource(Value::String(collection_key.clone()))?;
        let total = resource
            .get("meta")
            .and_then(|meta| meta.get("total"))
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        let temp_path = format!("{}.tmp-{}-{}", file_path, std::process::id(), now_millis());
        let serialized = serde_json::to_string(&resource).map_err(to_napi_error)? + "\n";
        fs::write(&temp_path, serialized).map_err(to_napi_error)?;
        fs::rename(&temp_path, &file_path).map_err(to_napi_error)?;

        Ok(json!({ "filePath": file_path, "total": total }))
    }
}
