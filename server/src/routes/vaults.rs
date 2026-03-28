use axum::{
    Json, Router,
    routing::{get, post},
};

use crate::{
    dto::{CreateVaultRequest, CreateVaultResponse, VaultsResponse},
    error::AppError,
    services::registry,
    state::AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/vaults", get(get_vaults))
        .route("/vaults", post(create_vault))
}

async fn get_vaults(
    axum::extract::State(state): axum::extract::State<AppState>,
) -> Result<Json<VaultsResponse>, AppError> {
    let response = registry::get_vaults(&state).await?;
    Ok(Json(response))
}

async fn create_vault(
    axum::extract::State(state): axum::extract::State<AppState>,
    Json(request): Json<CreateVaultRequest>,
) -> Result<Json<CreateVaultResponse>, AppError> {
    let response = registry::create_vault(&state, request).await?;
    Ok(Json(response))
}
