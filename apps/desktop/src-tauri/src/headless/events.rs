use super::command_support::HeadlessCommandError;
use axum::http::HeaderMap;
use axum::response::sse::{Event, KeepAlive};
use axum::response::IntoResponse;
use host_application::{DevServerEmitter, RunEmitter};
use std::collections::VecDeque;
use std::convert::Infallible;
use std::pin::Pin;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::broadcast;
use tokio_stream::wrappers::errors::BroadcastStreamRecvError;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::Stream;
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
        let mut recent = self
            .recent
            .lock()
            .expect("headless::events::emit: browser event buffer should lock");
        let id = self.next_id.fetch_add(1, Ordering::SeqCst) + 1;
        let event = HeadlessEvent { id, payload };
        recent.push_back(event.clone());
        if recent.len() > self.capacity {
            recent.pop_front();
        }
        let _ = self.sender.send(event);
    }

    pub(super) fn subscribe_with_replay(
        &self,
        last_seen_id: Option<u64>,
    ) -> (broadcast::Receiver<HeadlessEvent>, Vec<HeadlessEvent>) {
        let recent = self
            .recent
            .lock()
            .expect("headless::events::subscribe_with_replay: browser event buffer should lock");
        let receiver = self.sender.subscribe();
        let replay = collect_replay_since(&recent, last_seen_id);

        (receiver, replay)
    }

}

pub(super) fn build_sse_response(
    bus: HeadlessEventBus,
    last_event_id: Option<u64>,
    stream_name: &'static str,
) -> impl IntoResponse {
    let (receiver, replay) = bus.subscribe_with_replay(last_event_id);
    let replay_stream = tokio_stream::iter(
        replay.into_iter().map(|event| to_sse_event(&event)),
    );
    let live_stream = BroadcastStream::new(receiver)
        .map(move |message| live_event_to_sse(message, stream_name));
    let stream: Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> =
        Box::pin(replay_stream.chain(live_stream));

    axum::response::sse::Sse::new(stream).keep_alive(KeepAlive::default())
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

fn collect_replay_since(
    recent: &VecDeque<HeadlessEvent>,
    last_seen_id: Option<u64>,
) -> Vec<HeadlessEvent> {
    let Some(last_seen_id) = last_seen_id else {
        return Vec::new();
    };

    recent
        .iter()
        .filter(|event| event.id > last_seen_id)
        .cloned()
        .collect()
}

fn live_event_to_sse(
    message: Result<HeadlessEvent, BroadcastStreamRecvError>,
    stream_name: &'static str,
) -> Result<Event, Infallible> {
    match message {
        Ok(event) => to_sse_event(&event),
        Err(BroadcastStreamRecvError::Lagged(skipped)) => {
            Ok(stream_warning_event(stream_name, skipped))
        }
    }
}

fn stream_warning_event(stream_name: &'static str, skipped: u64) -> Event {
    Event::default().event("stream-warning").data(format!(
        "{stream_name} skipped {skipped} events; reconnect will replay buffered events."
    ))
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

        let (_receiver, replayed) = bus.subscribe_with_replay(Some(1));

        assert_eq!(replayed.len(), 2);
        assert_eq!(replayed[0].id, 2);
        assert_eq!(replayed[0].payload, "second");
        assert_eq!(replayed[1].id, 3);
        assert_eq!(replayed[1].payload, "third");
    }

    #[tokio::test]
    async fn subscribe_with_replay_receives_new_events_after_replaying_buffered_events() {
        let bus = HeadlessEventBus::new(4);
        bus.emit("first".to_string());
        bus.emit("second".to_string());

        let (mut receiver, replayed) = bus.subscribe_with_replay(Some(1));

        assert_eq!(replayed.len(), 1);
        assert_eq!(replayed[0].id, 2);
        assert_eq!(replayed[0].payload, "second");

        bus.emit("third".to_string());

        let live = receiver.recv().await.expect("subscribed receiver should get new events");
        assert_eq!(live.id, 3);
        assert_eq!(live.payload, "third");
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

    #[test]
    fn lagged_receivers_emit_stream_warning_event() {
        let event = live_event_to_sse(
            Err(BroadcastStreamRecvError::Lagged(3)),
            "Browser event stream",
        )
        .expect("lagged warnings should serialize");

        let debug = format!("{event:?}");
        assert!(
            debug.contains("stream-warning"),
            "expected lagged event to include stream-warning: {debug}"
        );
        assert!(
            debug.contains("skipped 3 events"),
            "expected lagged event to mention skipped count: {debug}"
        );
    }
}
