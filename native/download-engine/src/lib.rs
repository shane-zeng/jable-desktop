mod download;
mod error;
mod http;
mod model;
mod planning;
mod playlist;
mod transfer;

use crate::download::download_hls_segments;
use crate::error::to_napi_error;
use crate::model::{DownloadRequest, DownloadResult};
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

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

        // The JS-facing download id is the only handle available for cancellation
        // after this N-API task leaves the main thread.
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
        // Cleanup is best-effort so a poisoned cancellation map cannot hide the
        // original download result from JS.
        if let Ok(mut cancellations) = self.cancellations.lock() {
            cancellations.remove(&self.request.download_id);
        }
        result
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        serde_json::to_string(&output).map_err(to_napi_error)
    }
}
