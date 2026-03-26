use axum::{Json, Router, routing::post};

use crate::{
    dto::{MutationResponse, RestoreFileRequest},
    error::AppError,
    services::sync,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/restore", post(restore))
}

async fn restore(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(request): Json<RestoreFileRequest>,
) -> Result<Json<MutationResponse>, AppError> {
    let response = sync::restore_file(&state, request).await?;
    Ok(Json(response))
}
