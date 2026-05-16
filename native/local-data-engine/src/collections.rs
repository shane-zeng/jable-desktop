use napi::bindgen_prelude::*;

pub(crate) const PRIMARY_ORIGIN: &str = "https://jable.tv";

#[derive(Clone)]
pub(crate) struct Collection {
    pub(crate) key: &'static str,
    pub(crate) name: &'static str,
    pub(crate) source_path: &'static str,
}

pub(crate) fn collections() -> [Collection; 2] {
    [
        Collection {
            key: "favourites",
            name: "影片收藏",
            source_path: "/my/favourites/videos/",
        },
        Collection {
            key: "watch_later",
            name: "稍後觀看",
            source_path: "/my/favourites/videos-watch-later/",
        },
    ]
}

fn collection_by_key(key: &str) -> Option<Collection> {
    collections()
        .into_iter()
        .find(|collection| collection.key == key)
}

pub(crate) fn ensure_collection(key: &str) -> Result<Collection> {
    collection_by_key(key).ok_or_else(|| Error::from_reason(format!("Unknown collection: {key}")))
}
