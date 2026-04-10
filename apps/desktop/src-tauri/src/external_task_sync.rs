use anyhow::{Context, Result};
use host_application::AppService;
use host_domain::now_rfc3339;
use reqwest::blocking::{Client, Response};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, ACCEPT};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const TASK_EVENT_STREAM_PATH: &str = "task-events";
const TASK_EVENT_RELAY_RETRY_DELAY: Duration = Duration::from_secs(1);
const TASK_EVENT_RELAY_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const LAST_EVENT_ID_HEADER: HeaderName = HeaderName::from_static("last-event-id");
pub(crate) const TASK_EVENT_NAME: &str = "openducktor://task-event";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ExternalTaskSyncEventKind {
    ExternalTaskCreated,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalTaskSyncEvent {
    pub(crate) event_id: String,
    pub(crate) kind: ExternalTaskSyncEventKind,
    pub(crate) repo_path: String,
    pub(crate) task_id: String,
    pub(crate) emitted_at: String,
}

pub(crate) struct TaskEventRelayState {
    pub(crate) stop_requested: Arc<AtomicBool>,
}

#[derive(Debug, Default, PartialEq, Eq)]
struct SseMessage {
    id: Option<u64>,
    data: String,
}

pub(crate) fn build_external_task_created_event(
    repo_path: String,
    task_id: String,
) -> ExternalTaskSyncEvent {
    ExternalTaskSyncEvent {
        event_id: Uuid::new_v4().to_string(),
        kind: ExternalTaskSyncEventKind::ExternalTaskCreated,
        repo_path,
        task_id,
        emitted_at: now_rfc3339(),
    }
}

pub(crate) fn start_task_event_relay<R: tauri::Runtime>(
    service: Arc<AppService>,
    app: AppHandle<R>,
) -> Arc<AtomicBool> {
    let stop_requested = Arc::new(AtomicBool::new(false));
    let relay_stop_requested = stop_requested.clone();

    std::thread::spawn(move || {
        if let Err(error) = run_task_event_relay(service, app, relay_stop_requested.clone()) {
            tracing::error!(
                target: "openducktor.task-sync",
                error = %format!("{error:#}"),
                "Task event relay terminated unexpectedly"
            );
        }
    });

    stop_requested
}

fn run_task_event_relay<R: tauri::Runtime>(
    service: Arc<AppService>,
    app: AppHandle<R>,
    stop_requested: Arc<AtomicBool>,
) -> Result<()> {
    let client = Client::builder()
        .connect_timeout(TASK_EVENT_RELAY_CONNECT_TIMEOUT)
        .build()
        .context("failed to build task event relay HTTP client")?;

    let mut last_event_id = None;
    while !stop_requested.load(Ordering::SeqCst) {
        let stream_url = match service.mcp_bridge_base_url() {
            Ok(base_url) => format!("{base_url}/{TASK_EVENT_STREAM_PATH}"),
            Err(error) => {
                tracing::error!(
                    target: "openducktor.task-sync",
                    error = %format!("{error:#}"),
                    "Task event relay could not resolve the MCP bridge URL"
                );
                sleep_before_retry(&stop_requested);
                continue;
            }
        };

        let response =
            match build_task_event_stream_request(&client, &stream_url, last_event_id).send() {
                Ok(response) => response,
                Err(error) => {
                    tracing::error!(
                        target: "openducktor.task-sync",
                        stream_url,
                        error = %error,
                        "Task event relay failed to connect to the MCP bridge task stream"
                    );
                    sleep_before_retry(&stop_requested);
                    continue;
                }
            };

        if let Err(error) =
            relay_task_event_stream(&app, response, &stop_requested, &mut last_event_id)
        {
            tracing::error!(
                target: "openducktor.task-sync",
                stream_url,
                error = %format!("{error:#}"),
                "Task event relay lost the MCP bridge task stream"
            );
        }

        sleep_before_retry(&stop_requested);
    }

    Ok(())
}

fn relay_task_event_stream<R: tauri::Runtime>(
    app: &AppHandle<R>,
    response: Response,
    stop_requested: &AtomicBool,
    last_event_id: &mut Option<u64>,
) -> Result<()> {
    let status = response.status();
    if !status.is_success() {
        anyhow::bail!("task event stream returned unexpected status {status}");
    }

    relay_task_event_reader(
        BufReader::new(response),
        stop_requested,
        last_event_id,
        |event| {
            if let Err(error) = app.emit(TASK_EVENT_NAME, event) {
                tracing::error!(
                    target: "openducktor.task-sync",
                    error = %error,
                    "Task event relay failed to emit a desktop task event"
                );
            }
        },
    )
}

fn relay_task_event_reader(
    mut reader: impl BufRead,
    stop_requested: &AtomicBool,
    last_event_id: &mut Option<u64>,
    mut emit: impl FnMut(ExternalTaskSyncEvent),
) -> Result<()> {
    while !stop_requested.load(Ordering::SeqCst) {
        let Some(message) = read_next_sse_message(&mut reader)? else {
            return Ok(());
        };

        if let Some(message_id) = message.id {
            *last_event_id = Some(message_id);
        }

        if message.data.is_empty() {
            continue;
        }

        match serde_json::from_str::<ExternalTaskSyncEvent>(&message.data) {
            Ok(event) => emit(event),
            Err(error) => {
                tracing::error!(
                    target: "openducktor.task-sync",
                    raw_payload = message.data,
                    error = %error,
                    "Task event relay received an invalid task sync payload"
                );
            }
        }
    }

    Ok(())
}

fn read_next_sse_message(reader: &mut impl BufRead) -> Result<Option<SseMessage>> {
    let mut message = SseMessage::default();

    let mut payload_lines = Vec::new();

    loop {
        let mut line = String::new();
        let bytes_read = reader.read_line(&mut line)?;

        if bytes_read == 0 {
            if payload_lines.is_empty() && message.id.is_none() {
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
            let parsed_id = id.trim().parse::<u64>().with_context(|| {
                format!(
                    "invalid task event stream id received from MCP bridge: {}",
                    id.trim()
                )
            })?;
            message.id = Some(parsed_id);
            continue;
        }

        if let Some(payload) = trimmed.strip_prefix("data:") {
            payload_lines.push(payload.trim_start().to_string());
        }
    }
}

fn build_task_event_stream_request<'a>(
    client: &'a Client,
    stream_url: &'a str,
    last_event_id: Option<u64>,
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

fn sleep_before_retry(stop_requested: &AtomicBool) {
    if stop_requested.load(Ordering::SeqCst) {
        return;
    }

    std::thread::sleep(TASK_EVENT_RELAY_RETRY_DELAY);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn build_external_task_created_event_sets_expected_payload_shape() {
        let event = build_external_task_created_event("/repo".to_string(), "task-1".to_string());

        assert_eq!(event.kind, ExternalTaskSyncEventKind::ExternalTaskCreated);
        assert_eq!(event.repo_path, "/repo");
        assert_eq!(event.task_id, "task-1");
        assert!(!event.event_id.is_empty());
        assert!(!event.emitted_at.is_empty());
    }

    #[test]
    fn read_next_sse_message_collects_multiline_data_events_and_event_id() {
        let mut reader = Cursor::new(
            b"id: 7\nevent: message\ndata: {\"one\":1}\ndata: {\"two\":2}\n\n".to_vec(),
        );

        let message = read_next_sse_message(&mut reader)
            .expect("payload should parse")
            .expect("payload should be present");

        assert_eq!(message.id, Some(7));
        assert_eq!(message.data, "{\"one\":1}\n{\"two\":2}");
    }

    #[test]
    fn read_next_sse_message_skips_keepalive_comments() {
        let mut reader = Cursor::new(b": keepalive\n\ndata: {\"ok\":true}\n\n".to_vec());

        let message = read_next_sse_message(&mut reader)
            .expect("payload should parse")
            .expect("payload should be present");

        assert_eq!(message.id, None);
        assert_eq!(message.data, "{\"ok\":true}");
    }

    #[test]
    fn build_task_event_stream_request_includes_last_event_id_for_resume() {
        let client = Client::builder().build().expect("client should build");
        let request =
            build_task_event_stream_request(&client, "http://127.0.0.1:1234/task-events", Some(42))
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

    #[test]
    fn relay_task_event_reader_updates_resume_cursor_and_replays_follow_up_events() {
        let first_event = serde_json::to_string(&build_external_task_created_event(
            "/repo".to_string(),
            "task-1".to_string(),
        ))
        .expect("event should serialize");
        let second_event = serde_json::to_string(&build_external_task_created_event(
            "/repo".to_string(),
            "task-2".to_string(),
        ))
        .expect("event should serialize");

        let stop_requested = AtomicBool::new(false);
        let mut last_event_id = None;
        let mut emitted_task_ids = Vec::new();

        let first_stream = Cursor::new(format!("id: 5\ndata: {first_event}\n\n").into_bytes());
        relay_task_event_reader(first_stream, &stop_requested, &mut last_event_id, |event| {
            emitted_task_ids.push(event.task_id)
        })
        .expect("first stream should relay");

        assert_eq!(last_event_id, Some(5));

        let request = build_task_event_stream_request(
            &Client::builder().build().expect("client should build"),
            "http://127.0.0.1:1234/task-events",
            last_event_id,
        )
        .build()
        .expect("request should build");
        assert_eq!(
            request.headers().get(LAST_EVENT_ID_HEADER.clone()),
            Some(&HeaderValue::from_static("5"))
        );

        let replay_stream = Cursor::new(format!("id: 6\ndata: {second_event}\n\n").into_bytes());
        relay_task_event_reader(
            replay_stream,
            &stop_requested,
            &mut last_event_id,
            |event| emitted_task_ids.push(event.task_id),
        )
        .expect("replay stream should relay");

        assert_eq!(last_event_id, Some(6));
        assert_eq!(
            emitted_task_ids,
            vec!["task-1".to_string(), "task-2".to_string()]
        );
    }
}
