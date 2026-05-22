use crate::error::{canceled_error, ensure_not_canceled, to_napi_error};
use napi::bindgen_prelude::{Error, Result};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

const CHUNK_SIZE: usize = 64 * 1024;

fn replace_output_file(partial_path: &Path, output_path: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        if output_path.exists() {
            fs::remove_file(output_path).map_err(to_napi_error)?;
        }
    }

    fs::rename(partial_path, output_path).map_err(to_napi_error)
}

pub(crate) fn header_map(headers: &HashMap<String, String>) -> Result<HeaderMap> {
    let mut header_map = HeaderMap::new();
    for (name, value) in headers {
        let header_name = HeaderName::from_bytes(name.as_bytes()).map_err(to_napi_error)?;
        let header_value = HeaderValue::from_str(value).map_err(to_napi_error)?;
        header_map.insert(header_name, header_value);
    }
    Ok(header_map)
}

pub(crate) fn build_client(max_concurrency: usize) -> Result<Client> {
    Client::builder()
        .timeout(Duration::from_secs(30))
        .pool_max_idle_per_host(max_concurrency)
        .build()
        .map_err(to_napi_error)
}

pub(crate) fn fetch_with_retry(
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
        file.write_all(&buffer[..read]).map_err(to_napi_error)?;
        downloaded += read as u64;
    }

    drop(file);
    replace_output_file(&partial_path, output_path)?;
    Ok(downloaded)
}
