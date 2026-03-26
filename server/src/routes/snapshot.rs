use axum::{Json, Router, routing::get};

use crate::{dto::VaultSnapshotResponse, error::AppError, services::sync, state::AppState};

pub fn router() -> Router<AppState> {
    Router::new().route("/snapshot", get(get_snapshot))
}

async fn get_snapshot(
    axum::extract::State(state): axum::extract::State<AppState>,
    axum::extract::Query(params): axum::extract::Query<GetSnapshotParams>,
) -> Result<Json<VaultSnapshotResponse>, AppError> {
    let response = sync::get_vault_snapshot(&state, params.vault_id).await?;
    Ok(Json(response))
}

#[derive(serde::Deserialize)]
struct GetSnapshotParams {
    vault_id: String,
}
