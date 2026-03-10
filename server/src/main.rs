use anyhow::Context;
use obsidian_sync_server::{app, config, db, state};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    init_tracing();

    let config = config::Config::from_env()?;
    let pool = db::connect(&config.database_url)
        .await
        .context("failed to connect to sqlite")?;
    db::migrate(&pool)
        .await
        .context("failed to run sqlite migrations")?;

    let app_state = state::AppState::new(pool, config.storage_root.clone(), config.auth_tokens.clone());
    let app = app::build_router(app_state);

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", config.port))
        .await
        .context("failed to bind TCP listener")?;

    tracing::info!(port = config.port, "server listening");
    axum::serve(listener, app)
        .await
        .context("server exited with error")?;

    Ok(())
}

fn init_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "obsidian_sync_server=info,tower_http=info".into()),
        )
        .init();
}
