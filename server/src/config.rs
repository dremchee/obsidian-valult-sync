use std::{env, path::PathBuf};

use anyhow::{Context, Result};

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub storage_root: PathBuf,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let port = env::var("PORT")
            .ok()
            .map(|value| value.parse::<u16>())
            .transpose()
            .context("PORT must be a valid u16")?
            .unwrap_or(3000);

        let database_url =
            env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://../data/sync.db".to_string());
        let storage_root = env::var("STORAGE_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("../data/files"));

        Ok(Self {
            port,
            database_url,
            storage_root,
        })
    }
}
