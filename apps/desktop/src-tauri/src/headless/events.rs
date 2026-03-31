use super::command_support::HeadlessCommandError;
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use host_application::{DevServerEmitter, RunEmitter};
use std::collections::VecDeque;
use std::convert::Infallible;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use tokio_stream::wrappers::errors::BroadcastStreamRecvError;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

#[derive(Clone, Debug)]
pub(super) struct HeadlessEvent {
    pub(super) id: u64,
    pub(super) payload: String,
}

#[derive(Clone)]
pub(super) struct HeadlessEventBus {
    capacity: usize,
    next_id: Arc<AtomicU64>,
    recent: Arc<Mutex<VecDeque<HeadlessEvent>>>,
    sender: broadcast::Sender<HeadlessEvent>,
}

impl HeadlessEventBus {
    pub(super) fn new(capacity: usize) -> Self {
        let (sender, _) = broadcast::channel(capacity);
        Self {
            capacity,
            next_id: Arc::new(AtomicU64::new(0)),
            recent: Arc::new(Mutex::new(VecDeque::with_capacity(capacity))),
            sender,
        }
    }

    pub(super) fn emit(&self, payload: String) {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let event = HeadlessEvent { id, payload };
        {
            let mut recent = self
                .recent
                .lock()
                .expect("browser event buffer should lock");
            recent.push_back(event.clone());
            if recent.len() > self.capacity {
                recent.pop_front();
            }
        }
        let _ = self.sender.send(event);
    }

    pub(super) fn replay_since(&self, last_seen_id: Option<u64>) -> Vec<HeadlessEvent> {
        let Some(last_seen_id) = last_seen_id else {
            return Vec::new();
        };

        self.recent
            .lock()
            .expect("browser event buffer should lock")
            .iter()
            .filter(|event| event.id > last_seen_id)
            .cloned()
            .collect()
    }

    pub(super) fn subscribe(&self) -> broadcast::Receiver<HeadlessEvent> {
        self.sender.subscribe()
    }
}

pub(super) fn build_sse_response(
    bus: HeadlessEventBus,
    last_event_id: Option<u64>,
    stream_name: &'static str,
) -> impl IntoResponse {
    let replay_stream = tokio_stream::iter(
        bus.replay_since(last_event_id)
            .into_iter()
            .map(|event| to_sse_event(&event)),
    );
    let live_stream = BroadcastStream::new(bus.subscribe()).map(move |message| match message {
        Ok(event) => to_sse_event(&event),
        Err(BroadcastStreamRecvError::Lagged(skipped)) => {
            Ok(Event::default().event("stream-warning").data(format!(
                "{stream_name} skipped {skipped} events; reconnect will replay buffered events."
            )))
        }
    });

    Sse::new(replay_stream.chain(live_stream)).keep_alive(KeepAlive::default())
}

pub(super) fn parse_last_event_id(
    headers: &HeaderMap,
) -> Result<Option<u64>, HeadlessCommandError> {
    let Some(last_event_id) = headers.get("last-event-id") else {
        return Ok(None);
    };
    let value = last_event_id.to_str().map_err(|error| {
        HeadlessCommandError::bad_request(format!("Invalid Last-Event-ID header: {error}"))
    })?;
    value.parse::<u64>().map(Some).map_err(|error| {
        HeadlessCommandError::bad_request(format!("Invalid Last-Event-ID header: {error}"))
    })
}

pub(super) fn make_emitter(events: HeadlessEventBus) -> RunEmitter {
    Arc::new(move |event| match serde_json::to_string(&event) {
        Ok(payload) => {
            events.emit(payload);
        }
        Err(error) => {
            tracing::warn!(
                target: "openducktor.browser-backend",
                error = %error,
                "Failed to serialize run event for browser SSE"
            );
        }
    })
}

pub(super) fn make_dev_server_emitter(events: HeadlessEventBus) -> DevServerEmitter {
    Arc::new(move |event| match serde_json::to_string(&event) {
        Ok(payload) => {
            events.emit(payload);
        }
        Err(error) => {
            tracing::warn!(
                target: "openducktor.browser-backend",
                error = %error,
                "Failed to serialize dev server event for browser SSE"
            );
        }
    })
}

fn to_sse_event(event: &HeadlessEvent) -> Result<Event, Infallible> {
    Ok(Event::default()
        .id(event.id.to_string())
        .data(event.payload.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue, StatusCode};

    #[test]
    fn parse_last_event_id_accepts_valid_header() {
        let mut headers = HeaderMap::new();
        headers.insert("last-event-id", HeaderValue::from_static("42"));

        let parsed = parse_last_event_id(&headers).expect("header should parse");

        assert_eq!(parsed, Some(42));
    }

    #[test]
    fn parse_last_event_id_rejects_invalid_header() {
        let mut headers = HeaderMap::new();
        headers.insert("last-event-id", HeaderValue::from_static("abc"));

        let error = parse_last_event_id(&headers).expect_err("invalid header should fail");

        assert_eq!(error.status, StatusCode::BAD_REQUEST);
        assert!(error.message.contains("Invalid Last-Event-ID header"));
    }

    #[test]
    fn headless_event_bus_replays_buffered_events_after_last_seen_id() {
        let bus = HeadlessEventBus::new(2);
        bus.emit("first".to_string());
        bus.emit("second".to_string());
        bus.emit("third".to_string());

        let replayed = bus.replay_since(Some(1));

        assert_eq!(replayed.len(), 2);
        assert_eq!(replayed[0].id, 2);
        assert_eq!(replayed[0].payload, "second");
        assert_eq!(replayed[1].id, 3);
        assert_eq!(replayed[1].payload, "third");
    }

    #[test]
    fn to_sse_event_sets_event_id() {
        let event = HeadlessEvent {
            id: 7,
            payload: "{\"ok\":true}".to_string(),
        };

        let sse = to_sse_event(&event).expect("event should serialize");

        let debug = format!("{sse:?}");
        assert!(
            debug.contains("id"),
            "expected event debug output to mention id: {debug}"
        );
        assert!(
            debug.contains("7"),
            "expected event debug output to contain id value: {debug}"
        );
    }
}
