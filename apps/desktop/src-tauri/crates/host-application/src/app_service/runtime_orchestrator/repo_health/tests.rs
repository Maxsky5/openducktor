use super::repo_runtime_is_within_mcp_startup_grace_window;
use super::*;
use crate::app_service::runtime_registry::{
    ResolvedRuntimeMcpStatus, RuntimeHealthHttpClient, RuntimeMcpServerStatus,
};
use crate::app_service::test_support::builtin_opencode_runtime_descriptor;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;

fn runtime_summary(started_at: &str) -> RuntimeInstanceSummary {
    RuntimeInstanceSummary {
        kind: AgentRuntimeKind::opencode(),
        runtime_id: "runtime-1".to_string(),
        repo_path: "/tmp/repo".to_string(),
        task_id: None,
        role: host_domain::RuntimeRole::Workspace,
        working_directory: "/tmp/repo".to_string(),
        runtime_route: RuntimeRoute::LocalHttp {
            endpoint: "http://127.0.0.1:4321".to_string(),
        },
        started_at: started_at.to_string(),
        descriptor: builtin_opencode_runtime_descriptor(),
    }
}

#[test]
fn load_mcp_status_does_not_wait_for_socket_close() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let port = listener
        .local_addr()
        .expect("listener should expose local addr")
        .port();
    let (request_tx, request_rx) = mpsc::channel::<String>();
    let (release_tx, release_rx) = mpsc::channel::<()>();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().expect("server should accept one client");
        let mut request_buffer = [0_u8; 4096];
        let size = stream
            .read(&mut request_buffer)
            .expect("server should read request");
        request_tx
            .send(String::from_utf8_lossy(&request_buffer[..size]).to_string())
            .expect("server should publish request");

        let body = r#"{"openducktor":{"status":"connected"}}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: keep-alive\r\n\r\n{body}",
            body.len()
        );
        stream
            .write_all(response.as_bytes())
            .expect("server should write response");
        stream.flush().expect("server should flush response");

        release_rx
            .recv()
            .expect("test should release keep-alive connection");
    });

    let status_by_server =
        RuntimeHealthHttpClient::new(format!("http://127.0.0.1:{port}").as_str())
            .load_mcp_status("/tmp/repo-health-ready")
            .expect("mcp status should load before socket close");

    let request = request_rx
        .recv()
        .expect("test should capture the outbound request");
    assert!(request.starts_with("GET /mcp?directory=%2Ftmp%2Frepo-health-ready "));
    assert_eq!(
        status_by_server,
        HashMap::from([(
            "openducktor".to_string(),
            RuntimeMcpServerStatus {
                status: "connected".to_string(),
                error: None,
            },
        )])
    );

    release_tx
        .send(())
        .expect("test should release the server thread");
    server.join().expect("server thread should exit cleanly");
}

#[test]
fn load_mcp_status_keeps_connect_errors_as_hard_failures_before_runtime_context() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener should bind");
    let port = listener
        .local_addr()
        .expect("listener should expose local addr")
        .port();
    drop(listener);

    let failure = RuntimeHealthHttpClient::new(format!("http://127.0.0.1:{port}").as_str())
        .load_mcp_status("/tmp/repo-health-not-ready")
        .expect_err("connect errors should surface as failures");

    assert_eq!(failure.failure_kind, RepoRuntimeStartupFailureKind::Error);
    assert!(failure.is_connect_failure);
}

#[test]
fn mcp_startup_grace_window_allows_recent_runtime_connect_failures_to_retry() {
    let runtime = runtime_summary("2026-04-11T10:00:00Z");

    assert!(repo_runtime_is_within_mcp_startup_grace_window(
        &runtime,
        None,
        "2026-04-11T10:00:08Z"
    ));
}

#[test]
fn mcp_startup_grace_window_expires_for_stale_runtime_routes() {
    let runtime = runtime_summary("2026-04-11T10:00:00Z");

    assert!(!repo_runtime_is_within_mcp_startup_grace_window(
        &runtime,
        None,
        "2026-04-11T10:00:21Z"
    ));
}

#[test]
fn mcp_startup_grace_window_stays_retryable_while_host_reports_runtime_starting() {
    let runtime = runtime_summary("2026-04-11T10:00:00Z");
    let host_status = RepoRuntimeStartupStatus {
        runtime_kind: AgentRuntimeKind::opencode(),
        repo_path: "/tmp/repo".to_string(),
        stage: RepoRuntimeStartupStage::WaitingForRuntime,
        runtime: None,
        started_at: Some("2026-04-11T10:00:00Z".to_string()),
        updated_at: "2026-04-11T10:00:45Z".to_string(),
        elapsed_ms: Some(45_000),
        attempts: Some(6),
        failure_kind: None,
        failure_reason: None,
        detail: None,
    };

    assert!(repo_runtime_is_within_mcp_startup_grace_window(
        &runtime,
        Some(&host_status),
        "2026-04-11T10:00:45Z"
    ));
}

#[test]
fn normalize_mcp_server_status_downgrades_failed_status_within_startup_grace() {
    let runtime = runtime_summary("2026-04-11T10:00:00Z");
    let status = AppService::repo_runtime_normalize_mcp_server_status(
        &runtime,
        None,
        "2026-04-11T10:00:08Z",
        ResolvedRuntimeMcpStatus::unavailable(
            Some("failed".to_string()),
            "Connection closed".to_string(),
        ),
    );

    assert_eq!(
        status.failure_kind,
        Some(RepoRuntimeStartupFailureKind::Timeout)
    );
    assert_eq!(status.status.as_deref(), Some("failed"));
}

#[test]
fn normalize_mcp_server_status_keeps_failed_status_hard_after_startup_grace() {
    let runtime = runtime_summary("2026-04-11T10:00:00Z");
    let status = AppService::repo_runtime_normalize_mcp_server_status(
        &runtime,
        None,
        "2026-04-11T10:00:21Z",
        ResolvedRuntimeMcpStatus::unavailable(
            Some("failed".to_string()),
            "Connection closed".to_string(),
        ),
    );

    assert_eq!(
        status.failure_kind,
        Some(RepoRuntimeStartupFailureKind::Error)
    );
    assert_eq!(status.status.as_deref(), Some("failed"));
}
