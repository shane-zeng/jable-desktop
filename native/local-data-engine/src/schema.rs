use napi::bindgen_prelude::*;
use rusqlite::{params, Connection, OptionalExtension};

use crate::collections::collections;
use crate::search::build_video_search_text;
use crate::to_napi_error;

pub(crate) fn verify_fts5(conn: &Connection) -> Result<()> {
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

pub(crate) fn migrate(conn: &Connection) -> Result<()> {
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
         CREATE TABLE IF NOT EXISTS download_assets (
           video_url TEXT PRIMARY KEY,
           status TEXT NOT NULL CHECK(status IN ('queued', 'downloading', 'failed', 'ready', 'missing')),
           file_relative_path TEXT,
           format TEXT,
           title TEXT,
           img TEXT,
           preview TEXT,
           size_bytes INTEGER,
           duration_seconds REAL,
           progress REAL,
           error TEXT,
           downloaded_at TEXT,
           last_checked_at TEXT,
           created_at TEXT NOT NULL,
           updated_at TEXT NOT NULL
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

    backfill_remote_apply_state(conn)?;
    backfill_video_search_text(conn)?;
    ensure_video_search_index(conn)?;
    Ok(())
}

pub(crate) fn seed_collections(conn: &Connection) -> Result<()> {
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

fn backfill_remote_apply_state(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE sync_operations
         SET remote_apply_state = 'applied'
         WHERE remote_deferred = 1
           AND remote_applied_at IS NOT NULL
           AND remote_apply_state = 'pending'",
        [],
    )
    .map_err(to_napi_error)?;
    conn.execute(
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

fn backfill_video_search_text(conn: &Connection) -> Result<()> {
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

fn ensure_video_search_index(conn: &Connection) -> Result<()> {
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
