use super::*;
use serde_json::json;

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
