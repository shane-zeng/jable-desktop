use napi::bindgen_prelude::*;
use napi_derive::napi;
#[cfg(test)]
use rusqlite::params;
use rusqlite::Connection;
use serde_json::Value;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

mod collections;
mod downloads;
mod payload;
mod resource;
mod rows;
mod schema;
mod search;
mod store;
mod sync;

#[cfg(test)]
use payload::{normalize_video_url, read_site_order};
#[cfg(test)]
use search::{build_video_search_text, matches_search};

struct Engine {
    conn: Option<Connection>,
}

pub(crate) fn to_napi_error(error: impl std::fmt::Display) -> Error {
    Error::from_reason(error.to_string())
}

pub(crate) fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

pub(crate) fn now_millis() -> i64 {
    (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

impl Engine {
    fn open(file_path: &str) -> Result<Self> {
        if let Some(parent) = Path::new(file_path).parent() {
            fs::create_dir_all(parent).map_err(to_napi_error)?;
        }

        let conn = Connection::open(file_path).map_err(to_napi_error)?;
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .map_err(to_napi_error)?;
        schema::verify_fts5(&conn)?;
        schema::migrate(&conn)?;
        schema::seed_collections(&conn)?;

        Ok(Self { conn: Some(conn) })
    }

    fn conn(&self) -> Result<&Connection> {
        self.conn
            .as_ref()
            .ok_or_else(|| Error::from_reason("Native data engine is closed".to_string()))
    }

    fn close(&mut self) -> Result<()> {
        if let Some(conn) = self.conn.take() {
            conn.close().map_err(|(_, error)| to_napi_error(error))?;
        }

        Ok(())
    }

    fn with_immediate_transaction<T>(&self, operation: impl FnOnce() -> Result<T>) -> Result<T> {
        self.conn()?
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(to_napi_error)?;

        match operation() {
            Ok(value) => {
                self.conn()?
                    .execute_batch("COMMIT")
                    .map_err(to_napi_error)?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.conn()?.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    fn dispatch(&mut self, method: &str, payload: Value) -> Result<Value> {
        match method {
            "listVideos" => self.list_videos(payload),
            "countVideos" => self.count_videos(payload),
            "getCollectionUrls" => self.get_collection_urls(payload),
            "allCollectionUrlsKnown" => self.all_collection_urls_known(payload),
            "refreshVideoMetadata" => self.refresh_video_metadata(payload),
            "saveSyncPage" => self.save_sync_page(payload),
            "applyCollectionToggle" => self.apply_collection_toggle(payload),
            "listDeferredSyncOperations" => self.list_deferred_sync_operations(payload, true),
            "listDeferredSyncOutboxOperations" => {
                self.list_deferred_sync_operations(payload, false)
            }
            "markDeferredSyncOperationsApplied" => {
                self.mark_deferred_sync_operations_applied(payload)
            }
            "markDeferredSyncOperationFailed" => self.mark_deferred_sync_operation_failed(payload),
            "listPendingRemoteOperationGroups" => self.list_pending_remote_operation_groups(),
            "preparePendingRemoteOperationRetry" => {
                self.prepare_pending_remote_operation_retry(payload)
            }
            "markPendingRemoteOperationGroupAdded" => {
                self.mark_pending_remote_operation_group_added(payload)
            }
            "markPendingRemoteOperationGroupRemoved" => {
                self.mark_pending_remote_operation_group_removed(payload)
            }
            "markPendingRemoteOperationGroupResolved" => {
                self.mark_pending_remote_operation_group_resolved(payload)
            }
            "markPendingRemoteOperationGroupFailed" => {
                self.mark_pending_remote_operation_group_failed(payload)
            }
            "finishSync" => self.finish_sync(payload),
            "clearSyncState" => self.clear_sync_state(payload),
            "listDownloadAssets" => self.list_download_assets(),
            "getDownloadAsset" => self.get_download_asset(payload),
            "upsertDownloadAsset" => self.upsert_download_asset(payload),
            "removeDownloadAsset" => self.remove_download_asset(payload),
            "importResource" => self.import_resource(payload),
            "exportResource" => self.export_resource(payload),
            "exportResourceToFile" => self.export_resource_to_file(payload),
            _ => Err(Error::from_reason(format!(
                "Unknown native data engine method: {method}"
            ))),
        }
    }
}

#[napi]
pub struct JableDataEngine {
    inner: Mutex<Engine>,
}

#[napi]
impl JableDataEngine {
    #[napi(constructor)]
    pub fn new(file_path: String) -> Result<Self> {
        Ok(Self {
            inner: Mutex::new(Engine::open(&file_path)?),
        })
    }

    #[napi]
    pub fn close(&self) -> Result<()> {
        self.inner.lock().map_err(to_napi_error)?.close()
    }

    #[napi]
    pub fn call(&self, method: String, payload: String) -> Result<String> {
        let payload = if payload.trim().is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&payload).map_err(to_napi_error)?
        };
        let mut engine = self.inner.lock().map_err(to_napi_error)?;
        let result = engine.dispatch(&method, payload)?;
        serde_json::to_string(&result).map_err(to_napi_error)
    }

    #[napi(js_name = "engineVersion")]
    pub fn engine_version(&self) -> String {
        "rust-native".to_string()
    }
}

#[cfg(test)]
mod tests;
