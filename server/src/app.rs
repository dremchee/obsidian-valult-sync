use axum::{middleware, Router};
use tower_http::trace::TraceLayer;

use crate::{auth, routes, state::AppState};

pub fn build_router(state: AppState) -> Router {
    let protected = Router::new()
        .merge(routes::upload::router())
        .merge(routes::file::router())
        .merge(routes::changes::router())
        .merge(routes::delete::router())
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth,
        ));

    Router::new()
        .merge(routes::health::router())
        .merge(protected)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
