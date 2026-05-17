use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HlsKey {
    pub(crate) method: String,
    pub(crate) uri: Option<String>,
    pub(crate) iv: Option<String>,
}

#[derive(Clone, Deserialize)]
pub(crate) struct HlsSegment {
    pub(crate) url: String,
    pub(crate) duration: Option<f64>,
    pub(crate) key: Option<HlsKey>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadRequest {
    pub(crate) download_id: String,
    pub(crate) temp_dir: String,
    pub(crate) headers: HashMap<String, String>,
    pub(crate) concurrency: Option<usize>,
    pub(crate) min_concurrency: Option<usize>,
    pub(crate) max_concurrency: Option<usize>,
    pub(crate) sample_segment_count: Option<usize>,
    pub(crate) retry_limit: Option<usize>,
    pub(crate) target_duration: Option<f64>,
    pub(crate) segments: Vec<HlsSegment>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    pub(crate) playlist_path: String,
    pub(crate) downloaded_bytes: u64,
}
