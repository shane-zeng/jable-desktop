use crate::model::{HlsKey, HlsSegment};
use napi::bindgen_prelude::{Error, Result};
use std::collections::HashMap;

pub(crate) fn segment_file_name(index: usize, url: &str) -> String {
    format!(
        "segment-{index:06}{}",
        segment_extension(url),
        index = index + 1
    )
}

pub(crate) fn key_file_name(index: usize) -> String {
    format!("key-{index:06}.key", index = index + 1)
}

pub(crate) fn key_file_names(segments: &[HlsSegment]) -> Result<HashMap<String, String>> {
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
                key_file_names.insert(uri.clone(), key_file_name(key_file_names.len()));
            }
        }
    }
    Ok(key_file_names)
}

pub(crate) fn build_local_playlist(
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
        let key_signature = key_signature(key);

        if key_signature != previous_key {
            if let Some((key, file_name)) = key {
                lines.push(key_line(key, file_name));
            } else if !previous_key.is_empty() {
                lines.push("#EXT-X-KEY:METHOD=NONE".to_string());
            }
            previous_key = key_signature;
        }

        lines.push(format!("#EXTINF:{},", duration_value(segment.duration)));
        lines.push(segment_file_name(index, &segment.url));
    }

    lines.push("#EXT-X-ENDLIST".to_string());
    lines.push(String::new());
    lines.join("\n")
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

fn duration_value(value: Option<f64>) -> String {
    match value {
        Some(duration) if duration.is_finite() && duration >= 0.0 => duration.to_string(),
        _ => "0".to_string(),
    }
}

fn key_signature(key: Option<(&HlsKey, &str)>) -> String {
    key.map(|(key, file_name)| {
        format!(
            "{}|{}|{}",
            key.method,
            file_name,
            key.iv.clone().unwrap_or_default()
        )
    })
    .unwrap_or_default()
}

fn key_line(key: &HlsKey, file_name: &str) -> String {
    let mut line = format!("#EXT-X-KEY:METHOD={},URI=\"{}\"", key.method, file_name);
    if let Some(iv) = &key.iv {
        line.push_str(",IV=");
        line.push_str(iv);
    }
    line
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
            segment_file_name(0, "https://cdn.example.test/hls/seg-0001.ts?token=abc"),
            "segment-000001.ts"
        );
        assert_eq!(
            segment_file_name(1, "https://cdn.example.test/hls/seg-0002.m4s"),
            "segment-000002.m4s"
        );
        assert_eq!(
            segment_file_name(2, "https://cdn.example.test/hls/seg-0003.bin"),
            "segment-000003.ts"
        );
    }
}
