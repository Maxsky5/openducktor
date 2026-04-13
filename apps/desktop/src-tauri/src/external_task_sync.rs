use crate::sse_relay::{build_sse_stream_request, read_next_sse_message, SseEventId};
use anyhow::{Context, Result};
use host_application::AppService;
use host_domain::now_rfc3339;
use reqwest::blocking::{Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

const TASK_EVENT_STREAM_PATH: &str = "task-events";
const TASK_EVENT_RELAY_RETRY_DELAY: Duration = Duration::from_secs(1);
const TASK_EVENT_RELAY_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
pub(crate) const TASK_EVENT_NAME: &str = "openducktor://task-event";
const STREAM_WARNING_EVENT_NAME: &str = "stream-warning";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct TaskEventControlPayload {
    #[serde(rename = "__openducktorBrowserLive")]
    browser_live: bool,
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ExternalTaskSyncEventKind {
    ExternalTaskCreated,
    TasksUpdated,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalTaskSyncEvent {
    pub(crate) event_id: String,
    pub(crate) kind: ExternalTaskSyncEventKind,
    pub(crate) repo_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) task_ids: Option<Vec<String>>,
    pub(crate) emitted_at: String,
}

pub(crate) struct TaskEventRelayState {
    pub(crate) stop_requested: Arc<AtomicBool>,
}

pub(crate) fn build_external_task_created_event(
    repo_path: String,
    task_id: String,
) -> ExternalTaskSyncEvent {
    ExternalTaskSyncEvent {
        event_id: Uuid::new_v4().to_string(),
        kind: ExternalTaskSyncEventKind::ExternalTaskCreated,
        repo_path,
        task_id: Some(task_id),
        task_ids: None,
        emitted_at: now_rfc3339(),
    }
}

pub(crate) fn build_tasks_updated_event(
    repo_path: String,
    task_ids: Vec<String>,
) -> ExternalTaskSyncEvent {
    ExternalTaskSyncEvent {
        event_id: Uuid::new_v4().to_string(),
        kind: ExternalTaskSyncEventKind::TasksUpdated,
        repo_path,
        task_id: None,
        task_ids: Some(task_ids),
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

    let mut last_event_id: Option<SseEventId> = None;
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

        let response = match build_sse_stream_request(&client, &stream_url, last_event_id).send() {
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
    last_event_id: &mut Option<SseEventId>,
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
    last_event_id: &mut Option<SseEventId>,
    mut emit: impl FnMut(Value),
) -> Result<()> {
    while !stop_requested.load(Ordering::SeqCst) {
        let Some(message) = read_next_sse_message(&mut reader)? else {
            return Ok(());
        };

        if message.event.as_deref() == Some(STREAM_WARNING_EVENT_NAME) {
            emit(task_stream_warning_payload(message.data));
            continue;
        }

        if message.data.is_empty() {
            continue;
        }

        match serde_json::from_str::<ExternalTaskSyncEvent>(&message.data) {
            Ok(event) => {
                if let Some(message_id) = message.id {
                    *last_event_id = Some(message_id);
                }
                emit(serde_json::to_value(event).expect("task sync event should serialize"))
            }
            Err(error) => {
                tracing::error!(
                    target: "openducktor.task-sync",
                    event_type = message.event.as_deref().unwrap_or("message"),
                    raw_payload = message.data,
                    error = %error,
                    "Task event relay received an invalid task sync payload"
                );
            }
        }
    }

    Ok(())
}

fn task_stream_warning_payload(message: String) -> Value {
    serde_json::to_value(TaskEventControlPayload {
        browser_live: true,
        kind: STREAM_WARNING_EVENT_NAME,
        message: Some(message),
    })
    .expect("task stream warning payload should serialize")
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
    use serde_json::json;
    use std::io::Cursor;

    #[test]
    fn build_external_task_created_event_sets_expected_payload_shape() {
        let event = build_external_task_created_event("/repo".to_string(), "task-1".to_string());

        assert_eq!(event.kind, ExternalTaskSyncEventKind::ExternalTaskCreated);
        assert_eq!(event.repo_path, "/repo");
        assert_eq!(event.task_id.as_deref(), Some("task-1"));
        assert_eq!(event.task_ids, None);
        assert!(!event.event_id.is_empty());
        assert!(!event.emitted_at.is_empty());
    }

    #[test]
    fn build_tasks_updated_event_sets_expected_payload_shape() {
        let event = build_tasks_updated_event(
            "/repo".to_string(),
            vec!["task-1".to_string(), "task-2".to_string()],
        );

        assert_eq!(event.kind, ExternalTaskSyncEventKind::TasksUpdated);
        assert_eq!(event.repo_path, "/repo");
        assert_eq!(event.task_id, None);
        assert_eq!(
            event.task_ids,
            Some(vec!["task-1".to_string(), "task-2".to_string()])
        );
        assert!(!event.event_id.is_empty());
        assert!(!event.emitted_at.is_empty());
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
        let mut emitted_payloads = Vec::new();

        let first_stream = Cursor::new(format!("id: 5\ndata: {first_event}\n\n").into_bytes());
        relay_task_event_reader(
            first_stream,
            &stop_requested,
            &mut last_event_id,
            |payload| emitted_payloads.push(payload),
        )
        .expect("first stream should relay");

        assert_eq!(last_event_id, Some(5));

        let request = build_sse_stream_request(
            &Client::builder().build().expect("client should build"),
            "http://127.0.0.1:1234/task-events",
            last_event_id,
        )
        .build()
        .expect("request should build");
        assert_eq!(
            request.headers().get("last-event-id"),
            Some(&"5".parse().expect("header should parse"))
        );

        let replay_stream = Cursor::new(format!("id: 6\ndata: {second_event}\n\n").into_bytes());
        relay_task_event_reader(
            replay_stream,
            &stop_requested,
            &mut last_event_id,
            |payload| emitted_payloads.push(payload),
        )
        .expect("replay stream should relay");

        assert_eq!(last_event_id, Some(6));
        assert_eq!(
            emitted_payloads,
            vec![
                json!({
                    "eventId": serde_json::from_str::<Value>(&first_event)
                        .expect("first event should deserialize")["eventId"],
                    "kind": "external_task_created",
                    "repoPath": "/repo",
                    "taskId": "task-1",
                    "emittedAt": serde_json::from_str::<Value>(&first_event)
                        .expect("first event should deserialize")["emittedAt"],
                }),
                json!({
                    "eventId": serde_json::from_str::<Value>(&second_event)
                        .expect("second event should deserialize")["eventId"],
                    "kind": "external_task_created",
                    "repoPath": "/repo",
                    "taskId": "task-2",
                    "emittedAt": serde_json::from_str::<Value>(&second_event)
                        .expect("second event should deserialize")["emittedAt"],
                })
            ]
        );
    }

    #[test]
    fn relay_task_event_reader_relays_tasks_updated_payloads() {
        let event = serde_json::to_string(&build_tasks_updated_event(
            "/repo".to_string(),
            vec!["task-1".to_string(), "task-2".to_string()],
        ))
        .expect("event should serialize");
        let stop_requested = AtomicBool::new(false);
        let mut last_event_id = None;
        let mut emitted_payloads = Vec::new();

        let stream = Cursor::new(format!("id: 9\ndata: {event}\n\n").into_bytes());
        relay_task_event_reader(stream, &stop_requested, &mut last_event_id, |payload| {
            emitted_payloads.push(payload)
        })
        .expect("stream should relay");

        assert_eq!(last_event_id, Some(9));
        assert_eq!(emitted_payloads.len(), 1);
        assert_eq!(emitted_payloads[0]["kind"], json!("tasks_updated"));
        assert_eq!(emitted_payloads[0]["taskIds"], json!(["task-1", "task-2"]));
    }

    #[test]
    fn relay_task_event_reader_does_not_advance_resume_cursor_for_partial_id_only_eof() {
        let stop_requested = AtomicBool::new(false);
        let mut last_event_id = Some(5);
        let mut emitted_payloads = Vec::new();

        let partial_stream = Cursor::new(b"id: 6\n".to_vec());
        relay_task_event_reader(
            partial_stream,
            &stop_requested,
            &mut last_event_id,
            |payload| emitted_payloads.push(payload),
        )
        .expect("partial stream should be ignored without failing");

        assert_eq!(last_event_id, Some(5));
        assert!(emitted_payloads.is_empty());

        let request = build_sse_stream_request(
            &Client::builder().build().expect("client should build"),
            "http://127.0.0.1:1234/task-events",
            last_event_id,
        )
        .build()
        .expect("request should build");
        assert_eq!(
            request.headers().get("last-event-id"),
            Some(&"5".parse().expect("header should parse"))
        );
    }

    #[test]
    fn relay_task_event_reader_emits_stream_warning_control_payload() {
        let stop_requested = AtomicBool::new(false);
        let mut last_event_id = Some(5);
        let mut emitted_payloads = Vec::new();

        let warning_stream = Cursor::new(
            b"event: stream-warning\ndata: task-events skipped 2 events; reconnect will replay buffered events.\n\n"
                .to_vec(),
        );
        relay_task_event_reader(
            warning_stream,
            &stop_requested,
            &mut last_event_id,
            |payload| emitted_payloads.push(payload),
        )
        .expect("warning stream should relay");

        assert_eq!(last_event_id, Some(5));
        assert_eq!(
            emitted_payloads,
            vec![json!({
                "__openducktorBrowserLive": true,
                "kind": "stream-warning",
                "message": "task-events skipped 2 events; reconnect will replay buffered events.",
            })]
        );
    }
}
