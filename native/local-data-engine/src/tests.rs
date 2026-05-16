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
fn read_site_order_accepts_desktop_and_legacy_fields() {
    assert_eq!(read_site_order(&json!({ "siteOrder": "7" })), Some(7));
    assert_eq!(read_site_order(&json!({ "site_order": 8 })), Some(8));
    assert_eq!(read_site_order(&json!({ "sort_order": 9 })), Some(9));
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
            "collectionKey": "favourites",
            "title": "Download Me",
            "img": "https://example.test/cover.jpg",
            "localPath": "Jable Downloads/download-me.mp4",
            "state": "ready",
            "progress": 1,
            "fileSizeBytes": 2048,
            "error": null,
            "completedAt": "2026-05-17T00:00:00.000Z"
        }))
        .expect("download asset should upsert");

    assert_eq!(
        ready.get("videoUrl"),
        Some(&json!("https://jable.tv/videos/download-me/"))
    );
    assert_eq!(ready.get("collectionKey"), Some(&json!("favourites")));
    assert_eq!(ready.get("collectionKeys"), Some(&json!([])));
    assert_eq!(ready.get("title"), Some(&json!("Download Me")));
    assert_eq!(
        ready.get("localPath"),
        Some(&json!("Jable Downloads/download-me.mp4"))
    );
    assert_eq!(ready.get("state"), Some(&json!("ready")));
    assert_eq!(ready.get("progress"), Some(&json!(1.0)));
    assert_eq!(ready.get("fileSizeBytes"), Some(&json!(2048)));
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

    let failed = engine
        .upsert_download_asset(json!({
            "videoUrl": "https://jable.tv/videos/download-me/",
            "state": "failed",
            "progress": null,
            "error": "HTTP 403",
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
    assert_eq!(failed.get("completedAt"), Some(&Value::Null));

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
