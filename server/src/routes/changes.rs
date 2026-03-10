use axum::{extract::Query, routing::get, Json, Router};
use serde::Deserialize;

use crate::{dto::ChangesResponse, error::AppError, services::sync, state::AppState};

#[derive(Deserialize)]
struct ChangesQuery {
    vault_id: String,
    since: Option<i64>,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/changes", get(get_changes))
}

async fn get_changes(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(query): Query<ChangesQuery>,
) -> Result<Json<ChangesResponse>, AppError> {
    let response = sync::get_changes(&state, query.vault_id, query.since.unwrap_or(0)).await?;
    Ok(Json(response))
}
