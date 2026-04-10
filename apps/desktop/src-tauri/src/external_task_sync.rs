use crate::sse_relay::{build_sse_stream_request, read_next_sse_message, SseEventId};
use anyhow::{Context, Result};
use host_application::AppService;
use host_domain::now_rfc3339;
use reqwest::blocking::{Client, Response};
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
    mut emit: impl FnMut(ExternalTaskSyncEvent),
) -> Result<()> {
    while !stop_requested.load(Ordering::SeqCst) {
        let Some(message) = read_next_sse_message(&mut reader)? else {
            return Ok(());
        };

        if message.data.is_empty() {
            continue;
        }

        match serde_json::from_str::<ExternalTaskSyncEvent>(&message.data) {
            Ok(event) => {
                if let Some(message_id) = message.id {
                    *last_event_id = Some(message_id);
                }
                emit(event)
            }
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
            |event| emitted_task_ids.push(event.task_id),
        )
        .expect("replay stream should relay");

        assert_eq!(last_event_id, Some(6));
        assert_eq!(
            emitted_task_ids,
            vec!["task-1".to_string(), "task-2".to_string()]
        );
    }

    #[test]
    fn relay_task_event_reader_does_not_advance_resume_cursor_for_partial_id_only_eof() {
        let stop_requested = AtomicBool::new(false);
        let mut last_event_id = Some(5);
        let mut emitted_task_ids = Vec::new();

        let partial_stream = Cursor::new(b"id: 6\n".to_vec());
        relay_task_event_reader(
            partial_stream,
            &stop_requested,
            &mut last_event_id,
            |event| emitted_task_ids.push(event.task_id),
        )
        .expect("partial stream should be ignored without failing");

        assert_eq!(last_event_id, Some(5));
        assert!(emitted_task_ids.is_empty());

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
}
