use axum::{extract::Query, routing::get, Json, Router};
use serde::Deserialize;

use crate::{dto::FileResponse, error::AppError, services::sync, state::AppState};

#[derive(Deserialize)]
struct FileQuery {
    path: String,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/file", get(get_file))
}

async fn get_file(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(query): Query<FileQuery>,
) -> Result<Json<FileResponse>, AppError> {
    let response = sync::get_file(&state, query.path).await?;
    Ok(Json(response))
}
