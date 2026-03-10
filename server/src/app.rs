use axum::Router;
use tower_http::trace::TraceLayer;

use crate::{routes, state::AppState};

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .merge(routes::health::router())
        .merge(routes::upload::router())
        .merge(routes::file::router())
        .merge(routes::changes::router())
        .merge(routes::delete::router())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
