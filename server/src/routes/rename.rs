use axum::{Json, Router, routing::post};

use crate::{
    dto::{MutationResponse, RenameRequest},
    error::AppError,
    services::sync,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/rename", post(rename))
}

async fn rename(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(request): Json<RenameRequest>,
) -> Result<Json<MutationResponse>, AppError> {
    let response = sync::rename(&state, request).await?;
    Ok(Json(response))
}
