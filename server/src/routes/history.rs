use axum::{extract::Query, routing::get, Json, Router};
use serde::Deserialize;

use crate::{dto::FileHistoryResponse, error::AppError, services::sync, state::AppState};

#[derive(Deserialize)]
struct HistoryQuery {
    vault_id: String,
    path: String,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/history", get(get_history))
}

async fn get_history(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(query): Query<HistoryQuery>,
) -> Result<Json<FileHistoryResponse>, AppError> {
    let response = sync::get_file_history(&state, query.vault_id, query.path).await?;
    Ok(Json(response))
}
