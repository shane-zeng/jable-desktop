use crate::model::DownloadRequest;
use std::time::Duration;

const DEFAULT_SEGMENT_MIN_CONCURRENCY: usize = 8;
const DEFAULT_SEGMENT_MAX_CONCURRENCY: usize = 32;
const DEFAULT_SAMPLE_SEGMENT_COUNT: usize = 3;
const ADAPTIVE_CONCURRENCY_TARGET_BYTES_PER_SECOND: f64 = 32.0 * 1024.0 * 1024.0;

pub(crate) const CONCURRENCY_REJECTION_BACKOFF_MS: u64 = 1000;

pub(crate) struct DownloadPlan {
    pub(crate) min_concurrency: usize,
    pub(crate) max_concurrency: usize,
    pub(crate) sample_segment_count: usize,
}

pub(crate) struct SegmentSample {
    pub(crate) downloaded_bytes: u64,
    pub(crate) elapsed: Duration,
    pub(crate) count: usize,
}

pub(crate) fn download_plan(request: &DownloadRequest, segment_count: usize) -> DownloadPlan {
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

pub(crate) fn adaptive_concurrency(
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

pub(crate) fn is_concurrency_rejection_error(message: &str) -> bool {
    message.contains("HTTP 403")
        || message.contains("HTTP 428")
        || message.contains("HTTP 429")
        || message.contains("HTTP 503")
        || message.contains("HTTP 504")
}

pub(crate) fn next_concurrency_after_rejection(current: usize) -> Option<usize> {
    if current <= 1 {
        return None;
    }
    Some((current / 2).max(1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::HlsSegment;
    use std::collections::HashMap;

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
