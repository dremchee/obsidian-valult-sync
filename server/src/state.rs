use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use sqlx::SqlitePool;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct AppState {
    inner: Arc<AppStateInner>,
}

struct AppStateInner {
    pub pool: SqlitePool,
    pub storage_root: PathBuf,
    pub auth_tokens: Vec<String>,
    pub realtime_channels: Mutex<HashMap<String, broadcast::Sender<i64>>>,
}

impl AppState {
    pub fn new(pool: SqlitePool, storage_root: PathBuf, auth_tokens: Vec<String>) -> Self {
        Self {
            inner: Arc::new(AppStateInner {
                pool,
                storage_root,
                auth_tokens,
                realtime_channels: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.inner.pool
    }

    pub fn storage_root(&self) -> &PathBuf {
        &self.inner.storage_root
    }

    pub fn auth_tokens(&self) -> &[String] {
        &self.inner.auth_tokens
    }

    pub fn subscribe_to_vault_events(&self, vault_id: &str) -> broadcast::Receiver<i64> {
        self.channel_for_vault(vault_id).subscribe()
    }

    pub fn notify_vault_event(&self, vault_id: &str, latest_seq: i64) {
        let _ = self.channel_for_vault(vault_id).send(latest_seq);
    }

    fn channel_for_vault(&self, vault_id: &str) -> broadcast::Sender<i64> {
        let mut channels = self
            .inner
            .realtime_channels
            .lock()
            .expect("realtime channel mutex poisoned");
        channels
            .entry(vault_id.to_owned())
            .or_insert_with(|| {
                let (sender, _) = broadcast::channel(128);
                sender
            })
            .clone()
    }
}
