use napi::bindgen_prelude::*;
use napi_derive::napi;
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const CHUNK_SIZE: usize = 64 * 1024;
const DEFAULT_SEGMENT_MIN_CONCURRENCY: usize = 8;
const DEFAULT_SEGMENT_MAX_CONCURRENCY: usize = 32;
const DEFAULT_SAMPLE_SEGMENT_COUNT: usize = 3;
const ADAPTIVE_CONCURRENCY_TARGET_BYTES_PER_SECOND: f64 = 32.0 * 1024.0 * 1024.0;
const CONCURRENCY_REJECTION_BACKOFF_MS: u64 = 1000;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HlsKey {
    method: String,
    uri: Option<String>,
    iv: Option<String>,
}

#[derive(Clone, Deserialize)]
struct HlsSegment {
    url: String,
    duration: Option<f64>,
    key: Option<HlsKey>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DownloadRequest {
    download_id: String,
    temp_dir: String,
    headers: HashMap<String, String>,
    concurrency: Option<usize>,
    min_concurrency: Option<usize>,
    max_concurrency: Option<usize>,
    sample_segment_count: Option<usize>,
    retry_limit: Option<usize>,
    target_duration: Option<f64>,
    segments: Vec<HlsSegment>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadResult {
    playlist_path: String,
    downloaded_bytes: u64,
}

struct DownloadPlan {
    min_concurrency: usize,
    max_concurrency: usize,
    sample_segment_count: usize,
}

struct SegmentSample {
    downloaded_bytes: u64,
    elapsed: Duration,
    count: usize,
}

struct SegmentDownloadConfig {
    concurrency: usize,
    start_index: usize,
    initial_downloaded_bytes: u64,
    retry_limit: usize,
}

type CancelMap = Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>;

#[napi]
pub struct JableDownloadEngine {
    cancellations: CancelMap,
}

impl Default for JableDownloadEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[napi]
impl JableDownloadEngine {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            cancellations: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    #[napi(js_name = "downloadHlsSegments")]
    pub fn download_hls_segments(
        &self,
        payload: String,
    ) -> Result<AsyncTask<DownloadSegmentsTask>> {
        let request: DownloadRequest = serde_json::from_str(&payload).map_err(to_napi_error)?;
        if request.download_id.trim().is_empty() {
            return Err(Error::from_reason("downloadId is required".to_string()));
        }
        if request.segments.is_empty() {
            return Err(Error::from_reason("segments are required".to_string()));
        }

        let cancel_flag = Arc::new(AtomicBool::new(false));
        self.cancellations
            .lock()
            .map_err(to_napi_error)?
            .insert(request.download_id.clone(), Arc::clone(&cancel_flag));

        Ok(AsyncTask::new(DownloadSegmentsTask {
            request,
            cancellations: Arc::clone(&self.cancellations),
            cancel_flag,
        }))
    }

    #[napi(js_name = "cancelDownload")]
    pub fn cancel_download(&self, download_id: String) -> Result<bool> {
        let cancellations = self.cancellations.lock().map_err(to_napi_error)?;
        if let Some(cancel_flag) = cancellations.get(&download_id) {
            cancel_flag.store(true, Ordering::SeqCst);
            return Ok(true);
        }
        Ok(false)
    }

    #[napi(js_name = "engineVersion")]
    pub fn engine_version(&self) -> String {
        "rust-download-native".to_string()
    }
}

pub struct DownloadSegmentsTask {
    request: DownloadRequest,
    cancellations: CancelMap,
    cancel_flag: Arc<AtomicBool>,
}

impl Task for DownloadSegmentsTask {
    type Output = DownloadResult;
    type JsValue = String;

    fn compute(&mut self) -> Result<Self::Output> {
        let result = download_hls_segments(&self.request, Arc::clone(&self.cancel_flag));
        if let Ok(mut cancellations) = self.cancellations.lock() {
            cancellations.remove(&self.request.download_id);
        }
        result
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        serde_json::to_string(&output).map_err(to_napi_error)
    }
}

fn to_napi_error(error: impl std::fmt::Display) -> Error {
    Error::from_reason(error.to_string())
}

fn canceled_error() -> Error {
    Error::from_reason("download canceled".to_string())
}

fn ensure_not_canceled(cancel_flag: &AtomicBool) -> Result<()> {
    if cancel_flag.load(Ordering::SeqCst) {
        return Err(canceled_error());
    }
    Ok(())
}

fn header_map(headers: &HashMap<String, String>) -> Result<HeaderMap> {
    let mut header_map = HeaderMap::new();
    for (name, value) in headers {
        let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(to_napi_error)?;
        let header_value = HeaderValue::from_str(value).map_err(to_napi_error)?;
        header_map.insert(header_name, header_value);
    }
    Ok(header_map)
}

fn segment_extension(url: &str) -> &str {
    let without_query = url.split('?').next().unwrap_or(url);
    let file_name = without_query.rsplit('/').next().unwrap_or("");
    let extension = file_name.rsplit_once('.').map(|(_, extension)| extension);
    match extension {
        Some("aac") => ".aac",
        Some("m4s") => ".m4s",
        Some("mp4") => ".mp4",
        Some("ts") => ".ts",
        _ => ".ts",
    }
}

fn local_segment_file_name(index: usize, url: &str) -> String {
    format!(
        "segment-{index:06}{}",
        segment_extension(url),
        index = index + 1
    )
}

fn local_key_file_name(index: usize) -> String {
    format!("key-{index:06}.key", index = index + 1)
}

fn hls_duration_value(value: Option<f64>) -> String {
    match value {
        Some(duration) if duration.is_finite() && duration >= 0.0 => duration.to_string(),
        _ => "0".to_string(),
    }
}

fn build_local_playlist(
    segments: &[HlsSegment],
    key_file_names: &HashMap<String, String>,
    target_duration: Option<f64>,
) -> String {
    let target_duration = target_duration
        .filter(|duration| duration.is_finite() && *duration > 0.0)
        .map(|duration| duration.ceil() as i64)
        .unwrap_or(10);
    let mut lines = vec![
        "#EXTM3U".to_string(),
        "#EXT-X-VERSION:3".to_string(),
        format!("#EXT-X-TARGETDURATION:{target_duration}"),
        "#EXT-X-MEDIA-SEQUENCE:0".to_string(),
    ];
    let mut previous_key = String::new();

    for (index, segment) in segments.iter().enumerate() {
        let key = segment
            .key
            .as_ref()
            .and_then(|key| key.uri.as_ref().map(|uri| (key, uri)))
            .and_then(|(key, uri)| {
                key_file_names
                    .get(uri)
                    .map(|file_name| (key, file_name.as_str()))
            });
        let key_signature = key
            .map(|(key, file_name)| {
                format!(
                    "{}|{}|{}",
                    key.method,
                    file_name,
                    key.iv.clone().unwrap_or_default()
                )
            })
            .unwrap_or_default();

        if key_signature != previous_key {
            if let Some((key, file_name)) = key {
                let mut key_line =
                    format!("#EXT-X-KEY:METHOD={},URI=\"{}\"", key.method, file_name);
                if let Some(iv) = &key.iv {
                    key_line.push_str(",IV=");
                    key_line.push_str(iv);
                }
                lines.push(key_line);
            } else if !previous_key.is_empty() {
                lines.push("#EXT-X-KEY:METHOD=NONE".to_string());
            }
            previous_key = key_signature;
        }

        lines.push(format!("#EXTINF:{},", hls_duration_value(segment.duration)));
        lines.push(local_segment_file_name(index, &segment.url));
    }

    lines.push("#EXT-X-ENDLIST".to_string());
    lines.push(String::new());
    lines.join("\n")
}

fn fetch_to_file(
    client: &Client,
    url: &str,
    headers: &HeaderMap,
    output_path: &Path,
    cancel_flag: &AtomicBool,
) -> Result<u64> {
    ensure_not_canceled(cancel_flag)?;
    let mut response = client
        .get(url)
        .headers(headers.clone())
        .send()
        .map_err(to_napi_error)?;
    if !response.status().is_success() {
        return Err(Error::from_reason(format!("HTTP {}", response.status())));
    }

    let partial_path = output_path.with_extension(format!(
        "{}part",
        output_path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| format!("{extension}."))
            .unwrap_or_default()
    ));
    let mut file = fs::File::create(&partial_path).map_err(to_napi_error)?;
    let mut buffer = [0_u8; CHUNK_SIZE];
    let mut downloaded = 0_u64;

    loop {
        ensure_not_canceled(cancel_flag)?;
        let read = response.read(&mut buffer).map_err(to_napi_error)?;
        if read == 0 {
            break;
        }
        std::io::Write::write_all(&mut file, &buffer[..read]).map_err(to_napi_error)?;
        downloaded += read as u64;
    }

    drop(file);
    fs::rename(partial_path, output_path).map_err(to_napi_error)?;
    Ok(downloaded)
}

fn fetch_with_retry(
    client: &Client,
    url: &str,
    headers: &HeaderMap,
    output_path: &Path,
    retry_limit: usize,
    cancel_flag: &AtomicBool,
) -> Result<u64> {
    let mut last_error = None;

    for attempt in 1..=retry_limit {
        ensure_not_canceled(cancel_flag)?;
        match fetch_to_file(client, url, headers, output_path, cancel_flag) {
            Ok(downloaded) => return Ok(downloaded),
            Err(error) => {
                if cancel_flag.load(Ordering::SeqCst) {
                    return Err(canceled_error());
                }
                last_error = Some(error);
                if attempt < retry_limit {
                    thread::sleep(Duration::from_millis((attempt as u64) * 500));
                }
            }
        }
    }

    Err(last_error.unwrap_or_else(|| Error::from_reason("download failed".to_string())))
}

fn is_concurrency_rejection_error(message: &str) -> bool {
    message.contains("HTTP 403")
        || message.contains("HTTP 428")
        || message.contains("HTTP 429")
        || message.contains("HTTP 503")
        || message.contains("HTTP 504")
}

fn next_concurrency_after_rejection(current: usize) -> Option<usize> {
    if current <= 1 {
        return None;
    }
    Some((current / 2).max(1))
}

fn key_file_names(segments: &[HlsSegment]) -> Result<HashMap<String, String>> {
    let mut key_file_names = HashMap::new();
    for segment in segments {
        if let Some(key) = &segment.key {
            if key.method != "AES-128" || key.uri.is_none() {
                return Err(Error::from_reason(format!(
                    "unsupported HLS key method: {}",
                    key.method
                )));
            }
            let uri = key.uri.as_ref().expect("checked above");
            if !key_file_names.contains_key(uri) {
                key_file_names.insert(uri.clone(), local_key_file_name(key_file_names.len()));
            }
        }
    }
    Ok(key_file_names)
}

fn download_keys(
    client: &Client,
    headers: &HeaderMap,
    temp_dir: &Path,
    key_file_names: &HashMap<String, String>,
    retry_limit: usize,
    cancel_flag: &AtomicBool,
) -> Result<()> {
    for (url, file_name) in key_file_names {
        let output_path = temp_dir.join(file_name);
        fetch_with_retry(client, url, headers, &output_path, retry_limit, cancel_flag)?;
    }
    Ok(())
}

fn download_plan(request: &DownloadRequest, segment_count: usize) -> DownloadPlan {
    let fixed_concurrency = request
        .concurrency
        .unwrap_or(DEFAULT_SEGMENT_MIN_CONCURRENCY)
        .max(1);
    let min_concurrency = request.min_concurrency.unwrap_or(fixed_concurrency).max(1);
    let max_concurrency = request
        .max_concurrency
        .unwrap_or_else(|| {
            if request.min_concurrency.is_some() {
                DEFAULT_SEGMENT_MAX_CONCURRENCY
            } else {
                fixed_concurrency
            }
        })
        .max(min_concurrency)
        .max(1);
    let sample_segment_count = if max_concurrency > min_concurrency {
        request
            .sample_segment_count
            .unwrap_or(DEFAULT_SAMPLE_SEGMENT_COUNT)
            .min(segment_count)
    } else {
        0
    };

    DownloadPlan {
        min_concurrency,
        max_concurrency,
        sample_segment_count,
    }
}

fn adaptive_concurrency(
    min_concurrency: usize,
    max_concurrency: usize,
    sampled_bytes: u64,
    elapsed: Duration,
) -> usize {
    if max_concurrency <= min_concurrency || sampled_bytes == 0 {
        return min_concurrency;
    }

    let elapsed_seconds = elapsed.as_secs_f64();
    if !elapsed_seconds.is_finite() || elapsed_seconds <= 0.0 {
        return min_concurrency;
    }

    let sampled_bytes_per_second = sampled_bytes as f64 / elapsed_seconds;
    if !sampled_bytes_per_second.is_finite() || sampled_bytes_per_second <= 0.0 {
        return min_concurrency;
    }

    let concurrency =
        (ADAPTIVE_CONCURRENCY_TARGET_BYTES_PER_SECOND / sampled_bytes_per_second).ceil() as usize;
    concurrency.clamp(min_concurrency, max_concurrency)
}

fn sample_segments(
    client: &Client,
    headers: &HeaderMap,
    temp_dir: &Path,
    segments: &[HlsSegment],
    sample_segment_count: usize,
    retry_limit: usize,
    cancel_flag: &AtomicBool,
) -> Result<SegmentSample> {
    let started_at = Instant::now();
    let mut downloaded_bytes = 0_u64;

    for (index, segment) in segments.iter().take(sample_segment_count).enumerate() {
        let output_path = temp_dir.join(local_segment_file_name(index, &segment.url));
        downloaded_bytes += fetch_with_retry(
            client,
            &segment.url,
            headers,
            &output_path,
            retry_limit,
            cancel_flag,
        )?;
    }

    Ok(SegmentSample {
        downloaded_bytes,
        elapsed: started_at.elapsed(),
        count: sample_segment_count,
    })
}

fn download_segments(
    client: Client,
    headers: HeaderMap,
    temp_dir: PathBuf,
    segments: Vec<HlsSegment>,
    config: SegmentDownloadConfig,
    cancel_flag: Arc<AtomicBool>,
) -> Result<u64> {
    let remaining_count = segments.len().saturating_sub(config.start_index);
    if remaining_count == 0 {
        return Ok(config.initial_downloaded_bytes);
    }

    let segments = Arc::new(segments);
    let next_index = Arc::new(AtomicUsize::new(config.start_index));
    let downloaded_bytes = Arc::new(AtomicU64::new(config.initial_downloaded_bytes));
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));
    let stop_flag = Arc::new(AtomicBool::new(false));
    let worker_count = config.concurrency.max(1).min(remaining_count);
    let retry_limit = config.retry_limit;
    let mut handles = Vec::with_capacity(worker_count);

    for _ in 0..worker_count {
        let client = client.clone();
        let headers = headers.clone();
        let temp_dir = temp_dir.clone();
        let segments = Arc::clone(&segments);
        let next_index = Arc::clone(&next_index);
        let downloaded_bytes = Arc::clone(&downloaded_bytes);
        let errors = Arc::clone(&errors);
        let stop_flag = Arc::clone(&stop_flag);
        let cancel_flag = Arc::clone(&cancel_flag);

        handles.push(thread::spawn(move || loop {
            if cancel_flag.load(Ordering::SeqCst) || stop_flag.load(Ordering::SeqCst) {
                break;
            }
            if !errors
                .lock()
                .map(|errors| errors.is_empty())
                .unwrap_or(false)
            {
                break;
            }

            let index = next_index.fetch_add(1, Ordering::SeqCst);
            if index >= segments.len() {
                break;
            }

            let segment = &segments[index];
            let output_path = temp_dir.join(local_segment_file_name(index, &segment.url));
            if let Ok(metadata) = fs::metadata(&output_path) {
                if metadata.is_file() {
                    downloaded_bytes.fetch_add(metadata.len(), Ordering::SeqCst);
                    continue;
                }
            }
            match fetch_with_retry(
                &client,
                &segment.url,
                &headers,
                &output_path,
                retry_limit,
                &cancel_flag,
            ) {
                Ok(downloaded) => {
                    downloaded_bytes.fetch_add(downloaded, Ordering::SeqCst);
                }
                Err(error) => {
                    stop_flag.store(true, Ordering::SeqCst);
                    if let Ok(mut errors) = errors.lock() {
                        errors.push(error.to_string());
                    }
                    break;
                }
            }
        }));
    }

    for handle in handles {
        handle
            .join()
            .map_err(|_| Error::from_reason("download worker panicked".to_string()))?;
    }

    if cancel_flag.load(Ordering::SeqCst) {
        return Err(canceled_error());
    }
    let errors = errors.lock().map_err(to_napi_error)?;
    if let Some(error) = errors.first() {
        return Err(Error::from_reason(error.clone()));
    }

    Ok(downloaded_bytes.load(Ordering::SeqCst))
}

fn download_segments_with_concurrency_fallback(
    client: Client,
    headers: HeaderMap,
    temp_dir: PathBuf,
    segments: Vec<HlsSegment>,
    config: SegmentDownloadConfig,
    cancel_flag: Arc<AtomicBool>,
) -> Result<u64> {
    let mut concurrency = config.concurrency.max(1);
    loop {
        ensure_not_canceled(&cancel_flag)?;
        let result = download_segments(
            client.clone(),
            headers.clone(),
            temp_dir.clone(),
            segments.clone(),
            SegmentDownloadConfig {
                concurrency,
                start_index: config.start_index,
                initial_downloaded_bytes: config.initial_downloaded_bytes,
                retry_limit: config.retry_limit,
            },
            Arc::clone(&cancel_flag),
        );

        match result {
            Ok(downloaded) => return Ok(downloaded),
            Err(error) => {
                let message = error.to_string();
                let Some(next_concurrency) = next_concurrency_after_rejection(concurrency) else {
                    return Err(error);
                };
                if !is_concurrency_rejection_error(&message) {
                    return Err(error);
                }
                concurrency = next_concurrency;
                thread::sleep(Duration::from_millis(CONCURRENCY_REJECTION_BACKOFF_MS));
            }
        }
    }
}

fn download_hls_segments(
    request: &DownloadRequest,
    cancel_flag: Arc<AtomicBool>,
) -> Result<DownloadResult> {
    ensure_not_canceled(&cancel_flag)?;
    let temp_dir = PathBuf::from(&request.temp_dir);
    fs::create_dir_all(&temp_dir).map_err(to_napi_error)?;
    let headers = header_map(&request.headers)?;
    let plan = download_plan(request, request.segments.len());
    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .pool_max_idle_per_host(plan.max_concurrency)
        .build()
        .map_err(to_napi_error)?;
    let retry_limit = request.retry_limit.unwrap_or(3).max(1);
    let key_file_names = key_file_names(&request.segments)?;

    download_keys(
        &client,
        &headers,
        &temp_dir,
        &key_file_names,
        retry_limit,
        &cancel_flag,
    )?;
    ensure_not_canceled(&cancel_flag)?;

    let sample = sample_segments(
        &client,
        &headers,
        &temp_dir,
        &request.segments,
        plan.sample_segment_count,
        retry_limit,
        &cancel_flag,
    )?;
    let concurrency = adaptive_concurrency(
        plan.min_concurrency,
        plan.max_concurrency,
        sample.downloaded_bytes,
        sample.elapsed,
    );
    ensure_not_canceled(&cancel_flag)?;

    let downloaded_bytes = download_segments_with_concurrency_fallback(
        client,
        headers,
        temp_dir.clone(),
        request.segments.clone(),
        SegmentDownloadConfig {
            concurrency,
            start_index: sample.count,
            initial_downloaded_bytes: sample.downloaded_bytes,
            retry_limit,
        },
        Arc::clone(&cancel_flag),
    )?;
    ensure_not_canceled(&cancel_flag)?;

    let playlist =
        build_local_playlist(&request.segments, &key_file_names, request.target_duration);
    let playlist_path = temp_dir.join("playlist.m3u8");
    fs::write(&playlist_path, playlist).map_err(to_napi_error)?;

    Ok(DownloadResult {
        playlist_path: playlist_path.to_string_lossy().to_string(),
        downloaded_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_local_playlist_with_keys_and_segments() {
        let segments = vec![
            HlsSegment {
                url: "https://cdn.example.test/hls/seg-0001.ts?token=abc".to_string(),
                duration: Some(5.5),
                key: Some(HlsKey {
                    method: "AES-128".to_string(),
                    uri: Some("https://cdn.example.test/hls/key.bin".to_string()),
                    iv: Some("0x1234".to_string()),
                }),
            },
            HlsSegment {
                url: "https://cdn.example.test/hls/seg-0002.ts".to_string(),
                duration: Some(6.0),
                key: Some(HlsKey {
                    method: "AES-128".to_string(),
                    uri: Some("https://cdn.example.test/hls/key.bin".to_string()),
                    iv: Some("0x1234".to_string()),
                }),
            },
            HlsSegment {
                url: "https://cdn.example.test/hls/seg-0003.ts".to_string(),
                duration: Some(6.0),
                key: None,
            },
        ];
        let mut key_file_names = HashMap::new();
        key_file_names.insert(
            "https://cdn.example.test/hls/key.bin".to_string(),
            "key-000001.key".to_string(),
        );

        assert_eq!(
            build_local_playlist(&segments, &key_file_names, Some(6.0)),
            [
                "#EXTM3U",
                "#EXT-X-VERSION:3",
                "#EXT-X-TARGETDURATION:6",
                "#EXT-X-MEDIA-SEQUENCE:0",
                "#EXT-X-KEY:METHOD=AES-128,URI=\"key-000001.key\",IV=0x1234",
                "#EXTINF:5.5,",
                "segment-000001.ts",
                "#EXTINF:6,",
                "segment-000002.ts",
                "#EXT-X-KEY:METHOD=NONE",
                "#EXTINF:6,",
                "segment-000003.ts",
                "#EXT-X-ENDLIST",
                "",
            ]
            .join("\n")
        );
    }

    #[test]
    fn rejects_unsupported_hls_key_methods() {
        let segments = vec![HlsSegment {
            url: "https://cdn.example.test/hls/seg-0001.ts".to_string(),
            duration: Some(6.0),
            key: Some(HlsKey {
                method: "SAMPLE-AES".to_string(),
                uri: Some("https://cdn.example.test/hls/key.bin".to_string()),
                iv: None,
            }),
        }];

        assert!(key_file_names(&segments).is_err());
    }

    #[test]
    fn keeps_segment_extensions_conservative() {
        assert_eq!(
            local_segment_file_name(0, "https://cdn.example.test/hls/seg-0001.ts?token=abc"),
            "segment-000001.ts"
        );
        assert_eq!(
            local_segment_file_name(1, "https://cdn.example.test/hls/seg-0002.m4s"),
            "segment-000002.m4s"
        );
        assert_eq!(
            local_segment_file_name(2, "https://cdn.example.test/hls/seg-0003.bin"),
            "segment-000003.ts"
        );
    }

    #[test]
    fn chooses_adaptive_concurrency_from_sample_throughput() {
        assert_eq!(
            adaptive_concurrency(8, 32, 1024 * 1024, Duration::from_secs(1)),
            32
        );
        assert_eq!(
            adaptive_concurrency(8, 32, 2 * 1024 * 1024, Duration::from_secs(1)),
            16
        );
        assert_eq!(
            adaptive_concurrency(8, 32, 64 * 1024 * 1024, Duration::from_secs(1)),
            8
        );
    }

    #[test]
    fn recognizes_concurrency_rejection_errors() {
        assert!(is_concurrency_rejection_error(
            "HTTP 428 Precondition Required"
        ));
        assert!(is_concurrency_rejection_error("HTTP 429 Too Many Requests"));
        assert!(!is_concurrency_rejection_error("HTTP 404 Not Found"));
    }

    #[test]
    fn steps_down_concurrency_after_rejection() {
        assert_eq!(next_concurrency_after_rejection(32), Some(16));
        assert_eq!(next_concurrency_after_rejection(16), Some(8));
        assert_eq!(next_concurrency_after_rejection(8), Some(4));
        assert_eq!(next_concurrency_after_rejection(1), None);
    }

    #[test]
    fn keeps_fixed_concurrency_when_no_maximum_is_requested() {
        let request = DownloadRequest {
            download_id: "download".to_string(),
            temp_dir: "/tmp/download".to_string(),
            headers: HashMap::new(),
            concurrency: Some(8),
            min_concurrency: None,
            max_concurrency: None,
            sample_segment_count: None,
            retry_limit: Some(3),
            target_duration: Some(6.0),
            segments: vec![HlsSegment {
                url: "https://cdn.example.test/hls/seg-0001.ts".to_string(),
                duration: Some(6.0),
                key: None,
            }],
        };
        let plan = download_plan(&request, request.segments.len());

        assert_eq!(plan.min_concurrency, 8);
        assert_eq!(plan.max_concurrency, 8);
        assert_eq!(plan.sample_segment_count, 0);
    }
}
