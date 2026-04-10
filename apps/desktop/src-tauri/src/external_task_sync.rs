use anyhow::{Context, Result};
use host_application::AppService;
use host_domain::now_rfc3339;
use reqwest::blocking::{Client, Response};
use reqwest::header::ACCEPT;
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

        let response = match client
            .get(&stream_url)
            .header(ACCEPT, "text/event-stream")
            .send()
        {
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

        if let Err(error) = relay_task_event_stream(&app, response, &stop_requested) {
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
) -> Result<()> {
    let status = response.status();
    if !status.is_success() {
        anyhow::bail!("task event stream returned unexpected status {status}");
    }

    let mut reader = BufReader::new(response);
    while !stop_requested.load(Ordering::SeqCst) {
        let Some(payload) = read_next_sse_payload(&mut reader)? else {
            return Ok(());
        };

        if payload.is_empty() {
            continue;
        }

        match serde_json::from_str::<ExternalTaskSyncEvent>(&payload) {
            Ok(event) => {
                if let Err(error) = app.emit(TASK_EVENT_NAME, event) {
                    tracing::error!(
                        target: "openducktor.task-sync",
                        error = %error,
                        "Task event relay failed to emit a desktop task event"
                    );
                }
            }
            Err(error) => {
                tracing::error!(
                    target: "openducktor.task-sync",
                    raw_payload = payload,
                    error = %error,
                    "Task event relay received an invalid task sync payload"
                );
            }
        }
    }

    Ok(())
}

fn read_next_sse_payload(reader: &mut impl BufRead) -> Result<Option<String>> {
    let mut payload_lines = Vec::new();

    loop {
        let mut line = String::new();
        let bytes_read = reader.read_line(&mut line)?;

        if bytes_read == 0 {
            if payload_lines.is_empty() {
                return Ok(None);
            }

            return Ok(Some(payload_lines.join("\n")));
        }

        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            if payload_lines.is_empty() {
                continue;
            }

            return Ok(Some(payload_lines.join("\n")));
        }

        if let Some(payload) = trimmed.strip_prefix("data:") {
            payload_lines.push(payload.trim_start().to_string());
        }
    }
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
    fn read_next_sse_payload_collects_multiline_data_events() {
        let mut reader =
            Cursor::new(b"event: message\ndata: {\"one\":1}\ndata: {\"two\":2}\n\n".to_vec());

        let payload = read_next_sse_payload(&mut reader)
            .expect("payload should parse")
            .expect("payload should be present");

        assert_eq!(payload, "{\"one\":1}\n{\"two\":2}");
    }

    #[test]
    fn read_next_sse_payload_skips_keepalive_comments() {
        let mut reader = Cursor::new(b": keepalive\n\ndata: {\"ok\":true}\n\n".to_vec());

        let payload = read_next_sse_payload(&mut reader)
            .expect("payload should parse")
            .expect("payload should be present");

        assert_eq!(payload, "{\"ok\":true}");
    }
}
