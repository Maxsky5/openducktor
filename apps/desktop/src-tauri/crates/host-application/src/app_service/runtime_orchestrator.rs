mod ensure_flight;
mod registry;
mod repo_health;
mod repo_health_snapshot;
mod start_pipeline;
mod startup;
mod startup_status;
mod workspace_runtime;

pub(crate) use self::start_pipeline::RuntimeStartInput;
pub(in crate::app_service) use self::startup_status::RuntimeStartupProgress;

use super::AppService;
use anyhow::{anyhow, Result};
use host_domain::{AgentRuntimeKind, RuntimeDescriptor, RuntimeInstanceSummary};

impl AppService {
    pub(super) fn ensure_runtime_supports_all_workflow_scopes(
        &self,
        runtime_kind: AgentRuntimeKind,
    ) -> Result<()> {
        let descriptor = self
            .runtime_registry
            .definition(&runtime_kind)?
            .descriptor();
        let validation_errors = descriptor.validate_for_openducktor();
        if validation_errors.is_empty() {
            return Ok(());
        }

        Err(anyhow!(
            "Runtime '{}' is incompatible with OpenDucktor: {}.",
            runtime_kind.as_str(),
            validation_errors.join("; "),
        ))
    }

    pub fn runtime_definitions_list(&self) -> Result<Vec<RuntimeDescriptor>> {
        Ok(self
            .runtime_registry
            .definitions()
            .into_iter()
            .map(|definition| definition.descriptor().clone())
            .collect::<Vec<_>>())
    }

    pub fn runtime_list(
        &self,
        runtime_kind: &str,
        repo_path: Option<&str>,
    ) -> Result<Vec<RuntimeInstanceSummary>> {
        let supported_kind = self.resolve_supported_runtime_kind(runtime_kind)?;
        Ok(self
            .list_registered_runtimes(repo_path)?
            .into_iter()
            .filter(|runtime| runtime.kind == supported_kind)
            .collect())
    }

    pub fn runtime_ensure(
        &self,
        runtime_kind: &str,
        repo_path: &str,
    ) -> Result<RuntimeInstanceSummary> {
        let runtime_kind = self.resolve_supported_runtime_kind(runtime_kind)?;
        self.ensure_runtime_supports_all_workflow_scopes(runtime_kind.clone())?;
        self.ensure_workspace_runtime(runtime_kind, repo_path)
    }

    pub fn runtime_stop(&self, runtime_id: &str) -> Result<bool> {
        self.stop_registered_runtime(runtime_id)
    }

    pub(super) fn resolve_supported_runtime_kind(
        &self,
        runtime_kind: &str,
    ) -> Result<AgentRuntimeKind> {
        self.runtime_registry.resolve_kind(runtime_kind)
    }
}

#[cfg(test)]
mod tests {
    use super::AppService;
    use crate::app_service::test_support::{
        build_service_with_state, builtin_opencode_runtime_descriptor,
    };
    use crate::app_service::AgentRuntimeProcess;
    use anyhow::Result;
    use chrono::{TimeDelta, Utc};
    use host_domain::{
        now_rfc3339, AgentRuntimeKind, RepoRuntimeHealthMcp, RepoRuntimeHealthObservation,
        RepoRuntimeHealthRuntime, RepoRuntimeHealthState, RepoRuntimeMcpStatus,
        RepoRuntimeStartupFailureKind, RepoRuntimeStartupStage, RuntimeRoute,
    };
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::process::Command;
    use std::time::{Duration, Instant};

    fn spawn_runtime_http_server(
        responses: Vec<String>,
    ) -> Result<(u16, std::thread::JoinHandle<Vec<String>>)> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        let handle = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for response in responses {
                if let Ok((mut stream, _)) = listener.accept() {
                    let mut request_buffer = [0_u8; 4096];
                    let size = stream.read(&mut request_buffer).unwrap_or(0);
                    requests.push(String::from_utf8_lossy(&request_buffer[..size]).to_string());
                    let _ = stream.write_all(response.as_bytes());
                    let _ = stream.flush();
                }
            }
            requests
        });
        Ok((port, handle))
    }

    fn spawn_runtime_http_server_until_idle(
        responses: Vec<String>,
        idle_timeout: Duration,
    ) -> Result<(u16, std::thread::JoinHandle<Vec<String>>)> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let handle = std::thread::spawn(move || {
            let mut requests = Vec::new();
            let mut responses = responses.into_iter();
            let mut last_activity = Instant::now();

            loop {
                match listener.accept() {
                    Ok((mut stream, _)) => {
                        let mut request_buffer = [0_u8; 4096];
                        let size = stream.read(&mut request_buffer).unwrap_or(0);
                        requests.push(String::from_utf8_lossy(&request_buffer[..size]).to_string());
                        if let Some(response) = responses.next() {
                            let _ = stream.write_all(response.as_bytes());
                            let _ = stream.flush();
                        }
                        last_activity = Instant::now();
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if requests.is_empty() || last_activity.elapsed() < idle_timeout {
                            std::thread::sleep(Duration::from_millis(10));
                            continue;
                        }
                        break;
                    }
                    Err(_) => break,
                }
            }

            requests
        });
        Ok((port, handle))
    }

    fn runtime_http_response(status_line: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn insert_workspace_runtime(
        service: &AppService,
        runtime: host_domain::RuntimeInstanceSummary,
    ) -> Result<()> {
        let child = Command::new("/bin/sh")
            .arg("-lc")
            .arg("sleep 30")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()?;
        service
            .agent_runtimes
            .lock()
            .expect("agent runtimes lock poisoned")
            .insert(
                runtime.runtime_id.clone(),
                AgentRuntimeProcess {
                    summary: runtime,
                    child: Some(child),
                    _runtime_process_guard: None,
                    cleanup_target: None,
                },
            );
        Ok(())
    }

    #[test]
    fn repo_runtime_health_reports_ready_connected_runtime() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, server_handle) = spawn_runtime_http_server(vec![
            runtime_http_response("200 OK", r#"{"openducktor":{"status":"connected"}}"#),
            runtime_http_response("200 OK", r#"["odt_read_task"]"#),
        ])?;
        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::opencode(),
            runtime_id: "runtime-ready".to_string(),
            repo_path: "/tmp/repo-health-ready".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-ready".to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: format!("http://127.0.0.1:{port}"),
            },
            started_at: "2026-04-04T16:00:00Z".to_string(),
            descriptor: builtin_opencode_runtime_descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;

        let health = service.repo_runtime_health("opencode", "/tmp/repo-health-ready")?;
        let requests = server_handle.join().expect("server thread should finish");

        assert!(requests[0].starts_with("GET /mcp?directory=%2Ftmp%2Frepo-health-ready "));
        assert!(requests[1]
            .starts_with("GET /experimental/tool/ids?directory=%2Ftmp%2Frepo-health-ready "));
        assert_eq!(health.status, RepoRuntimeHealthState::Ready);
        assert_eq!(health.runtime.status, RepoRuntimeHealthState::Ready);
        assert_eq!(
            health.runtime.observation,
            Some(RepoRuntimeHealthObservation::ObservedExistingRuntime)
        );
        assert_eq!(
            health.mcp.as_ref().map(|value| value.status),
            Some(RepoRuntimeMcpStatus::Connected)
        );
        assert_eq!(
            health.mcp.as_ref().map(|value| value.tool_ids.clone()),
            Some(vec!["odt_read_task".to_string()])
        );
        service.runtime_stop(runtime.runtime_id.as_str())?;
        Ok(())
    }

    #[test]
    fn repo_runtime_health_reconnects_disconnected_mcp() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, server_handle) = spawn_runtime_http_server(vec![
            runtime_http_response(
                "200 OK",
                r#"{"openducktor":{"status":"disconnected","error":"not connected"}}"#,
            ),
            runtime_http_response("200 OK", r#"true"#),
            runtime_http_response("200 OK", r#"{"openducktor":{"status":"connected"}}"#),
            runtime_http_response("200 OK", r#"["odt_read_task"]"#),
        ])?;
        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::opencode(),
            runtime_id: "runtime-reconnect".to_string(),
            repo_path: "/tmp/repo-health-reconnect".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-reconnect".to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: format!("http://127.0.0.1:{port}"),
            },
            started_at: "2026-04-04T16:00:00Z".to_string(),
            descriptor: builtin_opencode_runtime_descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;

        let health = service.repo_runtime_health("opencode", "/tmp/repo-health-reconnect")?;
        let requests = server_handle.join().expect("server thread should finish");

        assert!(requests[1].starts_with(
            "POST /mcp/openducktor/connect?directory=%2Ftmp%2Frepo-health-reconnect "
        ));
        assert_eq!(health.status, RepoRuntimeHealthState::Ready);
        assert_eq!(
            health.mcp.as_ref().map(|value| value.status),
            Some(RepoRuntimeMcpStatus::Connected)
        );
        assert_eq!(
            health.mcp.as_ref().map(|value| value.tool_ids.clone()),
            Some(vec!["odt_read_task".to_string()])
        );
        service.runtime_stop(runtime.runtime_id.as_str())?;
        Ok(())
    }

    #[test]
    fn repo_runtime_health_returns_structured_failure_when_refresh_after_reconnect_fails(
    ) -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, server_handle) = spawn_runtime_http_server(vec![
            runtime_http_response(
                "200 OK",
                r#"{"openducktor":{"status":"disconnected","error":"not connected"}}"#,
            ),
            runtime_http_response("200 OK", r#"true"#),
            runtime_http_response(
                "504 Gateway Timeout",
                r#"{"error":{"message":"status probe timed out"}}"#,
            ),
        ])?;
        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::opencode(),
            runtime_id: "runtime-refresh-failure".to_string(),
            repo_path: "/tmp/repo-health-refresh-failure".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-refresh-failure".to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: format!("http://127.0.0.1:{port}"),
            },
            started_at: "2026-04-04T16:00:00Z".to_string(),
            descriptor: builtin_opencode_runtime_descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;

        let health = service.repo_runtime_health("opencode", "/tmp/repo-health-refresh-failure")?;
        let requests = server_handle.join().expect("server thread should finish");

        assert!(requests[1].starts_with(
            "POST /mcp/openducktor/connect?directory=%2Ftmp%2Frepo-health-refresh-failure "
        ));
        assert_eq!(health.runtime.status, RepoRuntimeHealthState::Ready);
        assert_eq!(health.status, RepoRuntimeHealthState::Checking);
        assert_eq!(
            health.mcp.as_ref().map(|value| value.status),
            Some(RepoRuntimeMcpStatus::Reconnecting)
        );
        assert!(health
            .mcp
            .as_ref()
            .and_then(|value| value.detail.as_deref())
            .is_some_and(
                |value| value.contains("Failed to refresh runtime MCP status after reconnect")
            ));
        service.runtime_stop(runtime.runtime_id.as_str())?;
        Ok(())
    }

    #[test]
    fn repo_runtime_health_keeps_startup_failed_mcp_checking_within_grace_window() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let started_at = (Utc::now() - TimeDelta::milliseconds(9_300)).to_rfc3339();
        let (port, server_handle) = spawn_runtime_http_server_until_idle(
            vec![
                runtime_http_response(
                    "200 OK",
                    r#"{"openducktor":{"status":"failed","error":"MCP error -32000: Connection closed"}}"#,
                ),
                runtime_http_response("200 OK", r#"true"#),
                runtime_http_response(
                    "200 OK",
                    r#"{"openducktor":{"status":"failed","error":"MCP error -32000: Connection closed"}}"#,
                ),
                runtime_http_response(
                    "200 OK",
                    r#"{"openducktor":{"status":"failed","error":"MCP error -32000: Connection closed"}}"#,
                ),
                runtime_http_response(
                    "200 OK",
                    r#"{"openducktor":{"status":"failed","error":"MCP error -32000: Connection closed"}}"#,
                ),
                runtime_http_response(
                    "200 OK",
                    r#"{"openducktor":{"status":"failed","error":"MCP error -32000: Connection closed"}}"#,
                ),
                runtime_http_response(
                    "200 OK",
                    r#"{"openducktor":{"status":"failed","error":"MCP error -32000: Connection closed"}}"#,
                ),
                runtime_http_response(
                    "200 OK",
                    r#"{"openducktor":{"status":"failed","error":"MCP error -32000: Connection closed"}}"#,
                ),
                runtime_http_response(
                    "200 OK",
                    r#"{"openducktor":{"status":"failed","error":"MCP error -32000: Connection closed"}}"#,
                ),
            ],
            Duration::from_millis(150),
        )?;
        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::opencode(),
            runtime_id: "runtime-startup-failed-mcp".to_string(),
            repo_path: "/tmp/repo-health-startup-failed-mcp".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-startup-failed-mcp".to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: format!("http://127.0.0.1:{port}"),
            },
            started_at,
            descriptor: builtin_opencode_runtime_descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;

        let health =
            service.repo_runtime_health("opencode", "/tmp/repo-health-startup-failed-mcp")?;
        let requests = server_handle.join().expect("server thread should finish");

        assert!(requests[1].starts_with(
            "POST /mcp/openducktor/connect?directory=%2Ftmp%2Frepo-health-startup-failed-mcp "
        ));
        assert_eq!(health.runtime.status, RepoRuntimeHealthState::Ready);
        assert_eq!(health.status, RepoRuntimeHealthState::Checking);
        assert_eq!(
            health.mcp.as_ref().map(|value| value.status),
            Some(RepoRuntimeMcpStatus::Reconnecting)
        );
        assert_eq!(
            health.mcp.as_ref().and_then(|value| value.failure_kind),
            Some(RepoRuntimeStartupFailureKind::Timeout)
        );
        assert_eq!(
            health.mcp.as_ref().map(|value| value.tool_ids.clone()),
            Some(Vec::new())
        );
        service.runtime_stop(runtime.runtime_id.as_str())?;
        Ok(())
    }

    #[test]
    fn repo_runtime_health_recovers_after_startup_failed_status_retries() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let started_at = now_rfc3339();
        let (port, server_handle) = spawn_runtime_http_server(vec![
            runtime_http_response(
                "200 OK",
                r#"{"openducktor":{"status":"failed","error":"MCP error -32000: Connection closed"}}"#,
            ),
            runtime_http_response("200 OK", r#"true"#),
            runtime_http_response(
                "200 OK",
                r#"{"openducktor":{"status":"failed","error":"MCP error -32000: Connection closed"}}"#,
            ),
            runtime_http_response(
                "200 OK",
                r#"{"openducktor":{"status":"failed","error":"MCP error -32000: Connection closed"}}"#,
            ),
            runtime_http_response("200 OK", r#"{"openducktor":{"status":"connected"}}"#),
            runtime_http_response("200 OK", r#"["odt_read_task"]"#),
        ])?;
        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::opencode(),
            runtime_id: "runtime-startup-retry-success".to_string(),
            repo_path: "/tmp/repo-health-startup-retry-success".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-startup-retry-success".to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: format!("http://127.0.0.1:{port}"),
            },
            started_at,
            descriptor: builtin_opencode_runtime_descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;

        let health =
            service.repo_runtime_health("opencode", "/tmp/repo-health-startup-retry-success")?;
        let requests = server_handle.join().expect("server thread should finish");

        assert!(requests[1].starts_with(
            "POST /mcp/openducktor/connect?directory=%2Ftmp%2Frepo-health-startup-retry-success "
        ));
        assert_eq!(health.status, RepoRuntimeHealthState::Ready);
        assert_eq!(
            health.mcp.as_ref().map(|value| value.status),
            Some(RepoRuntimeMcpStatus::Connected)
        );
        assert_eq!(
            health.mcp.as_ref().map(|value| value.tool_ids.clone()),
            Some(vec!["odt_read_task".to_string()])
        );
        service.runtime_stop(runtime.runtime_id.as_str())?;
        Ok(())
    }

    #[test]
    fn repo_runtime_health_reports_mcp_error_when_tool_ids_fail() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, server_handle) = spawn_runtime_http_server(vec![
            runtime_http_response("200 OK", r#"{"openducktor":{"status":"connected"}}"#),
            runtime_http_response(
                "504 Gateway Timeout",
                r#"{"error":{"message":"tool ids timed out"}}"#,
            ),
        ])?;
        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::opencode(),
            runtime_id: "runtime-tool-ids-failure".to_string(),
            repo_path: "/tmp/repo-health-tool-ids-failure".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-tool-ids-failure".to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: format!("http://127.0.0.1:{port}"),
            },
            started_at: "2026-04-04T16:00:00Z".to_string(),
            descriptor: builtin_opencode_runtime_descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;

        let health =
            service.repo_runtime_health("opencode", "/tmp/repo-health-tool-ids-failure")?;
        let requests = server_handle.join().expect("server thread should finish");

        assert!(
            requests[0].starts_with("GET /mcp?directory=%2Ftmp%2Frepo-health-tool-ids-failure ")
        );
        assert!(requests[1].starts_with(
            "GET /experimental/tool/ids?directory=%2Ftmp%2Frepo-health-tool-ids-failure "
        ));
        assert_eq!(health.runtime.status, RepoRuntimeHealthState::Ready);
        assert_eq!(health.status, RepoRuntimeHealthState::Error);
        assert_eq!(
            health.mcp.as_ref().map(|value| value.status),
            Some(RepoRuntimeMcpStatus::Error)
        );
        assert!(health
            .mcp
            .as_ref()
            .and_then(|value| value.detail.as_deref())
            .is_some_and(|value| value.contains("Failed to load runtime MCP tool ids")));
        assert_eq!(
            health.mcp.as_ref().map(|value| value.tool_ids.clone()),
            Some(Vec::new())
        );
        service.runtime_stop(runtime.runtime_id.as_str())?;
        Ok(())
    }

    #[test]
    fn stop_registered_runtime_preserving_repo_health_keeps_restart_snapshot() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::opencode(),
            runtime_id: "runtime-preserve-health".to_string(),
            repo_path: "/tmp/repo-health-preserve".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-preserve".to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: "http://127.0.0.1:9998".to_string(),
            },
            started_at: "2026-04-04T16:00:00Z".to_string(),
            descriptor: builtin_opencode_runtime_descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;
        service
            .repo_runtime_health_snapshots
            .lock()
            .expect("repo runtime health snapshots lock poisoned")
            .insert(
                AppService::runtime_ensure_flight_key(
                    &AgentRuntimeKind::opencode(),
                    "/tmp/repo-health-preserve",
                ),
                host_domain::RepoRuntimeHealthCheck {
                    status: host_domain::RepoRuntimeHealthState::Checking,
                    checked_at: "2026-04-04T16:00:01Z".to_string(),
                    runtime: RepoRuntimeHealthRuntime {
                        status: host_domain::RepoRuntimeHealthState::Checking,
                        stage: RepoRuntimeStartupStage::StartupRequested,
                        observation: Some(RepoRuntimeHealthObservation::RestartedForMcp),
                        instance: Some(runtime.clone()),
                        started_at: Some("2026-04-04T16:00:00Z".to_string()),
                        updated_at: "2026-04-04T16:00:01Z".to_string(),
                        elapsed_ms: None,
                        attempts: None,
                        detail: Some("Restarting runtime".to_string()),
                        failure_kind: Some(RepoRuntimeStartupFailureKind::Error),
                        failure_reason: None,
                    },
                    mcp: Some(RepoRuntimeHealthMcp {
                        supported: true,
                        status: RepoRuntimeMcpStatus::WaitingForRuntime,
                        server_name: "openducktor".to_string(),
                        server_status: None,
                        tool_ids: Vec::new(),
                        detail: Some("Restarting runtime".to_string()),
                        failure_kind: Some(RepoRuntimeStartupFailureKind::Error),
                    }),
                },
            );

        service.stop_registered_runtime_preserving_repo_health(runtime.runtime_id.as_str())?;

        let health = service.repo_runtime_health_status("opencode", "/tmp/repo-health-preserve")?;
        assert_eq!(health.status, RepoRuntimeHealthState::Checking);
        assert!(health.runtime.instance.is_some());
        Ok(())
    }

    #[test]
    fn repo_runtime_health_status_describes_idle_runtime() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        let health = service.repo_runtime_health_status("opencode", "/tmp/repo-health-idle")?;

        assert_eq!(health.status, RepoRuntimeHealthState::Idle);
        assert_eq!(health.runtime.status, RepoRuntimeHealthState::Idle);
        assert_eq!(
            health.runtime.detail.as_deref(),
            Some("Runtime has not been started yet.")
        );

        Ok(())
    }

    #[test]
    fn repo_runtime_health_reports_stdio_routes_as_unsupported_for_mcp_checks() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::opencode(),
            runtime_id: "runtime-stdio-health".to_string(),
            repo_path: "/tmp/repo-health-stdio".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-stdio".to_string(),
            runtime_route: RuntimeRoute::Stdio,
            started_at: "2026-04-04T16:00:00Z".to_string(),
            descriptor: builtin_opencode_runtime_descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;

        let health = service.repo_runtime_health("opencode", "/tmp/repo-health-stdio")?;

        assert_eq!(
            health
                .runtime
                .instance
                .as_ref()
                .map(|value| value.runtime_id.as_str()),
            Some(runtime.runtime_id.as_str())
        );
        assert_eq!(
            health
                .runtime
                .instance
                .as_ref()
                .map(|value| value.repo_path.as_str()),
            Some(runtime.repo_path.as_str())
        );
        assert_eq!(health.runtime.status, RepoRuntimeHealthState::Ready);
        assert_eq!(health.status, RepoRuntimeHealthState::Error);
        assert_eq!(
            health.mcp.as_ref().map(|value| value.status),
            Some(RepoRuntimeMcpStatus::Error)
        );
        assert!(health
            .mcp
            .as_ref()
            .and_then(|value| value.detail.as_deref())
            .is_some_and(|value| value.contains("local_http runtime route")));
        service.runtime_stop(runtime.runtime_id.as_str())?;

        Ok(())
    }

    #[test]
    fn module_runtime_stop_reports_missing_runtime() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        let error = service
            .runtime_stop("missing-runtime")
            .expect_err("stopping unknown runtime should fail");

        assert!(error
            .to_string()
            .contains("Runtime not found: missing-runtime"));
    }

    #[test]
    fn module_shutdown_succeeds_when_no_processes_are_running() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        service
            .shutdown()
            .expect("shutdown should be idempotent for empty state");
    }
}
