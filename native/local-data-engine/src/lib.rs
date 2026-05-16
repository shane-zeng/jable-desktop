use napi::bindgen_prelude::*;
use napi_derive::napi;
use rusqlite::Connection;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

struct Engine {
  conn: Option<Connection>,
}

impl Engine {
  fn open(file_path: &str) -> Result<Self> {
    if let Some(parent) = Path::new(file_path).parent() {
      fs::create_dir_all(parent).map_err(to_napi_error)?;
    }

    let conn = Connection::open(file_path).map_err(to_napi_error)?;
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")
      .map_err(to_napi_error)?;
    verify_fts5(&conn)?;

    Ok(Self { conn: Some(conn) })
  }

  fn close(&mut self) -> Result<()> {
    if let Some(conn) = self.conn.take() {
      conn.close().map_err(|(_, error)| to_napi_error(error))?;
    }

    Ok(())
  }
}

fn to_napi_error(error: impl std::fmt::Display) -> Error {
  Error::from_reason(error.to_string())
}

fn verify_fts5(conn: &Connection) -> Result<()> {
  conn.execute_batch(
    "CREATE VIRTUAL TABLE IF NOT EXISTS __jable_data_engine_fts_probe USING fts5(value);
     DROP TABLE IF EXISTS __jable_data_engine_fts_probe;",
  )
  .map_err(|error| Error::from_reason(format!("SQLite FTS5 is required by the native data engine: {error}")))?;

  Ok(())
}

#[napi]
pub struct JableDataEngine {
  inner: Mutex<Engine>,
}

#[napi]
impl JableDataEngine {
  #[napi(constructor)]
  pub fn new(file_path: String) -> Result<Self> {
    Ok(Self {
      inner: Mutex::new(Engine::open(&file_path)?),
    })
  }

  #[napi]
  pub fn close(&self) -> Result<()> {
    self.inner.lock().map_err(to_napi_error)?.close()
  }

  #[napi(js_name = "engineVersion")]
  pub fn engine_version(&self) -> String {
    "rust-native-skeleton".to_string()
  }
}
