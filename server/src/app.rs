use axum::{
    http::{header::{AUTHORIZATION, CONTENT_TYPE}, Method},
    middleware,
    Router,
};
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};

use crate::{auth, routes, state::AppState};

pub fn build_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods([Method::GET, Method::POST])
        .allow_headers([AUTHORIZATION, CONTENT_TYPE]);

    let protected = Router::new()
        .merge(routes::upload::router())
        .merge(routes::file::router())
        .merge(routes::changes::router())
        .merge(routes::devices::router())
        .merge(routes::events::router())
        .merge(routes::delete::router())
        .merge(routes::vaults::router())
        .merge(routes::history::router())
        .merge(routes::restore::router())
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth::require_auth,
        ));

    Router::new()
        .merge(routes::health::router())
        .merge(protected)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
