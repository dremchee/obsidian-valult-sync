use std::{path::PathBuf, sync::Arc};

use sqlx::SqlitePool;

#[derive(Clone)]
pub struct AppState {
    inner: Arc<AppStateInner>,
}

struct AppStateInner {
    pub pool: SqlitePool,
    pub storage_root: PathBuf,
}

impl AppState {
    pub fn new(pool: SqlitePool, storage_root: PathBuf) -> Self {
        Self {
            inner: Arc::new(AppStateInner { pool, storage_root }),
        }
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.inner.pool
    }

    pub fn storage_root(&self) -> &PathBuf {
        &self.inner.storage_root
    }
}
