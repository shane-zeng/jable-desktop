use serde_json::Value;
use url::Url;

use crate::collections::PRIMARY_ORIGIN;
use crate::search::build_video_search_text;

#[derive(Clone)]
pub(crate) struct NormalizedVideo {
    pub(crate) url: String,
    pub(crate) title: Option<String>,
    pub(crate) views: Option<i64>,
    pub(crate) likes: Option<i64>,
    pub(crate) img: Option<String>,
    pub(crate) preview: Option<String>,
    pub(crate) site_order: Option<i64>,
    pub(crate) search_text: String,
}

pub(crate) fn value_string(value: Option<&Value>) -> Option<String> {
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

pub(crate) fn value_i64(value: Option<&Value>) -> Option<i64> {
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

pub(crate) fn value_bool(value: Option<&Value>) -> bool {
    matches!(value, Some(Value::Bool(true)))
}

pub(crate) fn object_field<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    value.as_object().and_then(|object| object.get(key))
}

pub(crate) fn normalize_video_url(value: Option<&Value>) -> Option<String> {
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

pub(crate) fn read_site_order(value: &Value) -> Option<i64> {
    value_i64(object_field(value, "siteOrder"))
        .or_else(|| value_i64(object_field(value, "site_order")))
}

pub(crate) fn normalize_video(value: &Value) -> Option<NormalizedVideo> {
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
