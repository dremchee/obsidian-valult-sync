use axum::{Json, Router, extract::Query, routing::get};
use serde::Deserialize;

use crate::{dto::DevicesResponse, error::AppError, services::sync, state::AppState};

#[derive(Deserialize)]
struct DevicesQuery {
    vault_id: String,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/devices", get(get_devices))
}

async fn get_devices(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(query): Query<DevicesQuery>,
) -> Result<Json<DevicesResponse>, AppError> {
    let response = sync::get_devices(&state, query.vault_id).await?;
    Ok(Json(response))
}
