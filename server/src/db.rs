use std::path::Path;

use anyhow::{Context, Result};
use sqlx::{sqlite::SqliteConnectOptions, Pool, Sqlite, SqlitePool};

static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

pub async fn connect(database_url: &str) -> Result<SqlitePool> {
    ensure_parent_dir(database_url)?;

    let options = SqliteConnectOptions::new()
        .filename(database_path(database_url))
        .create_if_missing(true);

    Pool::<Sqlite>::connect_with(options)
        .await
        .context("failed to open sqlite database")
}

pub async fn migrate(pool: &SqlitePool) -> Result<()> {
    MIGRATOR.run(pool).await.context("migration failed")
}

fn database_path(database_url: &str) -> &str {
    database_url
        .strip_prefix("sqlite://")
        .unwrap_or(database_url)
}

fn ensure_parent_dir(database_url: &str) -> Result<()> {
    let db_path = Path::new(database_path(database_url));
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).context("failed to create database directory")?;
    }
    Ok(())
}
