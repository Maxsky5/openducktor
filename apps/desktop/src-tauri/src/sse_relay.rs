use anyhow::{Context, Result};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT};
use std::io::BufRead;

const LAST_EVENT_ID_HEADER: HeaderName = HeaderName::from_static("last-event-id");

pub(crate) type SseEventId = u64;

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct SseMessage {
    pub(crate) id: Option<SseEventId>,
    pub(crate) event: Option<String>,
    pub(crate) data: String,
}

pub(crate) fn build_sse_stream_request<'a>(
    client: &'a Client,
    stream_url: &'a str,
    last_event_id: Option<SseEventId>,
) -> reqwest::blocking::RequestBuilder {
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("text/event-stream"));

    if let Some(last_event_id) = last_event_id {
        if let Ok(value) = HeaderValue::from_str(&last_event_id.to_string()) {
            headers.insert(LAST_EVENT_ID_HEADER.clone(), value);
        }
    }

    client.get(stream_url).headers(headers)
}

pub(crate) fn read_next_sse_message(reader: &mut impl BufRead) -> Result<Option<SseMessage>> {
    let mut message = SseMessage::default();
    let mut payload_lines = Vec::new();

    loop {
        let mut line = String::new();
        let bytes_read = reader.read_line(&mut line)?;

        if bytes_read == 0 {
            if payload_lines.is_empty() {
                return Ok(None);
            }

            message.data = payload_lines.join("\n");
            return Ok(Some(message));
        }

        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            if payload_lines.is_empty() {
                continue;
            }

            message.data = payload_lines.join("\n");
            return Ok(Some(message));
        }

        if let Some(id) = trimmed.strip_prefix("id:") {
            let parsed_id = id.trim().parse::<SseEventId>().with_context(|| {
                format!(
                    "invalid SSE event id received from relay stream: {}",
                    id.trim()
                )
            })?;
            message.id = Some(parsed_id);
            continue;
        }

        if let Some(event) = trimmed.strip_prefix("event:") {
            message.event = Some(event.trim().to_string());
            continue;
        }

        if let Some(payload) = trimmed.strip_prefix("data:") {
            payload_lines.push(payload.trim_start().to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn read_next_sse_message_collects_multiline_data_events_and_event_id() {
        let mut reader = Cursor::new(
            b"id: 7\nevent: message\ndata: {\"one\":1}\ndata: {\"two\":2}\n\n".to_vec(),
        );

        let message = read_next_sse_message(&mut reader)
            .expect("payload should parse")
            .expect("payload should be present");

        assert_eq!(message.id, Some(7));
        assert_eq!(message.event.as_deref(), Some("message"));
        assert_eq!(message.data, "{\"one\":1}\n{\"two\":2}");
    }

    #[test]
    fn read_next_sse_message_skips_keepalive_comments() {
        let mut reader = Cursor::new(b": keepalive\n\ndata: {\"ok\":true}\n\n".to_vec());

        let message = read_next_sse_message(&mut reader)
            .expect("payload should parse")
            .expect("payload should be present");

        assert_eq!(message.id, None);
        assert_eq!(message.event, None);
        assert_eq!(message.data, "{\"ok\":true}");
    }

    #[test]
    fn read_next_sse_message_preserves_named_event_type() {
        let mut reader =
            Cursor::new(b"event: stream-warning\ndata: task-events skipped 2 events\n\n".to_vec());

        let message = read_next_sse_message(&mut reader)
            .expect("payload should parse")
            .expect("payload should be present");

        assert_eq!(message.id, None);
        assert_eq!(message.event.as_deref(), Some("stream-warning"));
        assert_eq!(message.data, "task-events skipped 2 events");
    }

    #[test]
    fn build_sse_stream_request_includes_last_event_id_for_resume() {
        let client = Client::builder().build().expect("client should build");
        let request =
            build_sse_stream_request(&client, "http://127.0.0.1:1234/task-events", Some(42))
                .build()
                .expect("request should build");

        assert_eq!(
            request.headers().get(LAST_EVENT_ID_HEADER.clone()),
            Some(&HeaderValue::from_static("42"))
        );
        assert_eq!(
            request.headers().get(ACCEPT),
            Some(&HeaderValue::from_static("text/event-stream"))
        );
    }
}
