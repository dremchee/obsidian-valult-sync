use std::{convert::Infallible, time::Duration};

use async_stream::stream;
use axum::{
    Router,
    extract::{Query, State},
    response::sse::{Event, KeepAlive, Sse},
    routing::get,
};
use serde::Deserialize;

use crate::{dto::RealtimeEvent, error::AppError, services, state::AppState, storage};

#[derive(Debug, Deserialize)]
struct EventsQuery {
    vault_id: String,
    since: Option<i64>,
}

pub fn router() -> Router<AppState> {
    Router::new().route("/events", get(stream_events))
}

async fn stream_events(
    State(state): State<AppState>,
    Query(query): Query<EventsQuery>,
) -> Result<Sse<impl futures_core::Stream<Item = Result<Event, Infallible>>>, AppError> {
    let vault_id = storage::validate_vault_id(&query.vault_id)?;
    let since = query.since.unwrap_or(0);
    let mut receiver = state.subscribe_to_vault_events(&vault_id);
    let latest_seq = services::doc_sync::get_latest_seq(&state, vault_id.clone()).await?;
    let stream_state = state.clone();
    let stream_vault_id = vault_id.clone();

    let events = stream! {
        if latest_seq > since {
            yield Ok(event_for_latest_seq(latest_seq));
        }

        loop {
            match receiver.recv().await {
                Ok(next_seq) => yield Ok(event_for_latest_seq(next_seq)),
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    match services::doc_sync::get_latest_seq(&stream_state, stream_vault_id.clone()).await {
                        Ok(next_seq) => yield Ok(event_for_latest_seq(next_seq)),
                        Err(error) => {
                            tracing::warn!(vault_id = %stream_vault_id, error = %error, "failed to recover realtime stream after lag");
                            break;
                        }
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    Ok(Sse::new(events).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keepalive"),
    ))
}

fn event_for_latest_seq(latest_seq: i64) -> Event {
    Event::default()
        .event("change")
        .json_data(RealtimeEvent { latest_seq })
        .expect("realtime event json serialization should not fail")
}
