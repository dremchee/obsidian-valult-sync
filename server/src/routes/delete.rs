use axum::{routing::post, Json, Router};

use crate::{
    dto::{DeleteRequest, MutationResponse},
    error::AppError,
    services::sync,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new().route("/delete", post(delete_file))
}

async fn delete_file(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(request): Json<DeleteRequest>,
) -> Result<Json<MutationResponse>, AppError> {
    let response = sync::delete(&state, request).await?;
    Ok(Json(response))
}
