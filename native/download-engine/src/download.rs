use crate::error::{ensure_not_canceled, to_napi_error};
use crate::http::{build_client, header_map};
use crate::model::{DownloadRequest, DownloadResult};
use crate::planning::{adaptive_concurrency, download_plan};
use crate::playlist::{build_local_playlist, key_file_names};
use crate::transfer::{
    download_keys, download_segments_with_concurrency_fallback, sample_segments,
    SegmentDownloadConfig,
};
use napi::bindgen_prelude::Result;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

pub(crate) fn download_hls_segments(
    request: &DownloadRequest,
    cancel_flag: Arc<AtomicBool>,
) -> Result<DownloadResult> {
    ensure_not_canceled(&cancel_flag)?;
    let temp_dir = PathBuf::from(&request.temp_dir);
    fs::create_dir_all(&temp_dir).map_err(to_napi_error)?;

    let headers = header_map(&request.headers)?;
    let plan = download_plan(request, request.segments.len());
    let client = build_client(plan.max_concurrency)?;
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
