use std::{path::PathBuf, sync::Arc};

use sqlx::SqlitePool;

#[derive(Clone)]
pub struct AppState {
    inner: Arc<AppStateInner>,
}

struct AppStateInner {
    pub pool: SqlitePool,
    pub storage_root: PathBuf,
    pub auth_token: Option<String>,
}

impl AppState {
    pub fn new(pool: SqlitePool, storage_root: PathBuf, auth_token: Option<String>) -> Self {
        Self {
            inner: Arc::new(AppStateInner {
                pool,
                storage_root,
                auth_token,
            }),
        }
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.inner.pool
    }

    pub fn storage_root(&self) -> &PathBuf {
        &self.inner.storage_root
    }

    pub fn auth_token(&self) -> Option<&str> {
        self.inner.auth_token.as_deref()
    }
}
