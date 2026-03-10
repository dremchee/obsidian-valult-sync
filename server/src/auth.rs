use axum::{
    extract::State,
    http::{header::AUTHORIZATION, Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

use crate::state::AppState;

#[derive(Serialize)]
struct AuthErrorBody<'a> {
    error: &'a str,
    message: &'a str,
}

pub async fn require_auth(
    State(state): State<AppState>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, Response> {
    if state.auth_tokens().is_empty() {
        return Ok(next.run(request).await);
    }

    let provided = request
        .headers()
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(parse_bearer_token);

    if provided
        .map(|token| state.auth_tokens().iter().any(|expected| expected == token))
        .unwrap_or(false)
    {
        Ok(next.run(request).await)
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            Json(AuthErrorBody {
                error: "unauthorized",
                message: "valid bearer token is required",
            }),
        )
            .into_response())
    }
}

fn parse_bearer_token(value: &str) -> Option<&str> {
    value.strip_prefix("Bearer ").map(str::trim).filter(|value| !value.is_empty())
}
