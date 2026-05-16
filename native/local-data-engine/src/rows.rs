use serde_json::{json, Value};

#[derive(Clone)]
pub(crate) struct OperationRow {
    pub(crate) id: i64,
    pub(crate) sync_run_id: String,
    pub(crate) action: String,
    pub(crate) video_url: String,
    pub(crate) title: Option<String>,
    pub(crate) views: Option<i64>,
    pub(crate) likes: Option<i64>,
    pub(crate) img: Option<String>,
    pub(crate) preview: Option<String>,
    pub(crate) site_order: Option<i64>,
    pub(crate) remote_deferred: i64,
    pub(crate) remote_apply_state: String,
}

pub(crate) struct PendingRemoteOperationRow {
    pub(crate) id: i64,
    pub(crate) collection_key: String,
    pub(crate) action: String,
    pub(crate) video_url: String,
    pub(crate) title: Option<String>,
    pub(crate) views: Option<i64>,
    pub(crate) likes: Option<i64>,
    pub(crate) img: Option<String>,
    pub(crate) preview: Option<String>,
    pub(crate) remote_apply_state: String,
    pub(crate) remote_apply_error: Option<String>,
}

pub(crate) struct PendingRemoteOperationGroup {
    pub(crate) group_id: String,
    pub(crate) collection_key: String,
    pub(crate) video_url: String,
    pub(crate) title: Option<String>,
    pub(crate) views: Option<i64>,
    pub(crate) likes: Option<i64>,
    pub(crate) img: Option<String>,
    pub(crate) preview: Option<String>,
    pub(crate) state: String,
    pub(crate) error: Option<String>,
    pub(crate) sequence: Vec<Value>,
}

pub(crate) struct ListRow {
    pub(crate) url: String,
    pub(crate) title: Option<String>,
    pub(crate) views: Option<i64>,
    pub(crate) likes: Option<i64>,
    pub(crate) img: Option<String>,
    pub(crate) preview: Option<String>,
    pub(crate) created_at: Option<String>,
    pub(crate) updated_at: Option<String>,
    pub(crate) first_seen_at: Option<String>,
    pub(crate) last_seen_at: Option<String>,
    pub(crate) site_order: Option<i64>,
    pub(crate) is_visible: i64,
    pub(crate) missing_at: Option<String>,
    pub(crate) last_sync_run_id: Option<String>,
    pub(crate) search_text: Option<String>,
}

pub(crate) fn operation_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<OperationRow> {
    Ok(OperationRow {
        id: row.get(0)?,
        sync_run_id: row.get(1)?,
        action: row.get(2)?,
        video_url: row.get(3)?,
        title: row.get(4)?,
        views: row.get(5)?,
        likes: row.get(6)?,
        img: row.get(7)?,
        preview: row.get(8)?,
        site_order: row.get(9)?,
        remote_deferred: row.get(10)?,
        remote_apply_state: row.get(11)?,
    })
}

pub(crate) fn pending_operation_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
      "id": row.get::<_, i64>(0)?,
      "action": row.get::<_, String>(1)?,
      "videoUrl": row.get::<_, String>(2)?,
      "remoteVideoId": row.get::<_, Option<String>>(3)?,
      "remoteFavType": row.get::<_, Option<String>>(4)?
    }))
}

pub(crate) fn list_row_json(row: &ListRow) -> Value {
    json!({
      "url": row.url,
      "title": row.title,
      "views": row.views,
      "likes": row.likes,
      "img": row.img,
      "preview": row.preview,
      "created_at": row.created_at,
      "updated_at": row.updated_at,
      "first_seen_at": row.first_seen_at,
      "last_seen_at": row.last_seen_at,
      "site_order": row.site_order,
      "is_visible": row.is_visible,
      "missing_at": row.missing_at,
      "last_sync_run_id": row.last_sync_run_id
    })
}
