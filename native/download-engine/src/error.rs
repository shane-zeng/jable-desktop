use napi::bindgen_prelude::{Error, Result};
use std::sync::atomic::{AtomicBool, Ordering};

pub(crate) fn to_napi_error(error: impl std::fmt::Display) -> Error {
    Error::from_reason(error.to_string())
}

pub(crate) fn canceled_error() -> Error {
    Error::from_reason("download canceled".to_string())
}

pub(crate) fn ensure_not_canceled(cancel_flag: &AtomicBool) -> Result<()> {
    if cancel_flag.load(Ordering::SeqCst) {
        return Err(canceled_error());
    }
    Ok(())
}
