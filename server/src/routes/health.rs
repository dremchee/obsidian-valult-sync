use axum::{routing::get, Json, Router};
use serde::Serialize;

use crate::state::AppState;

#[derive(Serialize)]
struct HealthResponse {
    ok: bool,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/health", get(health))
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { ok: true })
}
