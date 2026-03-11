use std::{env, path::PathBuf};

use anyhow::{Context, Result};

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub database_url: String,
    pub storage_root: PathBuf,
    pub auth_tokens: Vec<String>,
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
        let auth_tokens = env::var("AUTH_TOKENS")
            .ok()
            .map(|value| parse_auth_tokens(&value))
            .filter(|tokens| !tokens.is_empty())
            .or_else(|| {
                env::var("AUTH_TOKEN")
                    .ok()
                    .map(|value| parse_auth_tokens(&value))
                    .filter(|tokens| !tokens.is_empty())
            })
            .context("AUTH_TOKEN or AUTH_TOKENS must be set")?;

        Ok(Self {
            port,
            database_url,
            storage_root,
            auth_tokens,
        })
    }
}

fn parse_auth_tokens(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(ToString::to_string)
        .collect()
}
