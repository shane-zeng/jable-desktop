use super::*;
use serde_json::json;
use std::path::PathBuf;

fn test_engine(name: &str) -> Engine {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "jable-rust-engine-{name}-{}-{}.sqlite",
        std::process::id(),
        now_millis()
    ));
    Engine::open(path.to_string_lossy().as_ref()).expect("test engine should open")
}

fn group_id(group: &Value) -> &str {
    group
        .get("groupId")
        .and_then(Value::as_str)
        .expect("group should include groupId")
}

fn first_outbox_id(engine: &Engine, collection_key: &str) -> i64 {
    let operations = engine
        .list_deferred_sync_operations(json!({ "collectionKey": collection_key }), false)
        .expect("outbox should list")
        .as_array()
        .cloned()
        .expect("outbox should be an array");

    operations
        .first()
        .and_then(|operation| operation.get("id"))
        .and_then(Value::as_i64)
        .expect("outbox should include an id")
}

fn count_operations_with_state(engine: &Engine, state: &str) -> i64 {
    engine
        .conn()
        .expect("connection should be open")
        .query_row(
            "SELECT COUNT(*) FROM sync_operations WHERE remote_apply_state = ?",
            params![state],
            |row| row.get(0),
        )
        .expect("state count should query")
}

fn visible_urls(engine: &Engine, collection_key: &str) -> Vec<String> {
    let connection = engine.conn().expect("connection should be open");
    let mut statement = connection
        .prepare(
            "SELECT video_url
       FROM collection_items
       WHERE collection_key = ?
         AND is_visible = 1
       ORDER BY site_order IS NULL ASC, site_order ASC, last_seen_at DESC, video_url ASC",
        )
        .expect("visible URL query should prepare");

    statement
        .query_map(params![collection_key], |row| row.get::<_, String>(0))
        .expect("visible URL query should run")
        .collect::<std::result::Result<Vec<String>, _>>()
        .expect("visible URLs should collect")
}

fn remove_temp_database(engine: &mut Engine) {
    let path = PathBuf::from(
        engine
            .conn()
            .expect("connection should be open")
            .path()
            .expect("test database should be file-backed"),
    );
    engine.close().expect("engine should close");
    let _ = fs::remove_file(&path);
    let _ = fs::remove_file(path.with_extension("sqlite-wal"));
    let _ = fs::remove_file(path.with_extension("sqlite-shm"));
}

#[test]
fn normalize_video_url_canonicalizes_supported_origins() {
    assert_eq!(
        normalize_video_url(Some(&json!(
            "https://fs1.app/videos/example-video?source=test#fragment"
        ))),
        Some("https://jable.tv/videos/example-video/".to_string())
    );
}

#[test]
fn read_site_order_accepts_runtime_and_export_fields() {
    assert_eq!(read_site_order(&json!({ "siteOrder": "7" })), Some(7));
    assert_eq!(read_site_order(&json!({ "site_order": 8 })), Some(8));
    assert_eq!(read_site_order(&json!({ "sort_order": 9 })), None);
}

#[test]
fn search_text_matches_cjk_ascii_and_phrase_queries() {
    let search_text = build_video_search_text(
        Some("測試 ABC-123"),
        Some("https://jable.tv/videos/abc-123/"),
    );

    assert!(matches_search(&search_text, Some("測試 abc"), "all"));
    assert!(matches_search(&search_text, Some("ABC123"), "phrase"));
    assert!(!matches_search(&search_text, Some("missing"), "all"));
}

#[test]
fn download_assets_are_keyed_by_video_url_and_survive_collection_changes() {
    let mut engine = test_engine("download-assets");

    let ready = engine
        .upsert_download_asset(json!({
            "videoUrl": "https://fs1.app/videos/download-me/?source=contract",
            "title": "Download Me",
            "img": "https://example.test/cover.jpg",
            "preview": "https://example.test/preview.mp4",
            "localPath": "Jable Downloads/download-me.mp4",
            "state": "ready",
            "progress": 1,
            "fileSizeBytes": 2048,
            "error": null,
            "sourcePageChineseSubtitleNotice": true,
            "sourcePageSubtitleNoticeText": "此作品曾在本站上傳，現已更新至中文字幕版。",
            "downloadSource": "playback_auto",
            "completedAt": "2026-05-17T00:00:00.000Z"
        }))
        .expect("download asset should upsert");

    assert_eq!(
        ready.get("videoUrl"),
        Some(&json!("https://jable.tv/videos/download-me/"))
    );
    assert_eq!(ready.get("collectionKey"), None);
    assert_eq!(ready.get("collectionKeys"), Some(&json!([])));
    assert_eq!(ready.get("title"), Some(&json!("Download Me")));
    assert_eq!(
        ready.get("preview"),
        Some(&json!("https://example.test/preview.mp4"))
    );
    assert_eq!(
        ready.get("localPath"),
        Some(&json!("Jable Downloads/download-me.mp4"))
    );
    assert_eq!(ready.get("state"), Some(&json!("ready")));
    assert_eq!(ready.get("progress"), Some(&json!(1.0)));
    assert_eq!(ready.get("playbackAutoResumeBlocked"), Some(&json!(false)));
    assert_eq!(ready.get("fileSizeBytes"), Some(&json!(2048)));
    assert_eq!(
        ready.get("sourcePageChineseSubtitleNotice"),
        Some(&json!(true))
    );
    assert_eq!(
        ready.get("sourcePageSubtitleNoticeText"),
        Some(&json!("此作品曾在本站上傳，現已更新至中文字幕版。"))
    );
    assert_eq!(ready.get("downloadSource"), Some(&json!("playback_auto")));
    assert_eq!(ready.get("failurePhase"), Some(&Value::Null));
    assert_eq!(ready.get("failureCode"), Some(&Value::Null));
    assert_eq!(ready.get("attemptCount"), Some(&json!(0)));
    assert_eq!(ready.get("lastStartedAt"), Some(&Value::Null));
    assert_eq!(ready.get("lastErrorAt"), Some(&Value::Null));
    assert_eq!(
        ready.get("completedAt"),
        Some(&json!("2026-05-17T00:00:00.000Z"))
    );

    let invalid_path = engine.upsert_download_asset(json!({
        "videoUrl": "https://jable.tv/videos/invalid-download-path/",
        "localPath": "/tmp/download-me.mp4",
        "state": "queued"
    }));
    assert!(invalid_path.is_err());
    assert!(invalid_path
        .unwrap_err()
        .to_string()
        .contains("relative to the download root"));

    let traversal_path = engine.upsert_download_asset(json!({
        "videoUrl": "https://jable.tv/videos/traversal-download-path/",
        "localPath": "../download-me.mp4",
        "state": "queued"
    }));
    assert!(traversal_path.is_err());
    assert!(traversal_path
        .unwrap_err()
        .to_string()
        .contains("relative to the download root"));

    let paused = engine
        .upsert_download_asset(json!({
                "videoUrl": "https://jable.tv/videos/paused-download/",
                "localPath": "Jable Downloads/paused-download.mp4",
                "state": "paused",
                "progress": null,
                "playbackAutoResumeBlocked": true,
                "error": "Paused"
        }))
        .expect("paused download asset should upsert");
    assert_eq!(paused.get("state"), Some(&json!("paused")));
    assert_eq!(paused.get("playbackAutoResumeBlocked"), Some(&json!(true)));
    engine
        .remove_download_asset(json!("https://jable.tv/videos/paused-download/"))
        .expect("paused download asset should remove");

    let failed = engine
        .upsert_download_asset(json!({
            "videoUrl": "https://jable.tv/videos/download-me/",
            "state": "failed",
            "progress": null,
            "error": "HTTP 403",
            "failurePhase": "segments",
        "failureCode": "segment_http_403",
        "attemptCount": 2,
        "sourcePageChineseSubtitleNotice": false,
        "sourcePageSubtitleNoticeText": null,
        "downloadSource": "normal",
        "lastStartedAt": "2026-05-17T01:00:00.000Z",
            "lastErrorAt": "2026-05-17T01:01:00.000Z",
            "completedAt": null
        }))
        .expect("download asset should update");

    assert_eq!(failed.get("title"), Some(&json!("Download Me")));
    assert_eq!(
        failed.get("localPath"),
        Some(&json!("Jable Downloads/download-me.mp4"))
    );
    assert_eq!(failed.get("state"), Some(&json!("failed")));
    assert_eq!(failed.get("progress"), Some(&Value::Null));
    assert_eq!(failed.get("error"), Some(&json!("HTTP 403")));
    assert_eq!(failed.get("failurePhase"), Some(&json!("segments")));
    assert_eq!(failed.get("failureCode"), Some(&json!("segment_http_403")));
    assert_eq!(failed.get("attemptCount"), Some(&json!(2)));
    assert_eq!(
        failed.get("sourcePageChineseSubtitleNotice"),
        Some(&json!(false))
    );
    assert_eq!(
        failed.get("sourcePageSubtitleNoticeText"),
        Some(&Value::Null)
    );
    assert_eq!(failed.get("downloadSource"), Some(&json!("normal")));
    assert_eq!(
        failed.get("lastStartedAt"),
        Some(&json!("2026-05-17T01:00:00.000Z"))
    );
    assert_eq!(
        failed.get("lastErrorAt"),
        Some(&json!("2026-05-17T01:01:00.000Z"))
    );
    assert_eq!(failed.get("completedAt"), Some(&Value::Null));

    engine
        .apply_collection_toggle(json!({
            "collectionKey": "favourites",
            "action": "add",
            "video": {
                "title": "Fallback Metadata",
                "url": "https://jable.tv/videos/fallback-download/",
                "img": "https://example.test/fallback.jpg",
                "preview": "https://example.test/fallback-preview.mp4"
            }
        }))
        .expect("fallback collection item should add");
    engine
        .apply_collection_toggle(json!({
            "collectionKey": "favourites",
            "action": "remove",
            "video": {
                "title": "Fallback Metadata",
                "url": "https://jable.tv/videos/fallback-download/"
            }
        }))
        .expect("fallback collection item should remove");
    let fallback = engine
        .upsert_download_asset(json!({
            "videoUrl": "https://jable.tv/videos/fallback-download/",
            "localPath": "Jable Downloads/fallback-download.mp4",
            "state": "ready"
        }))
        .expect("download asset should fall back to video metadata");
    assert_eq!(fallback.get("title"), Some(&json!("Fallback Metadata")));
    assert_eq!(
        fallback.get("preview"),
        Some(&json!("https://example.test/fallback-preview.mp4"))
    );
    assert_eq!(fallback.get("downloadSource"), Some(&json!("normal")));
    engine
        .remove_download_asset(json!("https://jable.tv/videos/fallback-download/"))
        .expect("fallback download asset should remove");

    engine
        .apply_collection_toggle(json!({
            "collectionKey": "favourites",
            "action": "add",
            "video": {
                "title": "Download Me",
                "url": "https://jable.tv/videos/download-me/"
            }
        }))
        .expect("collection item should add");
    assert_eq!(
        visible_urls(&engine, "favourites"),
        vec!["https://jable.tv/videos/download-me/"]
    );
    assert_eq!(
        engine
            .get_download_asset(json!("https://jable.tv/videos/download-me/"))
            .expect("download asset should load")
            .get("collectionKeys"),
        Some(&json!(["favourites"]))
    );

    engine
        .apply_collection_toggle(json!({
            "collectionKey": "watch_later",
            "action": "add",
            "video": {
                "title": "Download Me",
                "url": "https://jable.tv/videos/download-me/"
            }
        }))
        .expect("watch later collection item should add");
    assert_eq!(
        engine
            .get_download_asset(json!("https://jable.tv/videos/download-me/"))
            .expect("download asset should load")
            .get("collectionKeys"),
        Some(&json!(["favourites", "watch_later"]))
    );
    assert_eq!(
        engine
            .list_download_assets()
            .expect("download assets should list")
            .as_array()
            .expect("download assets should be an array")[0]
            .get("collectionKeys"),
        Some(&json!(["favourites", "watch_later"]))
    );

    engine
        .apply_collection_toggle(json!({
            "collectionKey": "favourites",
            "action": "remove",
            "video": {
                "title": "Download Me",
                "url": "https://jable.tv/videos/download-me/"
            }
        }))
        .expect("collection item should remove");
    assert!(visible_urls(&engine, "favourites").is_empty());
    assert_eq!(
        engine
            .get_download_asset(json!("https://jable.tv/videos/download-me/"))
            .expect("download asset should load")
            .get("state"),
        Some(&json!("failed"))
    );
    assert_eq!(
        engine
            .get_download_asset(json!("https://jable.tv/videos/download-me/"))
            .expect("download asset should load")
            .get("collectionKeys"),
        Some(&json!(["watch_later"]))
    );

    assert_eq!(
        engine
            .list_download_assets()
            .expect("download assets should list")
            .as_array()
            .expect("download assets should be an array")
            .len(),
        1
    );
    assert_eq!(
        engine
            .remove_download_asset(json!("https://jable.tv/videos/download-me/"))
            .expect("download asset should remove"),
        json!(true)
    );
    assert_eq!(
        engine
            .remove_download_asset(json!("https://jable.tv/videos/download-me/"))
            .expect("download asset should not remove twice"),
        json!(false)
    );
    assert_eq!(
        engine
            .get_download_asset(json!("https://jable.tv/videos/download-me/"))
            .expect("download asset should load missing"),
        Value::Null
    );

    remove_temp_database(&mut engine);
}

#[test]
fn download_asset_failure_metadata_columns_migrate_existing_database() {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "jable-rust-engine-download-assets-migration-{}-{}.sqlite",
        std::process::id(),
        now_millis()
    ));

    {
        let connection = Connection::open(&path).expect("old database should open");
        connection
            .execute_batch(
                "CREATE TABLE download_assets (
                   video_url TEXT PRIMARY KEY,
                   status TEXT NOT NULL CHECK(status IN ('queued', 'downloading', 'failed', 'ready', 'missing')),
                   file_relative_path TEXT,
                   format TEXT,
                   title TEXT,
                   img TEXT,
                   size_bytes INTEGER,
                   duration_seconds REAL,
                   progress REAL,
                   error TEXT,
                   downloaded_at TEXT,
                   last_checked_at TEXT,
                   created_at TEXT NOT NULL,
                   updated_at TEXT NOT NULL
                 );
                 INSERT INTO download_assets (
                   video_url, status, file_relative_path, title, created_at, updated_at
                 ) VALUES (
                   'https://jable.tv/videos/legacy-download/', 'failed', 'legacy.mp4', 'Legacy Download',
                   '2026-05-17T00:00:00.000Z', '2026-05-17T00:00:00.000Z'
                 );",
            )
            .expect("old download table should create");
    }

    let mut engine =
        Engine::open(path.to_string_lossy().as_ref()).expect("migrated engine should open");
    let connection = engine.conn().expect("connection should be open");
    for column_name in [
        "failure_phase",
        "failure_code",
        "attempt_count",
        "last_started_at",
        "last_error_at",
        "source_page_chinese_subtitle_notice",
        "source_page_subtitle_notice_text",
        "download_source",
        "playback_auto_resume_blocked",
    ] {
        let exists: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('download_assets') WHERE name = ?",
                params![column_name],
                |row| row.get(0),
            )
            .expect("download asset column should query");
        assert_eq!(exists, 1, "{column_name} column should exist");
    }

    let attempt_count: i64 = connection
        .query_row(
            "SELECT attempt_count FROM download_assets WHERE video_url = ?",
            params!["https://jable.tv/videos/legacy-download/"],
            |row| row.get(0),
        )
        .expect("legacy attempt count should query");
    assert_eq!(attempt_count, 0);

    let source_page_chinese_subtitle_notice: i64 = connection
        .query_row(
            "SELECT source_page_chinese_subtitle_notice FROM download_assets WHERE video_url = ?",
            params!["https://jable.tv/videos/legacy-download/"],
            |row| row.get(0),
        )
        .expect("legacy source page notice should query");
    assert_eq!(source_page_chinese_subtitle_notice, 0);

    let download_source: String = connection
        .query_row(
            "SELECT download_source FROM download_assets WHERE video_url = ?",
            params!["https://jable.tv/videos/legacy-download/"],
            |row| row.get(0),
        )
        .expect("legacy download source should query");
    assert_eq!(download_source, "normal");

    let playback_auto_resume_blocked: i64 = connection
        .query_row(
            "SELECT playback_auto_resume_blocked FROM download_assets WHERE video_url = ?",
            params!["https://jable.tv/videos/legacy-download/"],
            |row| row.get(0),
        )
        .expect("legacy playback auto-resume block should query");
    assert_eq!(playback_auto_resume_blocked, 0);

    let legacy = engine
        .get_download_asset(json!("https://jable.tv/videos/legacy-download/"))
        .expect("legacy download asset should load");
    assert_eq!(legacy.get("attemptCount"), Some(&json!(0)));
    assert_eq!(legacy.get("downloadSource"), Some(&json!("normal")));
    assert_eq!(legacy.get("playbackAutoResumeBlocked"), Some(&json!(false)));
    assert_eq!(
        legacy.get("sourcePageChineseSubtitleNotice"),
        Some(&json!(false))
    );
    assert_eq!(
        legacy.get("sourcePageSubtitleNoticeText"),
        Some(&Value::Null)
    );
    assert_eq!(legacy.get("failurePhase"), Some(&Value::Null));
    assert_eq!(legacy.get("failureCode"), Some(&Value::Null));
    assert_eq!(legacy.get("lastStartedAt"), Some(&Value::Null));
    assert_eq!(legacy.get("lastErrorAt"), Some(&Value::Null));

    remove_temp_database(&mut engine);
}

#[test]
fn list_videos_can_filter_to_downloadable_collection_rows() {
    let mut engine = test_engine("downloadable-filter");

    engine
        .save_sync_page(json!({
            "collectionKey": "favourites",
            "page": 1,
            "rows": [
                { "title": "No Record", "url": "https://jable.tv/videos/no-record/", "siteOrder": 1 },
                { "title": "Ready", "url": "https://jable.tv/videos/ready-record/", "siteOrder": 2 },
                { "title": "Queued", "url": "https://jable.tv/videos/queued-record/", "siteOrder": 3 },
                { "title": "Failed", "url": "https://jable.tv/videos/failed-record/", "siteOrder": 4 },
                { "title": "Paused", "url": "https://jable.tv/videos/paused-record/", "siteOrder": 5 },
                { "title": "Missing", "url": "https://jable.tv/videos/missing-record/", "siteOrder": 6 }
            ]
        }))
        .expect("collection rows should save");

    for (slug, state) in [
        ("ready-record", "ready"),
        ("queued-record", "queued"),
        ("failed-record", "failed"),
        ("paused-record", "paused"),
        ("missing-record", "missing"),
    ] {
        engine
            .upsert_download_asset(json!({
                "videoUrl": format!("https://jable.tv/videos/{slug}/"),
                "localPath": format!("{slug}.mp4"),
                "state": state
            }))
            .expect("download asset should upsert");
    }

    let rows = engine
        .list_videos(json!({
            "collectionKey": "favourites",
            "downloadFilter": "downloadable"
        }))
        .expect("downloadable rows should list");
    let downloaded_rows = engine
        .list_videos(json!({
            "collectionKey": "favourites",
            "downloadFilter": "downloaded"
        }))
        .expect("downloaded rows should list");
    let urls: Vec<&str> = rows
        .as_array()
        .expect("rows should be an array")
        .iter()
        .filter_map(|row| row.get("url").and_then(Value::as_str))
        .collect();
    let downloaded_urls: Vec<&str> = downloaded_rows
        .as_array()
        .expect("downloaded rows should be an array")
        .iter()
        .filter_map(|row| row.get("url").and_then(Value::as_str))
        .collect();

    assert_eq!(
        engine
            .count_videos(json!({
                "collectionKey": "favourites",
                "downloadFilter": "downloadable",
                "search": "failed"
            }))
            .expect("downloadable search rows should count"),
        json!(1)
    );
    assert_eq!(
        engine
            .count_videos(json!({
                "collectionKey": "favourites",
                "downloadFilter": "downloadable"
            }))
            .expect("downloadable rows should count"),
        json!(4)
    );
    assert_eq!(
        engine
            .count_videos(json!({
                "collectionKey": "favourites",
                "downloadFilter": "downloaded"
            }))
            .expect("downloaded rows should count"),
        json!(1)
    );
    assert_eq!(
        urls,
        vec![
            "https://jable.tv/videos/no-record/",
            "https://jable.tv/videos/failed-record/",
            "https://jable.tv/videos/paused-record/",
            "https://jable.tv/videos/missing-record/"
        ]
    );
    assert_eq!(
        downloaded_urls,
        vec!["https://jable.tv/videos/ready-record/"]
    );

    remove_temp_database(&mut engine);
}

#[test]
fn refresh_video_metadata_updates_known_collection_rows_only() {
    let mut engine = test_engine("refresh-known-video");

    engine
        .save_sync_page(json!({
            "collectionKey": "favourites",
            "page": 1,
            "rows": [
                {
                    "title": "Old Title",
                    "url": "https://jable.tv/videos/known-refresh/",
                    "views": 1,
                    "likes": 1,
                    "siteOrder": 7
                }
            ]
        }))
        .expect("known row should save");

    let refreshed = engine
        .refresh_video_metadata(json!({
            "title": "Fresh Title",
            "url": "https://fs1.app/videos/known-refresh/?from=browser#ignored",
            "views": 20,
            "likes": 3,
            "img": "https://example.test/fresh.jpg",
            "preview": "https://example.test/fresh.mp4"
        }))
        .expect("known row metadata should refresh");
    assert_eq!(refreshed.get("known"), Some(&json!(true)));
    assert_eq!(refreshed.get("updated"), Some(&json!(true)));
    assert_eq!(
        refreshed.get("url"),
        Some(&json!("https://jable.tv/videos/known-refresh/"))
    );

    let rows = engine
        .list_videos(json!({ "collectionKey": "favourites" }))
        .expect("rows should list");
    let row = rows
        .as_array()
        .and_then(|rows| rows.first())
        .expect("refreshed row should exist");
    assert_eq!(row.get("title"), Some(&json!("Fresh Title")));
    assert_eq!(row.get("views"), Some(&json!(20)));
    assert_eq!(row.get("likes"), Some(&json!(3)));
    assert_eq!(
        row.get("img"),
        Some(&json!("https://example.test/fresh.jpg"))
    );
    assert_eq!(
        row.get("preview"),
        Some(&json!("https://example.test/fresh.mp4"))
    );
    assert_eq!(row.get("site_order"), Some(&json!(7)));

    let unknown = engine
        .refresh_video_metadata(json!({
            "title": "Unknown Title",
            "url": "https://jable.tv/videos/unknown-refresh/"
        }))
        .expect("unknown row should be ignored");
    assert_eq!(unknown.get("known"), Some(&json!(false)));
    assert_eq!(unknown.get("updated"), Some(&json!(false)));
    assert_eq!(visible_urls(&engine, "favourites").len(), 1);

    remove_temp_database(&mut engine);
}

#[test]
fn upsert_video_metadata_does_not_create_collection_rows() {
    let mut engine = test_engine("upsert-video-metadata");

    let result = engine
        .upsert_video_metadata(json!({
            "title": "Playback Download",
            "url": "https://fs1.app/videos/playback-download/?from=browser#ignored",
            "views": 20,
            "likes": 3,
            "img": "https://example.test/playback.jpg",
            "preview": "https://example.test/playback.mp4"
        }))
        .expect("metadata should upsert");
    assert_eq!(result.get("updated"), Some(&json!(true)));
    assert_eq!(
        result.get("url"),
        Some(&json!("https://jable.tv/videos/playback-download/"))
    );
    assert!(visible_urls(&engine, "favourites").is_empty());
    assert!(visible_urls(&engine, "watch_later").is_empty());

    let count = engine
        .conn()
        .expect("connection should be open")
        .query_row(
            "SELECT COUNT(*) FROM videos WHERE url = ? AND title = ?",
            params![
                "https://jable.tv/videos/playback-download/",
                "Playback Download"
            ],
            |row| row.get::<_, i64>(0),
        )
        .expect("video row should query");
    assert_eq!(count, 1);

    remove_temp_database(&mut engine);
}

#[test]
fn applied_deferred_local_operations_reconcile_after_finish_sync() {
    let mut engine = test_engine("defer-local-applied");

    engine
        .save_sync_page(json!({
            "collectionKey": "favourites",
            "mode": "full",
            "syncRunId": "applied-run",
            "page": 1,
            "url": "https://jable.tv/my/favourites/videos/",
            "rows": [
                {
                    "title": "Alpha",
                    "url": "https://jable.tv/videos/alpha/",
                    "siteOrder": 1
                }
            ]
        }))
        .expect("sync page should save");
    engine
        .apply_collection_toggle(json!({
            "collectionKey": "favourites",
            "action": "add",
            "syncRunId": "applied-run",
            "deferRemote": true,
            "deferLocal": true,
            "remoteVideoId": "40",
            "remoteFavType": "0",
            "video": {
                "title": "Delta",
                "url": "https://jable.tv/videos/delta/"
            }
        }))
        .expect("add should queue without local apply");
    assert_eq!(
        visible_urls(&engine, "favourites"),
        vec!["https://jable.tv/videos/alpha/"]
    );

    let operation_id = first_outbox_id(&engine, "favourites");
    assert_eq!(
        engine
            .mark_deferred_sync_operations_applied(json!({
                "collectionKey": "favourites",
                "ids": [operation_id]
            }))
            .expect("operation should mark applied"),
        json!(1)
    );
    engine
        .finish_sync(json!({
            "collectionKey": "favourites",
            "mode": "full",
            "syncRunId": "applied-run",
            "result": {
                "completed": true,
                "mode": "full",
                "syncRunId": "applied-run",
                "incompleteReason": null,
                "stoppedByKnownPage": false,
                "totalPages": 1,
                "totalRows": 1,
                "lastScrapedPage": 1,
                "lastKnownUrl": "https://jable.tv/videos/alpha/",
                "queuedOperationsApplied": 1
            }
        }))
        .expect("finish should reconcile applied deferred operation");
    assert_eq!(
        visible_urls(&engine, "favourites"),
        vec![
            "https://jable.tv/videos/delta/".to_string(),
            "https://jable.tv/videos/alpha/".to_string()
        ]
    );

    remove_temp_database(&mut engine);
}

#[test]
fn deferred_local_operations_wait_for_remote_resolution() {
    let mut engine = test_engine("defer-local-resolution");

    engine
        .save_sync_page(json!({
            "collectionKey": "favourites",
            "mode": "full",
            "syncRunId": "defer-local-remove",
            "page": 1,
            "url": "https://jable.tv/my/favourites/videos/",
            "rows": [
                {
                    "title": "Keep Local",
                    "url": "https://jable.tv/videos/keep-local/",
                    "siteOrder": 1
                }
            ]
        }))
        .expect("sync page should save");

    let remove_result = engine
        .apply_collection_toggle(json!({
            "collectionKey": "favourites",
            "action": "remove",
            "syncRunId": "defer-local-remove",
            "deferRemote": true,
            "deferLocal": true,
            "remoteVideoId": "30",
            "remoteFavType": "0",
            "video": {
                "title": "Keep Local",
                "url": "https://jable.tv/videos/keep-local/"
            }
        }))
        .expect("remove should queue without local apply");
    assert_eq!(remove_result.get("queued"), Some(&json!(true)));
    assert_eq!(remove_result.get("changed"), Some(&json!(false)));
    assert_eq!(remove_result.get("visible"), Some(&json!(true)));
    assert_eq!(
        visible_urls(&engine, "favourites"),
        vec!["https://jable.tv/videos/keep-local/"]
    );

    let remove_state = engine
        .finish_sync(json!({
            "collectionKey": "favourites",
            "mode": "full",
            "syncRunId": "defer-local-remove",
            "result": {
                "completed": true,
                "mode": "full",
                "syncRunId": "defer-local-remove",
                "incompleteReason": null,
                "stoppedByKnownPage": false,
                "totalPages": 1,
                "totalRows": 1,
                "lastScrapedPage": 1,
                "lastKnownUrl": "https://jable.tv/videos/keep-local/",
                "queuedOperationsSkipped": 1
            }
        }))
        .expect("finish should skip local deferred operation");
    assert_eq!(remove_state.get("mutationsReconciled"), Some(&json!(1)));
    assert_eq!(
        visible_urls(&engine, "favourites"),
        vec!["https://jable.tv/videos/keep-local/"]
    );

    let groups = engine
        .list_pending_remote_operation_groups()
        .expect("pending groups should list")
        .as_array()
        .cloned()
        .expect("pending groups should be an array");
    assert_eq!(groups.len(), 1);
    assert_eq!(
        engine
            .mark_pending_remote_operation_group_resolved(
                json!({ "groupId": group_id(&groups[0]) })
            )
            .expect("remove group should resolve"),
        json!(true)
    );
    assert_eq!(
        visible_urls(&engine, "favourites"),
        vec!["https://jable.tv/videos/keep-local/"]
    );

    engine
        .apply_collection_toggle(json!({
            "collectionKey": "favourites",
            "action": "remove",
            "syncRunId": "defer-local-remove-success",
            "deferRemote": true,
            "deferLocal": true,
            "remoteVideoId": "30",
            "remoteFavType": "0",
            "video": {
                "title": "Keep Local",
                "url": "https://jable.tv/videos/keep-local/"
            }
        }))
        .expect("remove should queue again without local apply");
    engine
        .finish_sync(json!({
            "collectionKey": "favourites",
            "mode": "full",
            "syncRunId": "defer-local-remove-success",
            "result": {
                "completed": true,
                "mode": "full",
                "syncRunId": "defer-local-remove-success",
                "incompleteReason": null,
                "stoppedByKnownPage": false,
                "totalPages": 1,
                "totalRows": 1,
                "lastScrapedPage": 1,
                "lastKnownUrl": "https://jable.tv/videos/keep-local/",
                "queuedOperationsSkipped": 1
            }
        }))
        .expect("finish should keep pending remove out of local list");
    let groups = engine
        .list_pending_remote_operation_groups()
        .expect("pending groups should list")
        .as_array()
        .cloned()
        .expect("pending groups should be an array");
    let remove_group = groups
        .iter()
        .find(|group| group.get("videoUrl") == Some(&json!("https://jable.tv/videos/keep-local/")))
        .expect("remove group should remain pending");
    assert_eq!(
        engine
            .mark_pending_remote_operation_group_removed(
                json!({ "groupId": group_id(remove_group) })
            )
            .expect("remove group should hide locally"),
        json!(true)
    );
    assert!(visible_urls(&engine, "favourites").is_empty());

    let add_result = engine
        .apply_collection_toggle(json!({
            "collectionKey": "watch_later",
            "action": "add",
            "syncRunId": "defer-local-add",
            "deferRemote": true,
            "deferLocal": true,
            "remoteVideoId": "31",
            "remoteFavType": "1",
            "video": {
                "title": "Add Later",
                "url": "https://jable.tv/videos/add-later/"
            }
        }))
        .expect("add should queue without local apply");
    assert_eq!(add_result.get("queued"), Some(&json!(true)));
    assert_eq!(add_result.get("changed"), Some(&json!(false)));
    assert_eq!(add_result.get("visible"), Some(&json!(false)));
    assert!(visible_urls(&engine, "watch_later").is_empty());

    engine
        .finish_sync(json!({
            "collectionKey": "watch_later",
            "mode": "full",
            "syncRunId": "defer-local-add",
            "result": {
                "completed": true,
                "mode": "full",
                "syncRunId": "defer-local-add",
                "incompleteReason": null,
                "stoppedByKnownPage": false,
                "totalPages": 1,
                "totalRows": 0,
                "lastScrapedPage": 1,
                "lastKnownUrl": null,
                "queuedOperationsSkipped": 1
            }
        }))
        .expect("finish should keep pending add out of local list");
    assert!(visible_urls(&engine, "watch_later").is_empty());

    let groups = engine
        .list_pending_remote_operation_groups()
        .expect("pending groups should list")
        .as_array()
        .cloned()
        .expect("pending groups should be an array");
    let add_group = groups
        .iter()
        .find(|group| group.get("videoUrl") == Some(&json!("https://jable.tv/videos/add-later/")))
        .expect("add group should remain pending");
    assert_eq!(
        engine
            .mark_pending_remote_operation_group_added(json!({ "groupId": group_id(add_group) }))
            .expect("add group should add"),
        json!(true)
    );
    assert_eq!(
        visible_urls(&engine, "watch_later"),
        vec!["https://jable.tv/videos/add-later/"]
    );

    remove_temp_database(&mut engine);
}

#[test]
fn pending_remote_groups_keep_sequence_and_resolve_as_a_group() {
    let mut engine = test_engine("pending-final-intent");

    for action in ["add", "remove", "add"] {
        engine
            .apply_collection_toggle(json!({
                "collectionKey": "watch_later",
                "action": action,
                "syncRunId": "active-run",
                "deferRemote": true,
                "remoteVideoId": "10",
                "remoteFavType": "1",
                "video": {
                    "title": "Flip",
                    "url": "https://jable.tv/videos/flip/"
                }
            }))
            .expect("collection toggle should queue");
    }

    let first_id = first_outbox_id(&engine, "watch_later");
    assert_eq!(
        engine
            .mark_deferred_sync_operation_failed(json!({
                "collectionKey": "watch_later",
                "id": first_id,
                "message": "HTTP 500"
            }))
            .expect("operation should mark failed"),
        json!(true)
    );

    let groups = engine
        .list_pending_remote_operation_groups()
        .expect("pending groups should list")
        .as_array()
        .cloned()
        .expect("pending groups should be an array");
    assert_eq!(groups.len(), 1);

    let group = &groups[0];
    assert_eq!(group.get("collectionKey"), Some(&json!("watch_later")));
    assert_eq!(
        group.get("videoUrl"),
        Some(&json!("https://jable.tv/videos/flip/"))
    );
    assert_eq!(group.get("state"), Some(&json!("failed")));
    assert_eq!(group.get("error"), Some(&json!("HTTP 500")));
    assert_eq!(group.get("operationCount"), Some(&json!(3)));

    let sequence = group
        .get("sequence")
        .and_then(Value::as_array)
        .expect("group should include sequence");
    assert_eq!(sequence[0].get("action"), Some(&json!("add")));
    assert_eq!(sequence[0].get("state"), Some(&json!("failed")));
    assert_eq!(sequence[1].get("action"), Some(&json!("remove")));
    assert_eq!(sequence[1].get("state"), Some(&json!("blocked")));
    assert_eq!(sequence[2].get("action"), Some(&json!("add")));
    assert_eq!(sequence[2].get("state"), Some(&json!("blocked")));

    let retry = engine
        .prepare_pending_remote_operation_retry(json!({ "groupId": group_id(group) }))
        .expect("retry operation should prepare");
    assert_eq!(retry.get("remoteVideoId"), Some(&json!("10")));
    assert_eq!(retry.get("remoteFavType"), Some(&json!("1")));

    assert_eq!(
        engine
            .mark_pending_remote_operation_group_resolved(json!({ "groupId": group_id(group) }))
            .expect("group should resolve"),
        json!(true)
    );
    assert_eq!(
        engine
            .list_pending_remote_operation_groups()
            .expect("pending groups should list"),
        json!([])
    );
    assert_eq!(count_operations_with_state(&engine, "resolved"), 3);

    remove_temp_database(&mut engine);
}

#[test]
fn full_sync_supersedes_old_failed_and_blocked_remote_groups() {
    let mut engine = test_engine("pending-superseded");

    for action in ["add", "remove"] {
        engine
            .apply_collection_toggle(json!({
                "collectionKey": "favourites",
                "action": action,
                "syncRunId": "old-run",
                "deferRemote": true,
                "remoteVideoId": "20",
                "remoteFavType": "0",
                "video": {
                    "title": "Superseded",
                    "url": "https://jable.tv/videos/superseded/"
                }
            }))
            .expect("collection toggle should queue");
    }

    let first_id = first_outbox_id(&engine, "favourites");
    engine
        .mark_deferred_sync_operation_failed(json!({
            "collectionKey": "favourites",
            "id": first_id,
            "message": "Temporary failure"
        }))
        .expect("operation should mark failed");
    engine
        .apply_collection_toggle(json!({
            "collectionKey": "favourites",
            "action": "add",
            "syncRunId": "older-pending-run",
            "deferRemote": true,
            "remoteVideoId": "21",
            "remoteFavType": "0",
            "video": {
                "title": "Old Pending",
                "url": "https://jable.tv/videos/old-pending/"
            }
        }))
        .expect("old pending operation should queue");
    assert_eq!(
        engine
            .list_pending_remote_operation_groups()
            .expect("pending groups should list")
            .as_array()
            .expect("pending groups should be an array")
            .len(),
        2
    );

    engine
        .finish_sync(json!({
            "collectionKey": "favourites",
            "mode": "full",
            "syncRunId": "clean-full-run",
            "result": {
                "completed": true,
                "mode": "full",
                "syncRunId": "clean-full-run",
                "incompleteReason": null,
                "stoppedByKnownPage": false,
                "totalPages": 1,
                "totalRows": 0,
                "lastScrapedPage": 1,
                "lastKnownUrl": null,
                "queuedOperationsFailed": 0
            }
        }))
        .expect("clean full sync should finish");

    assert_eq!(
        engine
            .list_pending_remote_operation_groups()
            .expect("pending groups should list"),
        json!([])
    );
    assert_eq!(count_operations_with_state(&engine, "superseded"), 3);

    remove_temp_database(&mut engine);
}
