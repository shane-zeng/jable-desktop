use napi::bindgen_prelude::*;
use napi_derive::napi;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use unicode_normalization::UnicodeNormalization;
use url::Url;

const PAGE_SIZE: usize = 24;
const SEARCH_NGRAM_MAX: usize = 3;
const PRIMARY_ORIGIN: &str = "https://jable.tv";

#[derive(Clone)]
struct Collection {
    key: &'static str,
    name: &'static str,
    source_path: &'static str,
}

#[derive(Clone)]
struct NormalizedVideo {
    url: String,
    title: Option<String>,
    views: Option<i64>,
    likes: Option<i64>,
    img: Option<String>,
    preview: Option<String>,
    site_order: Option<i64>,
    search_text: String,
}

#[derive(Clone)]
struct OperationRow {
    id: i64,
    sync_run_id: String,
    action: String,
    video_url: String,
    title: Option<String>,
    views: Option<i64>,
    likes: Option<i64>,
    img: Option<String>,
    preview: Option<String>,
    site_order: Option<i64>,
    remote_deferred: i64,
    remote_apply_state: String,
}

struct PendingRemoteOperationRow {
    id: i64,
    collection_key: String,
    action: String,
    video_url: String,
    title: Option<String>,
    views: Option<i64>,
    likes: Option<i64>,
    img: Option<String>,
    preview: Option<String>,
    remote_apply_state: String,
    remote_apply_error: Option<String>,
}

struct PendingRemoteOperationGroup {
    group_id: String,
    collection_key: String,
    video_url: String,
    title: Option<String>,
    views: Option<i64>,
    likes: Option<i64>,
    img: Option<String>,
    preview: Option<String>,
    final_action: String,
    state: String,
    error: Option<String>,
    sequence: Vec<Value>,
}

struct ListRow {
    url: String,
    title: Option<String>,
    views: Option<i64>,
    likes: Option<i64>,
    img: Option<String>,
    preview: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
    first_seen_at: Option<String>,
    last_seen_at: Option<String>,
    site_order: Option<i64>,
    is_visible: i64,
    missing_at: Option<String>,
    last_sync_run_id: Option<String>,
    search_text: Option<String>,
}

struct Engine {
    conn: Option<Connection>,
}

fn collections() -> [Collection; 2] {
    [
        Collection {
            key: "favourites",
            name: "影片收藏",
            source_path: "/my/favourites/videos/",
        },
        Collection {
            key: "watch_later",
            name: "稍後觀看",
            source_path: "/my/favourites/videos-watch-later/",
        },
    ]
}

fn to_napi_error(error: impl std::fmt::Display) -> Error {
    Error::from_reason(error.to_string())
}

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

fn now_millis() -> i64 {
    (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000_000) as i64
}

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

fn value_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Some(Value::Number(number)) => Some(number.to_string()),
        Some(Value::Bool(flag)) => Some(flag.to_string()),
        _ => None,
    }
}

fn value_i64(value: Option<&Value>) -> Option<i64> {
    match value {
        Some(Value::Number(number)) => number
            .as_i64()
            .or_else(|| number.as_f64().map(|n| n as i64)),
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                trimmed.parse::<f64>().ok().map(|n| n as i64)
            }
        }
        _ => None,
    }
}

fn value_bool(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::Bool(true)))
}

fn object_field<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.as_object().and_then(|object| object.get(key))
}

fn collection_by_key(key: &str) -> Option<Collection> {
    collections()
        .into_iter()
        .find(|collection| collection.key == key)
}

fn ensure_collection(key: &str) -> Result<Collection> {
    collection_by_key(key).ok_or_else(|| Error::from_reason(format!("Unknown collection: {key}")))
}

fn normalize_video_url(value: Option<&Value>) -> Option<String> {
    let text = value_string(value)?;
    let mut parsed = Url::parse(&text).ok()?;

    parsed.set_query(None);
    parsed.set_fragment(None);
    if parsed.path().starts_with("/videos/") && !parsed.path().ends_with('/') {
        let next = format!("{}/", parsed.path());
        parsed.set_path(&next);
    }

    if parsed.domain() == Some("jable.tv") || parsed.domain() == Some("fs1.app") {
        let mut target = Url::parse(PRIMARY_ORIGIN).ok()?;
        target.set_path(parsed.path());
        return Some(target.to_string());
    }

    Some(parsed.to_string())
}

fn read_site_order(value: &Value) -> Option<i64> {
    value_i64(object_field(value, "siteOrder"))
        .or_else(|| value_i64(object_field(value, "site_order")))
        .or_else(|| value_i64(object_field(value, "sort_order")))
}

fn normalize_video(value: &Value) -> Option<NormalizedVideo> {
    let url = normalize_video_url(object_field(value, "url"))?;
    let title = value_string(object_field(value, "title"));
    let video = NormalizedVideo {
        search_text: build_video_search_text(title.as_deref(), Some(&url)),
        url,
        title,
        views: value_i64(object_field(value, "views")),
        likes: value_i64(object_field(value, "likes")),
        img: value_string(object_field(value, "img")),
        preview: value_string(object_field(value, "preview")),
        site_order: read_site_order(value),
    };

    Some(video)
}

fn is_cjk_search_char(char_value: char) -> bool {
    matches!(
      char_value as u32,
      0x3400..=0x4dbf
        | 0x4e00..=0x9fff
        | 0xf900..=0xfaff
        | 0x3040..=0x309f
        | 0x30a0..=0x30ff
        | 0xac00..=0xd7af
    )
}

fn is_search_word_char(char_value: char) -> bool {
    char_value.is_alphanumeric()
}

fn normalized_search_text(value: Option<&str>) -> String {
    value
        .unwrap_or("")
        .nfkc()
        .flat_map(|char_value| char_value.to_lowercase())
        .collect::<String>()
}

fn search_runs(value: Option<&str>) -> Vec<String> {
    let text = normalized_search_text(value);
    let mut runs = Vec::new();
    let mut current = String::new();
    let mut current_type: Option<&str> = None;

    for char_value in text.chars() {
        let char_type = if is_cjk_search_char(char_value) {
            Some("cjk")
        } else if is_search_word_char(char_value) {
            Some("word")
        } else {
            None
        };

        if char_type.is_none() {
            if !current.is_empty() {
                runs.push(current.clone());
            }
            current.clear();
            current_type = None;
            continue;
        }

        if current_type.is_some() && current_type != char_type {
            runs.push(current.clone());
            current.clear();
        }

        current.push(char_value);
        current_type = char_type;
    }

    if !current.is_empty() {
        runs.push(current);
    }

    runs
}

fn add_ngrams(tokens: &mut HashMap<String, bool>, run: &str) {
    let chars = run.chars().collect::<Vec<char>>();
    let max_size = SEARCH_NGRAM_MAX.min(chars.len());

    for size in 1..=max_size {
        for start in 0..=(chars.len() - size) {
            tokens.insert(chars[start..start + size].iter().collect(), true);
        }
    }
}

fn compact_search_value(value: Option<&str>) -> String {
    normalized_search_text(value)
        .chars()
        .filter(|char_value| is_cjk_search_char(*char_value) || is_search_word_char(*char_value))
        .collect()
}

fn build_video_search_text(title: Option<&str>, url: Option<&str>) -> String {
    let mut tokens = HashMap::new();

    for value in [title, url] {
        for run in search_runs(value) {
            add_ngrams(&mut tokens, &run);
        }

        let compact = compact_search_value(value);
        if !compact.is_empty() {
            add_ngrams(&mut tokens, &compact);
        }
    }

    let mut keys = tokens.keys().cloned().collect::<Vec<String>>();
    keys.sort();
    keys.join(" ")
}

fn search_query_tokens_for_run(run: &str) -> Vec<String> {
    let chars = run.chars().collect::<Vec<char>>();
    if chars.len() <= SEARCH_NGRAM_MAX {
        return vec![run.to_string()];
    }

    let mut tokens = Vec::new();
    for start in 0..=(chars.len() - SEARCH_NGRAM_MAX) {
        tokens.push(chars[start..start + SEARCH_NGRAM_MAX].iter().collect());
    }

    tokens
}

fn search_text_has(search_text: &str, token: &str) -> bool {
    search_text.split_whitespace().any(|entry| entry == token)
}

fn matches_search_term(search_text: &str, term: &str) -> bool {
    let runs = search_runs(Some(term));
    if runs.is_empty() {
        return true;
    }

    runs.iter().all(|run| {
        search_query_tokens_for_run(run)
            .iter()
            .all(|token| search_text_has(search_text, token))
    })
}

fn matches_search(search_text: &str, search: Option<&str>, search_mode: &str) -> bool {
    let Some(search) = search else {
        return true;
    };
    let search = search.trim();
    if search.is_empty() {
        return true;
    }

    if search_mode == "phrase" {
        let compact = compact_search_value(Some(search));
        if compact.is_empty() {
            return true;
        }

        return search_query_tokens_for_run(&compact)
            .iter()
            .all(|token| search_text_has(search_text, token));
    }

    let terms = search
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .collect::<Vec<&str>>();
    if terms.is_empty() {
        return true;
    }

    if search_mode == "all" {
        terms
            .iter()
            .all(|term| matches_search_term(search_text, term))
    } else {
        terms
            .iter()
            .any(|term| matches_search_term(search_text, term))
    }
}

fn verify_fts5(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS __jable_data_engine_fts_probe USING fts5(value);
       DROP TABLE IF EXISTS __jable_data_engine_fts_probe;",
    )
    .map_err(|error| {
        Error::from_reason(format!(
            "SQLite FTS5 is required by the native data engine: {error}"
        ))
    })?;

    Ok(())
}

fn ensure_column(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
    definition: &str,
) -> Result<()> {
    let mut statement = conn
        .prepare(&format!("PRAGMA table_info({table_name})"))
        .map_err(to_napi_error)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(to_napi_error)?
        .collect::<std::result::Result<Vec<String>, _>>()
        .map_err(to_napi_error)?;

    if !columns.iter().any(|name| name == column_name) {
        conn.execute_batch(&format!(
            "ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}"
        ))
        .map_err(to_napi_error)?;
    }

    Ok(())
}

fn video_search_has_expected_columns(conn: &Connection) -> Result<bool> {
    let mut statement = conn
        .prepare("PRAGMA table_info(video_search)")
        .map_err(to_napi_error)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(to_napi_error)?
        .collect::<std::result::Result<Vec<String>, _>>()
        .map_err(to_napi_error)?;

    Ok(columns.iter().any(|name| name == "title")
        && columns.iter().any(|name| name == "url")
        && columns.iter().any(|name| name == "search_text"))
}

impl Engine {
    fn open(file_path: &str) -> Result<Self> {
        if let Some(parent) = Path::new(file_path).parent() {
            fs::create_dir_all(parent).map_err(to_napi_error)?;
        }

        let conn = Connection::open(file_path).map_err(to_napi_error)?;
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
            .map_err(to_napi_error)?;
        verify_fts5(&conn)?;

        let engine = Self { conn: Some(conn) };
        engine.migrate()?;
        engine.seed_collections()?;
        Ok(engine)
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

    fn migrate(&self) -> Result<()> {
        let conn = self.conn()?;
        conn
      .execute_batch(
        "CREATE TABLE IF NOT EXISTS videos (
           url TEXT PRIMARY KEY,
           title TEXT,
           views INTEGER,
           likes INTEGER,
           img TEXT,
           preview TEXT,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS collections (
           key TEXT PRIMARY KEY,
           name TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS collection_items (
           collection_key TEXT NOT NULL,
           video_url TEXT NOT NULL,
           first_seen_at TEXT NOT NULL,
           last_seen_at TEXT NOT NULL,
           PRIMARY KEY (collection_key, video_url),
           FOREIGN KEY (collection_key) REFERENCES collections(key) ON DELETE CASCADE,
           FOREIGN KEY (video_url) REFERENCES videos(url) ON DELETE CASCADE
         );
         CREATE TABLE IF NOT EXISTS sync_states (
           collection_key TEXT PRIMARY KEY,
           completed INTEGER NOT NULL DEFAULT 0,
           last_scraped_page INTEGER,
           last_known_url TEXT,
           updated_at TEXT NOT NULL,
           FOREIGN KEY (collection_key) REFERENCES collections(key) ON DELETE CASCADE
         );
         CREATE TABLE IF NOT EXISTS sync_operations (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           collection_key TEXT NOT NULL,
           sync_run_id TEXT NOT NULL,
           action TEXT NOT NULL CHECK(action IN ('add', 'remove')),
           video_url TEXT NOT NULL,
           title TEXT,
           views INTEGER,
           likes INTEGER,
           img TEXT,
           preview TEXT,
           site_order INTEGER,
           remote_deferred INTEGER NOT NULL DEFAULT 0,
           remote_video_id TEXT,
           remote_fav_type TEXT,
           source_url TEXT,
           remote_applied_at TEXT,
           remote_apply_error TEXT,
           remote_apply_state TEXT NOT NULL DEFAULT 'pending',
           remote_failed_at TEXT,
           remote_blocked_by INTEGER,
           remote_resolved_at TEXT,
           remote_superseded_at TEXT,
           remote_superseded_by_sync_run_id TEXT,
           created_at TEXT NOT NULL,
           reconciled_at TEXT,
           FOREIGN KEY (collection_key) REFERENCES collections(key) ON DELETE CASCADE
         );
         CREATE INDEX IF NOT EXISTS sync_operations_run_idx ON sync_operations (collection_key, sync_run_id, reconciled_at, id);
         DROP TABLE IF EXISTS playback_states;",
      )
      .map_err(to_napi_error)?;

        ensure_column(conn, "collection_items", "site_order", "INTEGER")?;
        ensure_column(
            conn,
            "collection_items",
            "is_visible",
            "INTEGER NOT NULL DEFAULT 1",
        )?;
        ensure_column(conn, "collection_items", "missing_at", "TEXT")?;
        ensure_column(conn, "collection_items", "last_sync_run_id", "TEXT")?;
        ensure_column(
            conn,
            "sync_operations",
            "remote_deferred",
            "INTEGER NOT NULL DEFAULT 0",
        )?;
        ensure_column(conn, "sync_operations", "remote_video_id", "TEXT")?;
        ensure_column(conn, "sync_operations", "remote_fav_type", "TEXT")?;
        ensure_column(conn, "sync_operations", "source_url", "TEXT")?;
        ensure_column(conn, "sync_operations", "remote_applied_at", "TEXT")?;
        ensure_column(conn, "sync_operations", "remote_apply_error", "TEXT")?;
        ensure_column(
            conn,
            "sync_operations",
            "remote_apply_state",
            "TEXT NOT NULL DEFAULT 'pending'",
        )?;
        ensure_column(conn, "sync_operations", "remote_failed_at", "TEXT")?;
        ensure_column(conn, "sync_operations", "remote_blocked_by", "INTEGER")?;
        ensure_column(conn, "sync_operations", "remote_resolved_at", "TEXT")?;
        ensure_column(conn, "sync_operations", "remote_superseded_at", "TEXT")?;
        ensure_column(
            conn,
            "sync_operations",
            "remote_superseded_by_sync_run_id",
            "TEXT",
        )?;
        ensure_column(conn, "videos", "search_text", "TEXT")?;

        self.backfill_remote_apply_state()?;
        self.backfill_video_search_text()?;
        self.ensure_video_search_index()?;
        Ok(())
    }

    fn backfill_remote_apply_state(&self) -> Result<()> {
        self.conn()?
            .execute(
                "UPDATE sync_operations
         SET remote_apply_state = 'applied'
         WHERE remote_deferred = 1
           AND remote_applied_at IS NOT NULL
           AND remote_apply_state = 'pending'",
                [],
            )
            .map_err(to_napi_error)?;
        self.conn()?
            .execute(
                "UPDATE sync_operations
         SET remote_apply_state = 'failed'
         WHERE remote_deferred = 1
           AND remote_applied_at IS NULL
           AND remote_apply_error IS NOT NULL
           AND remote_apply_state = 'pending'",
                [],
            )
            .map_err(to_napi_error)?;
        Ok(())
    }

    fn backfill_video_search_text(&self) -> Result<()> {
        let conn = self.conn()?;
        let mut statement = conn
            .prepare("SELECT url, title FROM videos WHERE search_text IS NULL")
            .map_err(to_napi_error)?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(to_napi_error)?
            .collect::<std::result::Result<Vec<(String, Option<String>)>, _>>()
            .map_err(to_napi_error)?;

        let mut update = conn
            .prepare("UPDATE videos SET search_text = ? WHERE url = ?")
            .map_err(to_napi_error)?;
        for (url, title) in rows {
            update
                .execute(params![
                    build_video_search_text(title.as_deref(), Some(&url)),
                    url
                ])
                .map_err(to_napi_error)?;
        }

        Ok(())
    }

    fn ensure_video_search_index(&self) -> Result<()> {
        let conn = self.conn()?;
        conn.execute_batch(
            "DROP TRIGGER IF EXISTS videos_ai;
         DROP TRIGGER IF EXISTS videos_ad;
         DROP TRIGGER IF EXISTS videos_au;",
        )
        .map_err(to_napi_error)?;

        let index_exists: Option<String> = conn
            .query_row(
                "SELECT name FROM sqlite_master WHERE type = ? AND name = ?",
                params!["table", "video_search"],
                |row| row.get(0),
            )
            .optional()
            .map_err(to_napi_error)?;

        if index_exists.is_some() && !video_search_has_expected_columns(conn)? {
            conn.execute_batch("DROP TABLE video_search")
                .map_err(to_napi_error)?;
        }

        conn
      .execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS video_search USING fts5(title, url, search_text, content='videos', content_rowid='rowid', tokenize='unicode61');
         CREATE TRIGGER IF NOT EXISTS videos_ai AFTER INSERT ON videos BEGIN
           INSERT INTO video_search(rowid, title, url, search_text) VALUES (new.rowid, new.title, new.url, new.search_text);
         END;
         CREATE TRIGGER IF NOT EXISTS videos_ad AFTER DELETE ON videos BEGIN
           INSERT INTO video_search(video_search, rowid, title, url, search_text) VALUES('delete', old.rowid, old.title, old.url, old.search_text);
         END;
         CREATE TRIGGER IF NOT EXISTS videos_au AFTER UPDATE OF title, url, search_text ON videos BEGIN
           INSERT INTO video_search(video_search, rowid, title, url, search_text) VALUES('delete', old.rowid, old.title, old.url, old.search_text);
           INSERT INTO video_search(rowid, title, url, search_text) VALUES (new.rowid, new.title, new.url, new.search_text);
         END;
         INSERT INTO video_search(video_search) VALUES ('rebuild');",
      )
      .map_err(to_napi_error)?;

        Ok(())
    }

    fn seed_collections(&self) -> Result<()> {
        let conn = self.conn()?;
        let mut statement = conn
            .prepare("INSERT OR IGNORE INTO collections (key, name) VALUES (?, ?)")
            .map_err(to_napi_error)?;

        for collection in collections() {
            statement
                .execute(params![collection.key, collection.name])
                .map_err(to_napi_error)?;
        }

        Ok(())
    }

    fn dispatch(&mut self, method: &str, payload: Value) -> Result<Value> {
        match method {
            "listVideos" => self.list_videos(payload),
            "countVideos" => self.count_videos(payload),
            "getCollectionUrls" => self.get_collection_urls(payload),
            "allCollectionUrlsKnown" => self.all_collection_urls_known(payload),
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
            "markPendingRemoteOperationGroupResolved" => {
                self.mark_pending_remote_operation_group_resolved(payload)
            }
            "markPendingRemoteOperationGroupFailed" => {
                self.mark_pending_remote_operation_group_failed(payload)
            }
            "finishSync" => self.finish_sync(payload),
            "clearSyncState" => self.clear_sync_state(payload),
            "importResource" => self.import_resource(payload),
            "exportResource" => self.export_resource(payload),
            "exportResourceToFile" => self.export_resource_to_file(payload),
            "getSyncState" => self.get_sync_state_payload(payload),
            _ => Err(Error::from_reason(format!(
                "Unknown native data engine method: {method}"
            ))),
        }
    }

    fn upsert_video(&self, video: &NormalizedVideo, timestamp: &str) -> Result<()> {
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

    fn list_videos(&self, payload: Value) -> Result<Value> {
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

    fn count_videos(&self, payload: Value) -> Result<Value> {
        let collection_key = value_string(object_field(&payload, "collectionKey"))
            .ok_or_else(|| Error::from_reason("countVideos requires collectionKey".to_string()))?;
        Ok(json!(self.list_rows(&collection_key, &payload)?.len()))
    }

    fn get_collection_urls(&self, payload: Value) -> Result<Value> {
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

    fn all_collection_urls_known(&self, payload: Value) -> Result<Value> {
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

    fn save_sync_page(&self, payload: Value) -> Result<Value> {
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

        self.conn()?
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(to_napi_error)?;
        let result = (|| -> Result<()> {
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
        })();

        if result.is_ok() {
            self.conn()?
                .execute_batch("COMMIT")
                .map_err(to_napi_error)?;
        } else {
            let _ = self.conn()?.execute_batch("ROLLBACK");
        }
        result?;

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

    fn apply_collection_toggle(&self, payload: Value) -> Result<Value> {
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
                self.conn()?
                    .execute_batch("BEGIN IMMEDIATE")
                    .map_err(to_napi_error)?;
                let result = (|| -> Result<()> {
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
                })();
                if result.is_ok() {
                    self.conn()?
                        .execute_batch("COMMIT")
                        .map_err(to_napi_error)?;
                } else {
                    let _ = self.conn()?.execute_batch("ROLLBACK");
                }
                result?;
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

        self.conn()?
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(to_napi_error)?;
        let result = (|| -> Result<()> {
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
        })();
        if result.is_ok() {
            self.conn()?
                .execute_batch("COMMIT")
                .map_err(to_napi_error)?;
        } else {
            let _ = self.conn()?.execute_batch("ROLLBACK");
        }
        result?;

        Ok(json!({
          "action": action,
          "changed": true,
          "collectionKey": collection_key,
          "queued": remote_deferred,
          "url": video.url,
          "visible": true
        }))
    }

    fn list_deferred_sync_operations(&self, payload: Value, scoped_to_run: bool) -> Result<Value> {
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

    fn mark_deferred_sync_operations_applied(&self, payload: Value) -> Result<Value> {
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
        self.conn()?
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(to_napi_error)?;
        let result = (|| -> Result<()> {
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
        })();
        if result.is_ok() {
            self.conn()?
                .execute_batch("COMMIT")
                .map_err(to_napi_error)?;
        } else {
            let _ = self.conn()?.execute_batch("ROLLBACK");
        }
        result?;
        Ok(json!(applied))
    }

    fn mark_deferred_sync_operation_failed(&self, payload: Value) -> Result<Value> {
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

    fn list_pending_remote_operation_groups(&self) -> Result<Value> {
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
                        final_action: row.action.clone(),
                        state: row.remote_apply_state.clone(),
                        error: row.remote_apply_error.clone(),
                        sequence: Vec::new(),
                    },
                );
            }

            let Some(group) = grouped.get_mut(&group_id) else {
                continue;
            };
            group.final_action = row.action.clone();
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
                  "finalAction": group.final_action,
                  "state": group.state,
                  "error": group.error,
                  "operationCount": group.sequence.len(),
                  "sequence": group.sequence
                })
            })
            .collect::<Vec<Value>>();

        Ok(Value::Array(groups))
    }

    fn prepare_pending_remote_operation_retry(&self, payload: Value) -> Result<Value> {
        let group_id = value_string(object_field(&payload, "groupId")).ok_or_else(|| {
            Error::from_reason("Pending operation group requires groupId".to_string())
        })?;
        let (collection_key, video_url) =
            pending_remote_group_parts(Some(&group_id)).ok_or_else(|| {
                Error::from_reason("Pending operation group was not found".to_string())
            })?;
        let row = self
            .conn()?
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
                params![&collection_key, &video_url],
                pending_operation_from_row,
            )
            .optional()
            .map_err(to_napi_error)?
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

    fn mark_pending_remote_operation_group_resolved(&self, payload: Value) -> Result<Value> {
        let group_id = value_string(object_field(&payload, "groupId")).ok_or_else(|| {
            Error::from_reason("Pending operation group requires groupId".to_string())
        })?;
        let Some((collection_key, video_url)) = pending_remote_group_parts(Some(&group_id)) else {
            return Ok(json!(false));
        };
        let latest = self
            .conn()?
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
                params![&collection_key, &video_url],
                |row| {
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
                },
            )
            .optional()
            .map_err(to_napi_error)?;
        let Some(latest) = latest else {
            return Ok(json!(false));
        };

        let timestamp = now_iso();
        self.conn()?
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(to_napi_error)?;
        let result = (|| -> Result<bool> {
            let changes = self
                .conn()?
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
                    params![timestamp, &collection_key, &video_url],
                )
                .map_err(to_napi_error)?;
            if changes == 0 {
                return Ok(false);
            }

            let site_order = latest.site_order.unwrap_or_else(|| -now_millis());
            let video = NormalizedVideo {
                url: latest.video_url.clone(),
                title: latest.title.clone(),
                views: latest.views,
                likes: latest.likes,
                img: latest.img.clone(),
                preview: latest.preview.clone(),
                site_order: Some(site_order),
                search_text: build_video_search_text(
                    latest.title.as_deref(),
                    Some(&latest.video_url),
                ),
            };
            self.upsert_video(&video, &timestamp)?;

            if latest.action == "remove" {
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
                            &collection_key,
                            &latest.video_url,
                            &timestamp,
                            &timestamp,
                            site_order,
                            &timestamp,
                            &latest.sync_run_id
                        ],
                    )
                    .map_err(to_napi_error)?;
            } else {
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
                            &collection_key,
                            &latest.video_url,
                            &timestamp,
                            &timestamp,
                            site_order,
                            &latest.sync_run_id
                        ],
                    )
                    .map_err(to_napi_error)?;
            }

            let visible_urls = self.visible_urls_for_resequence(&collection_key)?;
            for (index, url) in visible_urls.iter().enumerate() {
                self.conn()?
                    .execute(
                        "UPDATE collection_items SET site_order = ? WHERE collection_key = ? AND video_url = ?",
                        params![index as i64 + 1, &collection_key, url],
                    )
                    .map_err(to_napi_error)?;
            }

            Ok(true)
        })();

        if result.is_ok() {
            self.conn()?
                .execute_batch("COMMIT")
                .map_err(to_napi_error)?;
        } else {
            let _ = self.conn()?.execute_batch("ROLLBACK");
        }

        Ok(json!(result?))
    }

    fn mark_pending_remote_operation_group_failed(&self, payload: Value) -> Result<Value> {
        let group_id = value_string(object_field(&payload, "groupId")).ok_or_else(|| {
            Error::from_reason("Pending operation group requires groupId".to_string())
        })?;
        let Some((collection_key, video_url)) = pending_remote_group_parts(Some(&group_id)) else {
            return Ok(json!(false));
        };
        let message = value_string(object_field(&payload, "message"))
            .unwrap_or_else(|| "Failed to apply queued operation".to_string());
        let latest_id = self
            .conn()?
            .query_row(
                "SELECT id
         FROM sync_operations
         WHERE collection_key = ?
           AND video_url = ?
           AND remote_deferred = 1
           AND remote_applied_at IS NULL
           AND remote_apply_state IN ('failed', 'blocked', 'pending')
         ORDER BY id DESC
         LIMIT 1",
                params![&collection_key, &video_url],
                |row| row.get::<_, i64>(0),
            )
            .optional()
            .map_err(to_napi_error)?;
        let Some(latest_id) = latest_id else {
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
                params![message, now_iso(), &collection_key, &video_url, latest_id],
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
           AND remote_apply_state IN ('failed', 'blocked')",
                params![timestamp, sync_run_id, collection_key],
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
            .query_map(params![collection_key, sync_run_id], |row| {
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
            })
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

        self.conn()?
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(to_napi_error)?;
        let result = (|| -> Result<()> {
            for (index, operation) in latest.iter().enumerate() {
                let site_order = operation
                    .site_order
                    .unwrap_or_else(|| -now_millis() - index as i64);
                let video = NormalizedVideo {
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
                };
                self.upsert_video(&video, timestamp)?;

                if operation.action == "remove" {
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
              params![collection_key, operation.video_url, timestamp, timestamp, site_order, timestamp, sync_run_id],
            )
            .map_err(to_napi_error)?;
                } else {
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
                 last_sync_run_id = excluded.last_sync_run_id",
              params![collection_key, operation.video_url, timestamp, timestamp, site_order, sync_run_id],
            )
            .map_err(to_napi_error)?;
                }
            }

            let visible_urls = self.visible_urls_for_resequence(collection_key)?;
            for (index, url) in visible_urls.iter().enumerate() {
                self
          .conn()?
          .execute(
            "UPDATE collection_items SET site_order = ? WHERE collection_key = ? AND video_url = ?",
            params![index as i64 + 1, collection_key, url],
          )
          .map_err(to_napi_error)?;
            }

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
        })();

        if result.is_ok() {
            self.conn()?
                .execute_batch("COMMIT")
                .map_err(to_napi_error)?;
        } else {
            let _ = self.conn()?.execute_batch("ROLLBACK");
        }
        result?;

        Ok(operations.len())
    }

    fn visible_urls_for_resequence(&self, collection_key: &str) -> Result<Vec<String>> {
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

    fn finish_sync(&self, payload: Value) -> Result<Value> {
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

    fn get_sync_state(&self, collection_key: &str) -> Result<Option<Value>> {
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

    fn get_sync_state_payload(&self, payload: Value) -> Result<Value> {
        let collection_key = payload
            .as_str()
            .map(|value| value.to_string())
            .or_else(|| value_string(object_field(&payload, "collectionKey")))
            .ok_or_else(|| Error::from_reason("getSyncState requires collectionKey".to_string()))?;
        Ok(self.get_sync_state(&collection_key)?.unwrap_or(Value::Null))
    }

    fn clear_sync_state(&self, payload: Value) -> Result<Value> {
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

    fn import_resource(&self, payload: Value) -> Result<Value> {
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

    fn export_resource(&self, payload: Value) -> Result<Value> {
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

    fn export_resource_to_file(&self, payload: Value) -> Result<Value> {
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

fn pending_operation_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
      "id": row.get::<_, i64>(0)?,
      "action": row.get::<_, String>(1)?,
      "videoUrl": row.get::<_, String>(2)?,
      "remoteVideoId": row.get::<_, Option<String>>(3)?,
      "remoteFavType": row.get::<_, Option<String>>(4)?
    }))
}

fn list_row_json(row: &ListRow) -> Value {
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
