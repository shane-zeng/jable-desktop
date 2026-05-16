use serde_json::{json, Value};

use crate::collections::{Collection, PRIMARY_ORIGIN};
use crate::payload::object_field;

pub(crate) const PAGE_SIZE: usize = 24;

pub(crate) fn flatten_resource(resource: &Value) -> Vec<Value> {
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

pub(crate) fn export_page(rows: &[Value], page_number: usize, exported_at: &str) -> Value {
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

pub(crate) fn export_meta(
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
