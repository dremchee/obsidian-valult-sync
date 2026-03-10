use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("path is invalid")]
    InvalidPath,
    #[error("request body contains invalid base64")]
    InvalidBase64,
    #[error("provided hash does not match content")]
    HashMismatch,
    #[error("file not found")]
    NotFound,
    #[error("{0}")]
    Internal(String),
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    error: &'a str,
    message: String,
}

impl AppError {
    pub fn internal<E>(error: E) -> Self
    where
        E: std::fmt::Display,
    {
        Self::Internal(error.to_string())
    }

    fn code(&self) -> &'static str {
        match self {
            Self::InvalidPath => "invalid_path",
            Self::InvalidBase64 => "invalid_base64",
            Self::HashMismatch => "hash_mismatch",
            Self::NotFound => "not_found",
            Self::Internal(_) => "internal_error",
        }
    }

    fn status(&self) -> StatusCode {
        match self {
            Self::InvalidPath | Self::InvalidBase64 | Self::HashMismatch => StatusCode::BAD_REQUEST,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let status = self.status();
        let body = ErrorBody {
            error: self.code(),
            message: self.to_string(),
        };
        (status, Json(body)).into_response()
    }
}
