use crate::error::{canceled_error, ensure_not_canceled, to_napi_error};
use crate::http::fetch_with_retry;
use crate::model::HlsSegment;
use crate::planning::{
    is_concurrency_rejection_error, next_concurrency_after_rejection, SegmentSample,
    CONCURRENCY_REJECTION_BACKOFF_MS,
};
use crate::playlist::segment_file_name;
use napi::bindgen_prelude::{Error, Result};
use reqwest::blocking::Client;
use reqwest::header::HeaderMap;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

pub(crate) struct SegmentDownloadConfig {
    pub(crate) concurrency: usize,
    pub(crate) start_index: usize,
    pub(crate) initial_downloaded_bytes: u64,
    pub(crate) retry_limit: usize,
}

#[derive(Clone)]
struct SegmentWorker {
    client: Client,
    headers: HeaderMap,
    temp_dir: PathBuf,
    segments: Arc<Vec<HlsSegment>>,
    next_index: Arc<AtomicUsize>,
    downloaded_bytes: Arc<AtomicU64>,
    errors: Arc<Mutex<Vec<String>>>,
    stop_flag: Arc<AtomicBool>,
    cancel_flag: Arc<AtomicBool>,
    retry_limit: usize,
}

pub(crate) fn sample_segments(
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
        let output_path = temp_dir.join(segment_file_name(index, &segment.url));
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

pub(crate) fn download_keys(
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

pub(crate) fn download_segments_with_concurrency_fallback(
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

    let downloaded_bytes = Arc::new(AtomicU64::new(config.initial_downloaded_bytes));
    let errors = Arc::new(Mutex::new(Vec::<String>::new()));
    let worker = SegmentWorker {
        client,
        headers,
        temp_dir,
        segments: Arc::new(segments),
        next_index: Arc::new(AtomicUsize::new(config.start_index)),
        downloaded_bytes: Arc::clone(&downloaded_bytes),
        errors: Arc::clone(&errors),
        stop_flag: Arc::new(AtomicBool::new(false)),
        cancel_flag: Arc::clone(&cancel_flag),
        retry_limit: config.retry_limit,
    };
    let worker_count = config.concurrency.max(1).min(remaining_count);
    let mut handles = Vec::with_capacity(worker_count);

    for _ in 0..worker_count {
        let worker = worker.clone();
        handles.push(thread::spawn(move || worker.run()));
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

impl SegmentWorker {
    fn run(&self) {
        loop {
            if self.should_stop() {
                break;
            }

            let index = self.next_index.fetch_add(1, Ordering::SeqCst);
            if index >= self.segments.len() {
                break;
            }

            if let Err(error) = self.download_or_skip(index) {
                self.record_error(error);
                break;
            }
        }
    }

    fn should_stop(&self) -> bool {
        self.cancel_flag.load(Ordering::SeqCst)
            || self.stop_flag.load(Ordering::SeqCst)
            || !self
                .errors
                .lock()
                .map(|errors| errors.is_empty())
                .unwrap_or(false)
    }

    fn download_or_skip(&self, index: usize) -> Result<()> {
        let segment = &self.segments[index];
        let output_path = self.temp_dir.join(segment_file_name(index, &segment.url));
        if let Ok(metadata) = fs::metadata(&output_path) {
            if metadata.is_file() {
                self.downloaded_bytes
                    .fetch_add(metadata.len(), Ordering::SeqCst);
                return Ok(());
            }
        }

        let downloaded = fetch_with_retry(
            &self.client,
            &segment.url,
            &self.headers,
            &output_path,
            self.retry_limit,
            &self.cancel_flag,
        )?;
        self.downloaded_bytes
            .fetch_add(downloaded, Ordering::SeqCst);
        Ok(())
    }

    fn record_error(&self, error: Error) {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Ok(mut errors) = self.errors.lock() {
            errors.push(error.to_string());
        }
    }
}
