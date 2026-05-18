use napi::bindgen_prelude::*;
use rusqlite::{params, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::collections::ensure_collection;
use crate::payload::{
    normalize_video, normalize_video_url, object_field, value_bool, value_i64, value_string,
    NormalizedVideo,
};
use crate::rows::{
    operation_from_row, pending_operation_from_row, OperationRow, PendingRemoteOperationGroup,
    PendingRemoteOperationRow,
};
use crate::search::build_video_search_text;
use crate::{now_iso, now_millis, to_napi_error, Engine};

fn pending_remote_group_id(collection_key: &str, video_url: &str) -> String {
    format!("{collection_key}\t{video_url}")
}

fn pending_remote_group_parts(group_id: Option<&str>) -> Option<(String, String)> {
    let group_id = group_id?;
    let (collection_key, video_url) = group_id.split_once('\t')?;
    ensure_collection(collection_key).ok()?;
    let normalized_url = normalize_video_url(Some(&json!(video_url)))?;
    Some((collection_key.to_string(), normalized_url))
}

fn pending_remote_group_from_payload(
    payload: &Value,
) -> Result<(String, Option<(String, String)>)> {
    let group_id = value_string(object_field(payload, "groupId")).ok_or_else(|| {
        Error::from_reason("Pending operation group requires groupId".to_string())
    })?;
    let parts = pending_remote_group_parts(Some(&group_id));
    Ok((group_id, parts))
}

fn normalized_video_from_operation(operation: &OperationRow, site_order: i64) -> NormalizedVideo {
    NormalizedVideo {
        url: operation.video_url.clone(),
        title: operation.title.clone(),
        views: operation.views,
        likes: operation.likes,
        img: operation.img.clone(),
        preview: operation.preview.clone(),
        site_order: Some(site_order),
        search_text: build_video_search_text(
            operation.title.as_deref(),
            Some(&operation.video_url),
        ),
    }
}

impl Engine {
    fn latest_pending_remote_operation(
        &self,
        collection_key: &str,
        video_url: &str,
    ) -> Result<Option<OperationRow>> {
        self.conn()?
            .query_row(
                "SELECT id, sync_run_id, action, video_url, title, views, likes, img, preview, site_order,
             remote_deferred, remote_apply_state
         FROM sync_operations
         WHERE collection_key = ?
           AND video_url = ?
           AND remote_deferred = 1
           AND remote_applied_at IS NULL
           AND remote_apply_state IN ('failed', 'blocked', 'pending')
         ORDER BY id DESC
         LIMIT 1",
                params![collection_key, video_url],
                operation_from_row,
            )
            .optional()
            .map_err(to_napi_error)
    }

    fn latest_pending_remote_retry_operation(
        &self,
        collection_key: &str,
        video_url: &str,
    ) -> Result<Option<Value>> {
        self.conn()?
            .query_row(
                "SELECT id, action, video_url, remote_video_id, remote_fav_type
         FROM sync_operations
         WHERE collection_key = ?
           AND video_url = ?
           AND remote_deferred = 1
           AND remote_applied_at IS NULL
           AND remote_apply_state IN ('failed', 'blocked', 'pending')
         ORDER BY id DESC
         LIMIT 1",
                params![collection_key, video_url],
                pending_operation_from_row,
            )
            .optional()
            .map_err(to_napi_error)
    }

    fn resolve_pending_remote_group(
        &self,
        collection_key: &str,
        video_url: &str,
        timestamp: &str,
    ) -> Result<usize> {
        self.conn()?
            .execute(
                "UPDATE sync_operations
         SET remote_apply_state = 'resolved',
             remote_resolved_at = ?,
             remote_apply_error = NULL,
             remote_failed_at = NULL,
             remote_blocked_by = NULL
         WHERE collection_key = ?
           AND video_url = ?
           AND remote_deferred = 1
           AND remote_applied_at IS NULL
           AND remote_apply_state IN ('failed', 'blocked', 'pending')",
                params![timestamp, collection_key, video_url],
            )
            .map_err(to_napi_error)
    }

    fn upsert_visible_collection_item_from_sync(
        &self,
        collection_key: &str,
        video_url: &str,
        site_order: i64,
        sync_run_id: &str,
        timestamp: &str,
    ) -> Result<()> {
        self.conn()?
            .execute(
                "INSERT INTO collection_items (
                 collection_key, video_url, first_seen_at, last_seen_at, site_order, is_visible, missing_at, last_sync_run_id
               )
               VALUES (?, ?, ?, ?, ?, 1, NULL, ?)
               ON CONFLICT(collection_key, video_url) DO UPDATE SET
                 last_seen_at = excluded.last_seen_at,
                 site_order = CASE
                   WHEN collection_items.is_visible = 1 AND excluded.site_order < 0 THEN collection_items.site_order
                   ELSE COALESCE(excluded.site_order, collection_items.site_order)
                 END,
                 is_visible = 1,
                 missing_at = NULL,
                 last_sync_run_id = excluded.last_sync_run_id",
                params![
                    collection_key,
                    video_url,
                    timestamp,
                    timestamp,
                    site_order,
                    sync_run_id
                ],
            )
            .map_err(to_napi_error)?;

        Ok(())
    }

    fn upsert_hidden_collection_item_from_sync(
        &self,
        collection_key: &str,
        video_url: &str,
        site_order: i64,
        sync_run_id: &str,
        timestamp: &str,
    ) -> Result<()> {
        self.conn()?
            .execute(
                "INSERT INTO collection_items (
                 collection_key, video_url, first_seen_at, last_seen_at, site_order, is_visible, missing_at, last_sync_run_id
               )
               VALUES (?, ?, ?, ?, ?, 0, ?, ?)
               ON CONFLICT(collection_key, video_url) DO UPDATE SET
                 last_seen_at = excluded.last_seen_at,
                 is_visible = 0,
                 missing_at = excluded.missing_at,
                 last_sync_run_id = excluded.last_sync_run_id",
                params![
                    collection_key,
                    video_url,
                    timestamp,
                    timestamp,
                    site_order,
                    timestamp,
                    sync_run_id
                ],
            )
            .map_err(to_napi_error)?;

        Ok(())
    }

    fn record_sync_operation(
        &self,
        collection_key: &str,
        sync_run_id: Option<&str>,
        action: &str,
        video: &NormalizedVideo,
        timestamp: &str,
        payload: &Value,
    ) -> Result<()> {
        let Some(sync_run_id) = sync_run_id else {
            return Ok(());
        };

        self
      .conn()?
      .execute(
        "INSERT INTO sync_operations (
           collection_key, sync_run_id, action, video_url, title, views, likes, img, preview, site_order,
           remote_deferred, remote_video_id, remote_fav_type, source_url, created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
          collection_key,
          sync_run_id,
          action,
          video.url,
          video.title,
          video.views,
          video.likes,
          video.img,
          video.preview,
          video.site_order,
          if value_bool(object_field(payload, "deferRemote")) { 1 } else { 0 },
          value_string(object_field(payload, "remoteVideoId")),
          value_string(object_field(payload, "remoteFavType")),
          value_string(object_field(payload, "sourceUrl")),
          timestamp
        ],
      )
      .map_err(to_napi_error)?;

        Ok(())
    }

    pub(crate) fn save_sync_page(&self, payload: Value) -> Result<Value> {
        let collection_key = value_string(object_field(&payload, "collectionKey"))
            .ok_or_else(|| Error::from_reason("saveSyncPage requires collectionKey".to_string()))?;
        ensure_collection(&collection_key)?;
        let page = value_i64(object_field(&payload, "page"));
        let sync_run_id = value_string(object_field(&payload, "syncRunId"));
        let rows = object_field(&payload, "rows")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        let normalized_rows = rows
            .iter()
            .filter_map(normalize_video)
            .collect::<Vec<NormalizedVideo>>();
        let timestamp = now_iso();
        let preserve_existing_site_order = if let Some(sync_run_id) = sync_run_id.as_deref() {
            self
        .conn()?
        .query_row(
          "SELECT id FROM sync_operations WHERE collection_key = ? AND sync_run_id = ? LIMIT 1",
          params![collection_key, sync_run_id],
          |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(to_napi_error)?
        .is_some()
        } else {
            false
        };

        self.with_immediate_transaction(|| {
            for video in &normalized_rows {
                let should_use_scraped_site_order =
                    if preserve_existing_site_order && video.site_order.is_some() {
                        self.duplicate_add_operation_exists(
                            &collection_key,
                            sync_run_id.as_deref(),
                            &video.url,
                        )?
                    } else {
                        false
                    };
                self.upsert_video(video, &timestamp)?;
                self
          .conn()?
          .execute(
            "INSERT INTO collection_items (
               collection_key, video_url, first_seen_at, last_seen_at, site_order, is_visible, missing_at, last_sync_run_id
             )
             VALUES (?, ?, ?, ?, ?, 1, NULL, ?)
             ON CONFLICT(collection_key, video_url) DO UPDATE SET
               last_seen_at = excluded.last_seen_at,
               site_order = CASE
                 WHEN ? = 1 THEN collection_items.site_order
                 ELSE COALESCE(excluded.site_order, collection_items.site_order)
               END,
               is_visible = CASE
                 WHEN collection_items.is_visible = 0
                   AND excluded.last_sync_run_id IS NOT NULL
                   AND collection_items.last_sync_run_id = excluded.last_sync_run_id THEN 0
                 ELSE 1
               END,
               missing_at = CASE
                 WHEN collection_items.is_visible = 0
                   AND excluded.last_sync_run_id IS NOT NULL
                   AND collection_items.last_sync_run_id = excluded.last_sync_run_id THEN collection_items.missing_at
                 ELSE NULL
               END,
               last_sync_run_id = COALESCE(excluded.last_sync_run_id, collection_items.last_sync_run_id)",
            params![
              collection_key,
              video.url,
              timestamp,
              timestamp,
              video.site_order,
              sync_run_id,
              if preserve_existing_site_order && !should_use_scraped_site_order { 1 } else { 0 }
            ],
          )
          .map_err(to_napi_error)?;
            }

            self
        .conn()?
        .execute(
          "INSERT INTO sync_states (collection_key, completed, last_scraped_page, last_known_url, updated_at)
           VALUES (?, 0, ?, ?, ?)
           ON CONFLICT(collection_key) DO UPDATE SET
             completed = 0,
             last_scraped_page = excluded.last_scraped_page,
             last_known_url = excluded.last_known_url,
             updated_at = excluded.updated_at",
          params![
            collection_key,
            page,
            normalized_rows.last().map(|row| row.url.clone()),
            timestamp
          ],
        )
        .map_err(to_napi_error)?;

            Ok(())
        })?;

        Ok(json!({
          "saved": normalized_rows.len(),
          "collectionKey": collection_key,
          "page": page
        }))
    }

    fn duplicate_add_operation_exists(
        &self,
        collection_key: &str,
        sync_run_id: Option<&str>,
        video_url: &str,
    ) -> Result<bool> {
        let Some(sync_run_id) = sync_run_id else {
            return Ok(false);
        };
        let row: Option<i64> = self
            .conn()?
            .query_row(
                "SELECT latest.id
         FROM sync_operations latest
         WHERE latest.collection_key = ?
           AND latest.sync_run_id = ?
           AND latest.video_url = ?
           AND latest.action = 'add'
           AND latest.site_order IS NULL
           AND latest.reconciled_at IS NULL
           AND latest.id = (
             SELECT MAX(id)
             FROM sync_operations
             WHERE collection_key = latest.collection_key
               AND sync_run_id = latest.sync_run_id
               AND video_url = latest.video_url
               AND reconciled_at IS NULL
           )
           AND NOT EXISTS (
             SELECT 1
             FROM sync_operations prior
             WHERE prior.collection_key = latest.collection_key
               AND prior.sync_run_id = latest.sync_run_id
               AND prior.video_url = latest.video_url
               AND prior.action = 'remove'
               AND prior.id < latest.id
           )
         LIMIT 1",
                params![collection_key, sync_run_id, video_url],
                |row| row.get(0),
            )
            .optional()
            .map_err(to_napi_error)?;

        Ok(row.is_some())
    }

    pub(crate) fn apply_collection_toggle(&self, payload: Value) -> Result<Value> {
        let collection_key =
            value_string(object_field(&payload, "collectionKey")).ok_or_else(|| {
                Error::from_reason("Collection toggle requires a collection key".to_string())
            })?;
        ensure_collection(&collection_key)?;
        let action = if value_string(object_field(&payload, "action")).as_deref() == Some("remove")
        {
            "remove"
        } else {
            "add"
        };
        let video_value = object_field(&payload, "video").unwrap_or(&payload);
        let video = normalize_video(video_value).ok_or_else(|| {
            Error::from_reason("Collection toggle requires a video URL".to_string())
        })?;
        let timestamp = now_iso();
        let sync_run_id = value_string(object_field(&payload, "syncRunId"));
        let remote_deferred = value_bool(object_field(&payload, "deferRemote"));
        let defer_local = remote_deferred
            && value_bool(object_field(&payload, "deferLocal"))
            && sync_run_id.is_some();

        if defer_local {
            let current_visible = self
                .conn()?
                .query_row(
                    "SELECT is_visible
           FROM collection_items
           WHERE collection_key = ?
             AND video_url = ?
           LIMIT 1",
                    params![&collection_key, &video.url],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .map_err(to_napi_error)?
                .unwrap_or(0)
                != 0;
            self.record_sync_operation(
                &collection_key,
                sync_run_id.as_deref(),
                action,
                &video,
                &timestamp,
                &payload,
            )?;
            return Ok(json!({
              "action": action,
              "changed": false,
              "collectionKey": collection_key,
              "queued": remote_deferred,
              "url": video.url,
              "visible": current_visible
            }));
        }

        if action == "remove" {
            let changed = self
                .conn()?
                .execute(
                    "UPDATE collection_items
           SET is_visible = 0, missing_at = ?, last_seen_at = ?,
             last_sync_run_id = COALESCE(?, last_sync_run_id)
           WHERE collection_key = ?
             AND video_url = ?
             AND is_visible = 1",
                    params![timestamp, timestamp, sync_run_id, collection_key, video.url],
                )
                .map_err(to_napi_error)?;

            if changed == 0 && sync_run_id.is_some() {
                self.with_immediate_transaction(|| {
                    self.upsert_video(&video, &timestamp)?;
                    self
            .conn()?
            .execute(
              "INSERT INTO collection_items (
                 collection_key, video_url, first_seen_at, last_seen_at, site_order, is_visible, missing_at, last_sync_run_id
               )
               VALUES (?, ?, ?, ?, ?, 0, ?, ?)
               ON CONFLICT(collection_key, video_url) DO UPDATE SET
                 last_seen_at = excluded.last_seen_at,
                 is_visible = 0,
                 missing_at = excluded.missing_at,
                 last_sync_run_id = excluded.last_sync_run_id",
              params![
                collection_key,
                video.url,
                timestamp,
                timestamp,
                video.site_order.unwrap_or_else(|| -now_millis()),
                timestamp,
                sync_run_id
              ],
            )
            .map_err(to_napi_error)?;
                    Ok(())
                })?;
            }

            self.record_sync_operation(
                &collection_key,
                sync_run_id.as_deref(),
                action,
                &video,
                &timestamp,
                &payload,
            )?;
            return Ok(json!({
              "action": action,
              "changed": changed > 0,
              "collectionKey": collection_key,
              "queued": remote_deferred,
              "url": video.url,
              "visible": false
            }));
        }

        self.with_immediate_transaction(|| {
            self.upsert_video(&video, &timestamp)?;
            self
        .conn()?
        .execute(
          "INSERT INTO collection_items (
             collection_key, video_url, first_seen_at, last_seen_at, site_order, is_visible, missing_at, last_sync_run_id
           )
           VALUES (?, ?, ?, ?, ?, 1, NULL, ?)
           ON CONFLICT(collection_key, video_url) DO UPDATE SET
             last_seen_at = excluded.last_seen_at,
             site_order = CASE
               WHEN collection_items.is_visible = 1 AND excluded.site_order < 0 THEN collection_items.site_order
               ELSE COALESCE(excluded.site_order, collection_items.site_order)
             END,
             is_visible = 1,
             missing_at = NULL,
             last_sync_run_id = COALESCE(excluded.last_sync_run_id, collection_items.last_sync_run_id)",
          params![
            collection_key,
            video.url,
            timestamp,
            timestamp,
            video.site_order.unwrap_or_else(|| -now_millis()),
            sync_run_id
          ],
        )
        .map_err(to_napi_error)?;
            self.record_sync_operation(
                &collection_key,
                sync_run_id.as_deref(),
                action,
                &video,
                &timestamp,
                &payload,
            )?;
            Ok(())
        })?;

        Ok(json!({
          "action": action,
          "changed": true,
          "collectionKey": collection_key,
          "queued": remote_deferred,
          "url": video.url,
          "visible": true
        }))
    }

    pub(crate) fn list_deferred_sync_operations(
        &self,
        payload: Value,
        scoped_to_run: bool,
    ) -> Result<Value> {
        let collection_key =
            value_string(object_field(&payload, "collectionKey")).ok_or_else(|| {
                Error::from_reason("Deferred operation query requires collectionKey".to_string())
            })?;
        ensure_collection(&collection_key)?;
        let sync_run_id = value_string(object_field(&payload, "syncRunId"));
        if scoped_to_run && sync_run_id.is_none() {
            return Ok(Value::Array(Vec::new()));
        }

        let sql = if scoped_to_run {
            "SELECT id, action, video_url, remote_video_id, remote_fav_type
       FROM sync_operations
       WHERE collection_key = ?
         AND sync_run_id = ?
         AND remote_deferred = 1
         AND remote_applied_at IS NULL
         AND remote_apply_state = 'pending'
       ORDER BY id ASC"
        } else {
            "SELECT id, action, video_url, remote_video_id, remote_fav_type
       FROM sync_operations
       WHERE collection_key = ?
         AND remote_deferred = 1
         AND remote_applied_at IS NULL
         AND remote_apply_state = 'pending'
       ORDER BY id ASC"
        };
        let mut statement = self.conn()?.prepare(sql).map_err(to_napi_error)?;
        let rows = if scoped_to_run {
            statement
                .query_map(
                    params![collection_key, sync_run_id],
                    pending_operation_from_row,
                )
                .map_err(to_napi_error)?
                .collect::<std::result::Result<Vec<Value>, _>>()
                .map_err(to_napi_error)?
        } else {
            statement
                .query_map(params![collection_key], pending_operation_from_row)
                .map_err(to_napi_error)?
                .collect::<std::result::Result<Vec<Value>, _>>()
                .map_err(to_napi_error)?
        };

        Ok(Value::Array(rows))
    }

    pub(crate) fn mark_deferred_sync_operations_applied(&self, payload: Value) -> Result<Value> {
        let collection_key = value_string(object_field(&payload, "collectionKey"))
            .ok_or_else(|| Error::from_reason("mark applied requires collectionKey".to_string()))?;
        let sync_run_id = value_string(object_field(&payload, "syncRunId"));
        let ids = object_field(&payload, "ids")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        if ids.is_empty() {
            return Ok(json!(0));
        }

        let timestamp = now_iso();
        let mut applied = 0;
        self.with_immediate_transaction(|| {
            for id_value in &ids {
                let Some(id) = value_i64(Some(id_value)) else {
                    continue;
                };
                let changes = if let Some(sync_run_id) = sync_run_id.as_deref() {
                    self.conn()?
                        .execute(
                            "UPDATE sync_operations
               SET remote_applied_at = ?,
                   remote_apply_error = NULL,
                   remote_apply_state = 'applied',
                   remote_failed_at = NULL,
                   remote_blocked_by = NULL
               WHERE collection_key = ? AND sync_run_id = ? AND id = ?",
                            params![timestamp, collection_key, sync_run_id, id],
                        )
                        .map_err(to_napi_error)?
                } else {
                    self.conn()?
                        .execute(
                            "UPDATE sync_operations
               SET remote_applied_at = ?,
                   remote_apply_error = NULL,
                   remote_apply_state = 'applied',
                   remote_failed_at = NULL,
                   remote_blocked_by = NULL
               WHERE collection_key = ? AND id = ?",
                            params![timestamp, collection_key, id],
                        )
                        .map_err(to_napi_error)?
                };
                applied += changes;
            }
            Ok(())
        })?;
        Ok(json!(applied))
    }

    pub(crate) fn mark_deferred_sync_operation_failed(&self, payload: Value) -> Result<Value> {
        let collection_key = value_string(object_field(&payload, "collectionKey"))
            .ok_or_else(|| Error::from_reason("mark failed requires collectionKey".to_string()))?;
        let sync_run_id = value_string(object_field(&payload, "syncRunId"));
        let id = value_i64(object_field(&payload, "id"))
            .ok_or_else(|| Error::from_reason("mark failed requires id".to_string()))?;
        let message = value_string(object_field(&payload, "message"))
            .unwrap_or_else(|| "Failed to apply queued operation".to_string());
        let timestamp = now_iso();
        let changes = if let Some(sync_run_id) = sync_run_id.as_deref() {
            self.conn()?
                .execute(
                    "UPDATE sync_operations
           SET remote_apply_error = ?,
               remote_apply_state = 'failed',
               remote_failed_at = ?,
               remote_blocked_by = NULL
           WHERE collection_key = ? AND sync_run_id = ? AND id = ?",
                    params![message, timestamp, collection_key, sync_run_id, id],
                )
                .map_err(to_napi_error)?
        } else {
            self.conn()?
                .execute(
                    "UPDATE sync_operations
           SET remote_apply_error = ?,
               remote_apply_state = 'failed',
               remote_failed_at = ?,
               remote_blocked_by = NULL
           WHERE collection_key = ? AND id = ?",
                    params![message, timestamp, collection_key, id],
                )
                .map_err(to_napi_error)?
        };

        if changes > 0 {
            if let Some(sync_run_id) = sync_run_id.as_deref() {
                self.conn()?
                    .execute(
                        "UPDATE sync_operations
             SET remote_apply_error = ?,
                 remote_apply_state = 'blocked',
                 remote_blocked_by = ?
             WHERE collection_key = ?
               AND sync_run_id = ?
               AND id > ?
               AND remote_deferred = 1
               AND remote_applied_at IS NULL
               AND remote_apply_state = 'pending'",
                        params![
                            "Blocked by earlier failed operation",
                            id,
                            collection_key,
                            sync_run_id,
                            id
                        ],
                    )
                    .map_err(to_napi_error)?;
            } else {
                self.conn()?
                    .execute(
                        "UPDATE sync_operations
             SET remote_apply_error = ?,
                 remote_apply_state = 'blocked',
                 remote_blocked_by = ?
             WHERE collection_key = ?
               AND id > ?
               AND remote_deferred = 1
               AND remote_applied_at IS NULL
               AND remote_apply_state = 'pending'",
                        params![
                            "Blocked by earlier failed operation",
                            id,
                            collection_key,
                            id
                        ],
                    )
                    .map_err(to_napi_error)?;
            }
        }

        Ok(json!(changes > 0))
    }

    pub(crate) fn list_pending_remote_operation_groups(&self) -> Result<Value> {
        let mut statement = self
            .conn()?
            .prepare(
                "SELECT so.id, so.collection_key, so.action, so.video_url,
                COALESCE(so.title, v.title) AS title,
                COALESCE(so.views, v.views) AS views,
                COALESCE(so.likes, v.likes) AS likes,
                COALESCE(so.img, v.img) AS img,
                COALESCE(so.preview, v.preview) AS preview,
                so.remote_apply_state, so.remote_apply_error
         FROM sync_operations so
         LEFT JOIN videos v ON v.url = so.video_url
         WHERE so.remote_deferred = 1
           AND so.remote_applied_at IS NULL
           AND so.remote_apply_state IN ('failed', 'blocked', 'pending')
         ORDER BY so.collection_key ASC, so.video_url ASC, so.id ASC",
            )
            .map_err(to_napi_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok(PendingRemoteOperationRow {
                    id: row.get(0)?,
                    collection_key: row.get(1)?,
                    action: row.get(2)?,
                    video_url: row.get(3)?,
                    title: row.get(4)?,
                    views: row.get(5)?,
                    likes: row.get(6)?,
                    img: row.get(7)?,
                    preview: row.get(8)?,
                    remote_apply_state: row.get(9)?,
                    remote_apply_error: row.get(10)?,
                })
            })
            .map_err(to_napi_error)?
            .collect::<std::result::Result<Vec<PendingRemoteOperationRow>, _>>()
            .map_err(to_napi_error)?;

        let mut grouped: HashMap<String, PendingRemoteOperationGroup> = HashMap::new();
        let mut order: Vec<String> = Vec::new();
        for row in rows {
            let group_id = pending_remote_group_id(&row.collection_key, &row.video_url);
            if !grouped.contains_key(&group_id) {
                order.push(group_id.clone());
                grouped.insert(
                    group_id.clone(),
                    PendingRemoteOperationGroup {
                        group_id: group_id.clone(),
                        collection_key: row.collection_key.clone(),
                        video_url: row.video_url.clone(),
                        title: row.title.clone(),
                        views: row.views,
                        likes: row.likes,
                        img: row.img.clone(),
                        preview: row.preview.clone(),
                        state: row.remote_apply_state.clone(),
                        error: row.remote_apply_error.clone(),
                        sequence: Vec::new(),
                    },
                );
            }

            let Some(group) = grouped.get_mut(&group_id) else {
                continue;
            };
            group.sequence.push(json!({
              "id": row.id,
              "action": row.action,
              "state": row.remote_apply_state,
              "error": row.remote_apply_error
            }));
            if row.remote_apply_state == "failed" {
                group.state = "failed".to_string();
                group.error = row.remote_apply_error.clone();
            } else if group.state != "failed" {
                group.state = row.remote_apply_state.clone();
                if row.remote_apply_error.is_some() {
                    group.error = row.remote_apply_error.clone();
                }
            }
            if row.title.is_some() {
                group.title = row.title.clone();
            }
            if row.views.is_some() {
                group.views = row.views;
            }
            if row.likes.is_some() {
                group.likes = row.likes;
            }
            if row.img.is_some() {
                group.img = row.img.clone();
            }
            if row.preview.is_some() {
                group.preview = row.preview.clone();
            }
        }

        let groups = order
            .into_iter()
            .filter_map(|group_id| grouped.remove(&group_id))
            .map(|group| {
                json!({
                  "groupId": group.group_id,
                  "collectionKey": group.collection_key,
                  "videoUrl": group.video_url,
                  "title": group.title,
                  "views": group.views,
                  "likes": group.likes,
                  "img": group.img,
                  "preview": group.preview,
                  "state": group.state,
                  "error": group.error,
                  "operationCount": group.sequence.len(),
                  "sequence": group.sequence
                })
            })
            .collect::<Vec<Value>>();

        Ok(Value::Array(groups))
    }

    pub(crate) fn prepare_pending_remote_operation_retry(&self, payload: Value) -> Result<Value> {
        let (group_id, parts) = pending_remote_group_from_payload(&payload)?;
        let (collection_key, video_url) = parts.ok_or_else(|| {
            Error::from_reason("Pending operation group was not found".to_string())
        })?;
        let row = self
            .latest_pending_remote_retry_operation(&collection_key, &video_url)?
            .ok_or_else(|| {
                Error::from_reason("Pending operation group was not found".to_string())
            })?;

        let mut result = row;
        if let Some(object) = result.as_object_mut() {
            object.insert("groupId".to_string(), json!(group_id));
            object.insert("collectionKey".to_string(), json!(collection_key));
            object.insert("resolved".to_string(), json!(false));
        }
        Ok(result)
    }

    pub(crate) fn mark_pending_remote_operation_group_resolved(
        &self,
        payload: Value,
    ) -> Result<Value> {
        let (_, parts) = pending_remote_group_from_payload(&payload)?;
        let Some((collection_key, video_url)) = parts else {
            return Ok(json!(false));
        };
        let timestamp = now_iso();
        let changes = self.resolve_pending_remote_group(&collection_key, &video_url, &timestamp)?;

        Ok(json!(changes > 0))
    }

    pub(crate) fn mark_pending_remote_operation_group_added(
        &self,
        payload: Value,
    ) -> Result<Value> {
        let (_, parts) = pending_remote_group_from_payload(&payload)?;
        let Some((collection_key, video_url)) = parts else {
            return Ok(json!(false));
        };
        let latest = self.latest_pending_remote_operation(&collection_key, &video_url)?;
        let Some(latest) = latest else {
            return Ok(json!(false));
        };

        let timestamp = now_iso();
        let result = self.with_immediate_transaction(|| {
            let changes =
                self.resolve_pending_remote_group(&collection_key, &video_url, &timestamp)?;
            if changes == 0 {
                return Ok(false);
            }

            let site_order = latest.site_order.unwrap_or_else(|| -now_millis());
            let video = normalized_video_from_operation(&latest, site_order);
            self.upsert_video(&video, &timestamp)?;
            self.upsert_visible_collection_item_from_sync(
                &collection_key,
                &latest.video_url,
                site_order,
                &latest.sync_run_id,
                &timestamp,
            )?;

            self.resequence_visible_items(&collection_key)?;

            Ok(true)
        })?;

        Ok(json!(result))
    }

    pub(crate) fn mark_pending_remote_operation_group_removed(
        &self,
        payload: Value,
    ) -> Result<Value> {
        let (_, parts) = pending_remote_group_from_payload(&payload)?;
        let Some((collection_key, video_url)) = parts else {
            return Ok(json!(false));
        };
        let latest = self.latest_pending_remote_operation(&collection_key, &video_url)?;
        let Some(latest) = latest else {
            return Ok(json!(false));
        };

        let timestamp = now_iso();
        let result = self.with_immediate_transaction(|| {
            let changes =
                self.resolve_pending_remote_group(&collection_key, &video_url, &timestamp)?;
            if changes == 0 {
                return Ok(false);
            }

            let site_order = latest.site_order.unwrap_or_else(|| -now_millis());
            let video = normalized_video_from_operation(&latest, site_order);
            self.upsert_video(&video, &timestamp)?;
            self.upsert_hidden_collection_item_from_sync(
                &collection_key,
                &latest.video_url,
                site_order,
                &latest.sync_run_id,
                &timestamp,
            )?;

            self.resequence_visible_items(&collection_key)?;

            Ok(true)
        })?;

        Ok(json!(result))
    }

    pub(crate) fn mark_pending_remote_operation_group_failed(
        &self,
        payload: Value,
    ) -> Result<Value> {
        let (_, parts) = pending_remote_group_from_payload(&payload)?;
        let Some((collection_key, video_url)) = parts else {
            return Ok(json!(false));
        };
        let message = value_string(object_field(&payload, "message"))
            .unwrap_or_else(|| "Failed to apply queued operation".to_string());
        let latest = self.latest_pending_remote_operation(&collection_key, &video_url)?;
        let Some(latest) = latest else {
            return Ok(json!(false));
        };

        let changes = self
            .conn()?
            .execute(
                "UPDATE sync_operations
         SET remote_apply_state = 'failed',
             remote_apply_error = ?,
             remote_failed_at = ?,
             remote_blocked_by = NULL
         WHERE collection_key = ?
           AND video_url = ?
           AND id = ?",
                params![message, now_iso(), &collection_key, &video_url, latest.id],
            )
            .map_err(to_napi_error)?;
        Ok(json!(changes > 0))
    }

    fn supersede_pending_remote_operations(
        &self,
        collection_key: &str,
        sync_run_id: &str,
        timestamp: &str,
    ) -> Result<usize> {
        self.conn()?
            .execute(
                "UPDATE sync_operations
         SET remote_apply_state = 'superseded',
             remote_superseded_at = ?,
             remote_superseded_by_sync_run_id = ?
         WHERE collection_key = ?
           AND remote_deferred = 1
           AND remote_applied_at IS NULL
           AND remote_apply_state IN ('pending', 'failed', 'blocked')
           AND (sync_run_id IS NULL OR sync_run_id <> ?)",
                params![timestamp, sync_run_id, collection_key, sync_run_id],
            )
            .map_err(to_napi_error)
    }

    fn reconcile_sync_operations(
        &self,
        collection_key: &str,
        sync_run_id: Option<&str>,
        timestamp: &str,
    ) -> Result<usize> {
        let Some(sync_run_id) = sync_run_id else {
            return Ok(0);
        };
        let mut statement = self
            .conn()?
            .prepare(
                "SELECT id, sync_run_id, action, video_url, title, views, likes, img, preview, site_order,
             remote_deferred, remote_apply_state
         FROM sync_operations
         WHERE collection_key = ?
           AND sync_run_id = ?
           AND reconciled_at IS NULL
         ORDER BY id ASC",
            )
            .map_err(to_napi_error)?;
        let operations = statement
            .query_map(params![collection_key, sync_run_id], operation_from_row)
            .map_err(to_napi_error)?
            .collect::<std::result::Result<Vec<OperationRow>, _>>()
            .map_err(to_napi_error)?;
        if operations.is_empty() {
            return Ok(0);
        }

        let mut latest_by_url: HashMap<String, OperationRow> = HashMap::new();
        for operation in &operations {
            latest_by_url.insert(operation.video_url.clone(), operation.clone());
        }
        let mut latest = latest_by_url
            .into_values()
            .filter(|operation| {
                operation.remote_deferred == 0 || operation.remote_apply_state == "applied"
            })
            .collect::<Vec<OperationRow>>();
        latest.sort_by_key(|operation| operation.id);

        self.with_immediate_transaction(|| {
            for (index, operation) in latest.iter().enumerate() {
                let site_order = operation
                    .site_order
                    .unwrap_or_else(|| -now_millis() - index as i64);
                let video = normalized_video_from_operation(operation, site_order);
                self.upsert_video(&video, timestamp)?;

                if operation.action == "remove" {
                    self.upsert_hidden_collection_item_from_sync(
                        collection_key,
                        &operation.video_url,
                        site_order,
                        sync_run_id,
                        timestamp,
                    )?;
                } else {
                    self.upsert_visible_collection_item_from_sync(
                        collection_key,
                        &operation.video_url,
                        site_order,
                        sync_run_id,
                        timestamp,
                    )?;
                }
            }

            self.resequence_visible_items(collection_key)?;

            self.conn()?
                .execute(
                    "UPDATE sync_operations
           SET reconciled_at = ?
           WHERE collection_key = ?
             AND sync_run_id = ?
             AND reconciled_at IS NULL",
                    params![timestamp, collection_key, sync_run_id],
                )
                .map_err(to_napi_error)?;

            Ok(())
        })?;

        Ok(operations.len())
    }

    pub(crate) fn finish_sync(&self, payload: Value) -> Result<Value> {
        let collection_key = value_string(object_field(&payload, "collectionKey"))
            .ok_or_else(|| Error::from_reason("finishSync requires collectionKey".to_string()))?;
        ensure_collection(&collection_key)?;
        let result = object_field(&payload, "result").unwrap_or(&Value::Null);
        let timestamp = now_iso();
        let last_scraped_page = value_i64(object_field(result, "lastScrapedPage"));
        let last_known_url = value_string(object_field(result, "lastKnownUrl"));
        let completed = !matches!(object_field(result, "completed"), Some(Value::Bool(false)));
        let mode = value_string(object_field(&payload, "mode"))
            .or_else(|| value_string(object_field(result, "mode")));
        let sync_run_id = value_string(object_field(&payload, "syncRunId"))
            .or_else(|| value_string(object_field(result, "syncRunId")));
        let queued_operations_failed =
            value_i64(object_field(result, "queuedOperationsFailed")).unwrap_or(0);

        self
      .conn()?
      .execute(
        "INSERT INTO sync_states (collection_key, completed, last_scraped_page, last_known_url, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(collection_key) DO UPDATE SET
           completed = excluded.completed,
           last_scraped_page = COALESCE(excluded.last_scraped_page, sync_states.last_scraped_page),
           last_known_url = COALESCE(excluded.last_known_url, sync_states.last_known_url),
           updated_at = excluded.updated_at",
        params![collection_key, if completed { 1 } else { 0 }, last_scraped_page, last_known_url, timestamp],
      )
      .map_err(to_napi_error)?;

        let mut hidden = 0usize;
        if mode.as_deref() == Some("full") && completed {
            if let Some(sync_run_id) = sync_run_id.as_deref() {
                hidden = self
                    .conn()?
                    .execute(
                        "UPDATE collection_items
             SET is_visible = 0, missing_at = ?
             WHERE collection_key = ?
               AND is_visible = 1
               AND (last_sync_run_id IS NULL OR last_sync_run_id <> ?)",
                        params![timestamp, collection_key, sync_run_id],
                    )
                    .map_err(to_napi_error)?;
            }
        }

        let mutations_reconciled =
            self.reconcile_sync_operations(&collection_key, sync_run_id.as_deref(), &timestamp)?;
        if mode.as_deref() == Some("full") && completed && queued_operations_failed == 0 {
            if let Some(sync_run_id) = sync_run_id.as_deref() {
                self.supersede_pending_remote_operations(&collection_key, sync_run_id, &timestamp)?;
            }
        }
        let mut state = self.get_sync_state(&collection_key)?.ok_or_else(|| {
            Error::from_reason(format!(
                "Sync state was not saved for collection: {collection_key}"
            ))
        })?;
        if let Some(object) = state.as_object_mut() {
            object.insert("hidden".to_string(), json!(hidden));
            object.insert(
                "mutationsReconciled".to_string(),
                json!(mutations_reconciled),
            );
        }

        Ok(state)
    }

    pub(crate) fn get_sync_state(&self, collection_key: &str) -> Result<Option<Value>> {
        let row = self
            .conn()?
            .query_row(
                "SELECT collection_key, completed, last_scraped_page, last_known_url, updated_at
         FROM sync_states
         WHERE collection_key = ?",
                params![collection_key],
                |row| {
                    Ok(json!({
                      "collection_key": row.get::<_, String>(0)?,
                      "completed": row.get::<_, i64>(1)? != 0,
                      "last_scraped_page": row.get::<_, Option<i64>>(2)?,
                      "last_known_url": row.get::<_, Option<String>>(3)?,
                      "updated_at": row.get::<_, String>(4)?
                    }))
                },
            )
            .optional()
            .map_err(to_napi_error)?;

        Ok(row)
    }

    pub(crate) fn clear_sync_state(&self, payload: Value) -> Result<Value> {
        let collection_key = payload
            .as_str()
            .map(|value| value.to_string())
            .or_else(|| value_string(object_field(&payload, "collectionKey")))
            .ok_or_else(|| {
                Error::from_reason("clearSyncState requires collectionKey".to_string())
            })?;
        ensure_collection(&collection_key)?;
        self.conn()?
            .execute(
                "DELETE FROM sync_states WHERE collection_key = ?",
                params![collection_key],
            )
            .map_err(to_napi_error)?;

        Ok(json!({ "collectionKey": collection_key, "cleared": true }))
    }
}
