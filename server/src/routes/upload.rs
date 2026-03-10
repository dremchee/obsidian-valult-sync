use axum::{routing::post, Json, Router};

use crate::{
    dto::{MutationResponse, UploadRequest},
    error::AppError,
    services::sync,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/upload", post(upload))
}

async fn upload(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(request): Json<UploadRequest>,
) -> Result<Json<MutationResponse>, AppError> {
    let response = sync::upload(&state, request).await?;
    Ok(Json(response))
}
