use axum::{
    Json, Router,
    extract::Query,
    routing::{get, post},
};
use serde::Deserialize;

use crate::{
    dto::{
        ChangesResponse, DocumentHistoryResponse, DocumentPushRequest, DocumentSnapshotResponse,
        MutationResponse, RestoreDocumentRequest,
    },
    error::AppError,
    services::doc_sync,
    state::AppState,
};

#[derive(Deserialize)]
struct DocumentQuery {
    vault_id: String,
    path: Option<String>,
    since: Option<i64>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/documents/push", post(push_document))
        .route("/documents/snapshot", get(get_snapshot))
        .route("/documents/changes", get(get_changes))
        .route("/documents/history", get(get_history))
        .route("/documents/restore", post(restore_document))
}

async fn push_document(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(request): Json<DocumentPushRequest>,
) -> Result<Json<MutationResponse>, AppError> {
    let response = doc_sync::push_document(&state, request).await?;
    Ok(Json(response))
}

async fn get_snapshot(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(query): Query<DocumentQuery>,
) -> Result<Json<DocumentSnapshotResponse>, AppError> {
    let path = query.path.ok_or(AppError::InvalidPayload(
        "missing path query parameter".to_string(),
    ))?;
    let response = doc_sync::get_document_snapshot(&state, query.vault_id, path).await?;
    Ok(Json(response))
}

async fn get_changes(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(query): Query<DocumentQuery>,
) -> Result<Json<ChangesResponse>, AppError> {
    let response = doc_sync::get_document_changes(&state, query.vault_id, query.since.unwrap_or(0)).await?;
    Ok(Json(response))
}

async fn get_history(
    axum::extract::State(state): axum::extract::State<AppState>,
    Query(query): Query<DocumentQuery>,
) -> Result<Json<DocumentHistoryResponse>, AppError> {
    let path = query.path.ok_or(AppError::InvalidPayload(
        "missing path query parameter".to_string(),
    ))?;
    let response = doc_sync::get_document_history(&state, query.vault_id, path).await?;
    Ok(Json(response))
}

async fn restore_document(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(request): Json<RestoreDocumentRequest>,
) -> Result<Json<MutationResponse>, AppError> {
    let response = doc_sync::restore_document(&state, request).await?;
    Ok(Json(response))
}
