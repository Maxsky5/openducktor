mod ensure_flight;
mod registry;
mod repo_health;
mod repo_health_snapshot;
mod start_pipeline;
mod startup;
mod startup_status;
mod workspace_runtime;

use super::AppService;
use anyhow::{anyhow, Result};
use host_domain::{
    AgentRuntimeKind, RunState, RunSummary, RuntimeDescriptor, RuntimeInstanceSummary, RuntimeRole,
};
use std::collections::{HashMap, HashSet};

#[derive(Clone)]
struct RunExposureCandidate {
    summary: RunSummary,
    repo_path: String,
    task_id: String,
    worktree_path: String,
}

impl RunExposureCandidate {
    fn from_run(run: &super::RunProcess) -> Self {
        Self {
            summary: run.summary.clone(),
            repo_path: run.repo_path.clone(),
            task_id: run.task_id.clone(),
            worktree_path: run.worktree_path.clone(),
        }
    }

    fn requires_live_session_check(&self) -> bool {
        matches!(
            self.summary.state,
            RunState::Starting
                | RunState::Running
                | RunState::Blocked
                | RunState::AwaitingDoneConfirmation
        )
    }
}

struct RunExposurePlan {
    summary: RunSummary,
    external_session_ids: Vec<String>,
    probe_target: Option<super::RuntimeSessionStatusProbeTarget>,
}

impl RunExposurePlan {
    fn without_probe(summary: RunSummary) -> Self {
        Self {
            summary,
            external_session_ids: Vec::new(),
            probe_target: None,
        }
    }

    fn with_probe(
        summary: RunSummary,
        external_session_ids: Vec<String>,
        probe_target: super::RuntimeSessionStatusProbeTarget,
    ) -> Self {
        Self {
            summary,
            external_session_ids,
            probe_target: Some(probe_target),
        }
    }

    fn is_visible(
        &self,
        statuses_by_target: &HashMap<
            super::RuntimeSessionStatusProbeTarget,
            super::RuntimeSessionStatusMap,
        >,
    ) -> Result<bool> {
        let Some(probe_target) = self.probe_target.as_ref() else {
            return Ok(true);
        };

        let statuses = statuses_by_target.get(probe_target).ok_or_else(|| {
            anyhow!(
                "Missing cached runtime session statuses for run {}",
                self.summary.run_id
            )
        })?;
        Ok(self.external_session_ids.iter().any(|external_session_id| {
            super::has_live_runtime_session_status(statuses, external_session_id)
        }))
    }
}

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

    pub fn runs_list(&self, repo_path: Option<&str>) -> Result<Vec<RunSummary>> {
        let repo_key_filter = repo_path
            .map(|path| self.resolve_authorized_repo_path(path))
            .transpose()?;
        let allowlisted_repo_keys = if repo_key_filter.is_none() && self.enforce_repo_allowlist {
            Some(
                self.config_store
                    .list_workspaces()?
                    .into_iter()
                    .map(|workspace| workspace.path)
                    .collect::<HashSet<_>>(),
            )
        } else {
            None
        };
        let runs = self
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?;
        let run_candidates = runs
            .values()
            .filter(|run| {
                if let Some(path_key) = repo_key_filter.as_deref() {
                    Self::repo_key(run.repo_path.as_str()) == path_key
                } else if let Some(allowlist) = allowlisted_repo_keys.as_ref() {
                    let run_repo_key = Self::repo_key(run.repo_path.as_str());
                    allowlist.contains(&run_repo_key)
                } else {
                    true
                }
            })
            .map(RunExposureCandidate::from_run)
            .collect::<Vec<_>>();
        drop(runs);

        let (exposure_plans, probe_targets) = self.build_run_exposure_plans(run_candidates)?;
        let statuses_by_target =
            self.load_cached_runtime_session_statuses_for_targets(&probe_targets)?;
        let mut list = self.visible_run_summaries(exposure_plans, &statuses_by_target)?;

        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(list)
    }

    fn build_run_exposure_plans(
        &self,
        run_candidates: Vec<RunExposureCandidate>,
    ) -> Result<(
        Vec<RunExposurePlan>,
        Vec<super::RuntimeSessionStatusProbeTarget>,
    )> {
        let mut sessions_by_repo_task = HashMap::new();
        let mut exposure_plans = Vec::with_capacity(run_candidates.len());
        let mut probe_targets = Vec::new();

        for run in run_candidates {
            if !run.requires_live_session_check() {
                exposure_plans.push(RunExposurePlan::without_probe(run.summary));
                continue;
            }

            let sessions = self.sessions_for_run_candidate(&run, &mut sessions_by_repo_task)?;
            let external_session_ids = collect_build_external_session_ids_for_run(&run, sessions);

            if external_session_ids.is_empty() {
                exposure_plans.push(RunExposurePlan::without_probe(run.summary));
                continue;
            }

            let probe_target = self
                .runtime_registry
                .runtime(&run.summary.runtime_kind)?
                .session_status_probe_target(
                    &run.summary.runtime_route,
                    run.worktree_path.as_str(),
                )?;
            let Some(probe_target) = probe_target else {
                exposure_plans.push(RunExposurePlan::without_probe(run.summary));
                continue;
            };
            probe_targets.push(probe_target.clone());
            exposure_plans.push(RunExposurePlan::with_probe(
                run.summary,
                external_session_ids,
                probe_target,
            ));
        }

        Ok((exposure_plans, probe_targets))
    }

    fn sessions_for_run_candidate<'a>(
        &self,
        run: &RunExposureCandidate,
        sessions_by_repo_task: &'a mut HashMap<String, Vec<host_domain::AgentSessionDocument>>,
    ) -> Result<&'a [host_domain::AgentSessionDocument]> {
        let session_cache_key = format!("{}::{}", run.repo_path, run.task_id);
        if !sessions_by_repo_task.contains_key(session_cache_key.as_str()) {
            let sessions =
                self.agent_sessions_list(run.repo_path.as_str(), run.task_id.as_str())?;
            sessions_by_repo_task.insert(session_cache_key.clone(), sessions);
        }

        sessions_by_repo_task
            .get(session_cache_key.as_str())
            .map(Vec::as_slice)
            .ok_or_else(|| anyhow!("Missing cached agent sessions for {}", session_cache_key))
    }

    fn visible_run_summaries(
        &self,
        exposure_plans: Vec<RunExposurePlan>,
        statuses_by_target: &HashMap<
            super::RuntimeSessionStatusProbeTarget,
            super::RuntimeSessionStatusMap,
        >,
    ) -> Result<Vec<RunSummary>> {
        let mut list = Vec::new();
        for plan in exposure_plans {
            if plan.is_visible(statuses_by_target)? {
                list.push(plan.summary);
            }
        }
        Ok(list)
    }

    pub(super) fn resolve_supported_runtime_kind(
        &self,
        runtime_kind: &str,
    ) -> Result<AgentRuntimeKind> {
        self.runtime_registry.resolve_kind(runtime_kind)
    }
}

fn collect_build_external_session_ids_for_run(
    run: &RunExposureCandidate,
    sessions: &[host_domain::AgentSessionDocument],
) -> Vec<String> {
    sessions
        .iter()
        .filter(|session| session.role.trim() == "build")
        .filter(|session| session.runtime_kind.trim() == run.summary.runtime_kind.as_str())
        .filter(|session| {
            super::task_workflow::normalize_path_for_comparison(session.working_directory.as_str())
                == super::task_workflow::normalize_path_for_comparison(run.worktree_path.as_str())
        })
        .filter_map(|session| {
            session
                .external_session_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::AppService;
    use crate::app_service::test_support::{
        build_service_with_state, builtin_opencode_runtime_descriptor, make_task,
    };
    use crate::app_service::{AgentRuntimeProcess, RunProcess};
    use anyhow::Result;
    use chrono::{TimeDelta, Utc};
    use host_domain::{
        now_rfc3339, AgentRuntimeKind, AgentSessionDocument, RepoRuntimeHealthMcp,
        RepoRuntimeHealthObservation, RepoRuntimeHealthRuntime, RepoRuntimeHealthState,
        RepoRuntimeMcpStatus, RunSummary, RuntimeRoute, TaskStatus,
    };
    use host_infra_system::RepoConfig;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::process::Command;
    use std::time::{Duration, Instant};

    fn spawn_opencode_session_status_server(
        response_body: &'static str,
    ) -> Result<(u16, std::thread::JoinHandle<()>)> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        let handle = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut request_buffer = [0_u8; 4096];
                let _ = stream.read(&mut request_buffer);
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        Ok((port, handle))
    }

    fn spawn_delayed_opencode_session_status_server(
        response_body: String,
        delay: Duration,
    ) -> Result<(u16, std::thread::JoinHandle<()>)> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            response_body.len(),
            response_body
        );
        let handle = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut request_buffer = [0_u8; 4096];
                let _ = stream.read(&mut request_buffer);
                if !delay.is_zero() {
                    std::thread::sleep(delay);
                }
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        Ok((port, handle))
    }

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
    fn repo_runtime_health_skips_restart_when_active_run_uses_runtime() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, server_handle) = spawn_runtime_http_server(vec![runtime_http_response(
            "500 Internal Server Error",
            r#"{"error":{"message":"ConfigInvalidError: invalid option loglevel"}}"#,
        )])?;
        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::opencode(),
            runtime_id: "runtime-active-run".to_string(),
            repo_path: "/tmp/repo-health-active-run".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-active-run".to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: format!("http://127.0.0.1:{port}"),
            },
            started_at: "2026-04-04T16:00:00Z".to_string(),
            descriptor: builtin_opencode_runtime_descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;
        service.runs.lock().expect("runs lock poisoned").insert(
            "run-1".to_string(),
            RunProcess {
                summary: RunSummary {
                    run_id: "run-1".to_string(),
                    runtime_kind: AgentRuntimeKind::opencode(),
                    runtime_route: runtime.runtime_route.clone(),
                    repo_path: runtime.repo_path.clone(),
                    task_id: "task-1".to_string(),
                    branch: "odt/task-1".to_string(),
                    worktree_path: runtime.working_directory.clone(),
                    port: Some(port),
                    state: host_domain::RunState::Running,
                    last_message: None,
                    started_at: "2026-04-04T16:00:10Z".to_string(),
                },
                child: None,
                _runtime_process_guard: None,
                repo_path: runtime.repo_path.clone(),
                task_id: "task-1".to_string(),
                worktree_path: runtime.working_directory.clone(),
                repo_config: RepoConfig::default(),
            },
        );

        let health = service.repo_runtime_health("opencode", "/tmp/repo-health-active-run")?;
        let _requests = server_handle.join().expect("server thread should finish");

        assert_eq!(health.runtime.status, RepoRuntimeHealthState::Ready);
        assert_eq!(
            health.mcp.as_ref().map(|value| value.status),
            Some(RepoRuntimeMcpStatus::Error)
        );
        assert!(health
            .mcp
            .as_ref()
            .and_then(|value| value.detail.as_deref())
            .is_some_and(|value| value.contains("restart was skipped")));
        service.runtime_stop(runtime.runtime_id.as_str())?;
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
    fn module_runs_list_is_empty_on_fresh_service() {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);

        let runs = service
            .runs_list(None)
            .expect("runs list should be available");

        assert!(runs.is_empty());
    }

    #[test]
    fn module_runs_list_filters_stale_build_runs_without_live_runtime_session() -> Result<()> {
        let (service, task_state, _git_state) =
            build_service_with_state(vec![make_task("task-1", "task", TaskStatus::InProgress)]);
        let (port, server_handle) =
            spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"idle"}}"#)?;

        task_state
            .lock()
            .expect("task store lock poisoned")
            .agent_sessions = vec![AgentSessionDocument {
            session_id: "build-session".to_string(),
            external_session_id: Some("external-build-session".to_string()),
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: "/tmp/repo/worktree".to_string(),
            selected_model: None,
        }];

        service
            .runs
            .lock()
            .expect("run state lock poisoned")
            .insert(
                "run-1".to_string(),
                RunProcess {
                    summary: RunSummary {
                        run_id: "run-1".to_string(),
                        runtime_kind: AgentRuntimeKind::opencode(),
                        runtime_route: host_domain::RuntimeRoute::LocalHttp {
                            endpoint: format!("http://127.0.0.1:{port}"),
                        },
                        repo_path: "/tmp/repo".to_string(),
                        task_id: "task-1".to_string(),
                        branch: "odt/task-1".to_string(),
                        worktree_path: "/tmp/repo/worktree".to_string(),
                        port: Some(port),
                        state: host_domain::RunState::Running,
                        last_message: None,
                        started_at: "2026-03-17T11:00:00Z".to_string(),
                    },
                    child: None,
                    _runtime_process_guard: None,
                    repo_path: "/tmp/repo".to_string(),
                    task_id: "task-1".to_string(),
                    worktree_path: "/tmp/repo/worktree".to_string(),
                    repo_config: RepoConfig::default(),
                },
            );

        let runs = service.runs_list(Some("/tmp/repo"))?;
        server_handle
            .join()
            .expect("status server thread should finish");

        assert!(runs.is_empty());
        Ok(())
    }

    #[test]
    fn module_runs_list_keeps_stdio_build_runs_visible_without_http_probe() -> Result<()> {
        let (service, task_state, _git_state) =
            build_service_with_state(vec![make_task("task-1", "task", TaskStatus::InProgress)]);

        task_state
            .lock()
            .expect("task store lock poisoned")
            .agent_sessions = vec![AgentSessionDocument {
            session_id: "build-session".to_string(),
            external_session_id: Some("external-build-session".to_string()),
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: "/tmp/repo/worktree".to_string(),
            selected_model: None,
        }];

        service
            .runs
            .lock()
            .expect("run state lock poisoned")
            .insert(
                "run-1".to_string(),
                RunProcess {
                    summary: RunSummary {
                        run_id: "run-1".to_string(),
                        runtime_kind: AgentRuntimeKind::opencode(),
                        runtime_route: RuntimeRoute::Stdio,
                        repo_path: "/tmp/repo".to_string(),
                        task_id: "task-1".to_string(),
                        branch: "odt/task-1".to_string(),
                        worktree_path: "/tmp/repo/worktree".to_string(),
                        port: None,
                        state: host_domain::RunState::Running,
                        last_message: None,
                        started_at: "2026-03-17T11:00:00Z".to_string(),
                    },
                    child: None,
                    _runtime_process_guard: None,
                    repo_path: "/tmp/repo".to_string(),
                    task_id: "task-1".to_string(),
                    worktree_path: "/tmp/repo/worktree".to_string(),
                    repo_config: RepoConfig::default(),
                },
            );

        let runs = service.runs_list(Some("/tmp/repo"))?;

        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].run_id, "run-1");
        assert_eq!(runs[0].runtime_route, RuntimeRoute::Stdio);
        Ok(())
    }

    #[test]
    fn module_runs_list_treats_unreachable_status_endpoint_as_stale_run() -> Result<()> {
        let (service, task_state, _git_state) =
            build_service_with_state(vec![make_task("task-1", "task", TaskStatus::InProgress)]);
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let port = listener.local_addr()?.port();
        drop(listener);

        task_state
            .lock()
            .expect("task store lock poisoned")
            .agent_sessions = vec![AgentSessionDocument {
            session_id: "build-session".to_string(),
            external_session_id: Some("external-build-session".to_string()),
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: "/tmp/repo/worktree".to_string(),
            selected_model: None,
        }];

        service
            .runs
            .lock()
            .expect("run state lock poisoned")
            .insert(
                "run-1".to_string(),
                RunProcess {
                    summary: RunSummary {
                        run_id: "run-1".to_string(),
                        runtime_kind: AgentRuntimeKind::opencode(),
                        runtime_route: host_domain::RuntimeRoute::LocalHttp {
                            endpoint: format!("http://127.0.0.1:{port}"),
                        },
                        repo_path: "/tmp/repo".to_string(),
                        task_id: "task-1".to_string(),
                        branch: "odt/task-1".to_string(),
                        worktree_path: "/tmp/repo/worktree".to_string(),
                        port: Some(port),
                        state: host_domain::RunState::Running,
                        last_message: None,
                        started_at: "2026-03-17T11:00:00Z".to_string(),
                    },
                    child: None,
                    _runtime_process_guard: None,
                    repo_path: "/tmp/repo".to_string(),
                    task_id: "task-1".to_string(),
                    worktree_path: "/tmp/repo/worktree".to_string(),
                    repo_config: RepoConfig::default(),
                },
            );

        let runs = service.runs_list(Some("/tmp/repo"))?;

        assert!(runs.is_empty());
        Ok(())
    }

    #[test]
    fn module_runs_list_batches_unique_slow_status_probes() -> Result<()> {
        let tasks = (0..6)
            .map(|index| {
                make_task(
                    format!("task-{index}").as_str(),
                    "task",
                    TaskStatus::InProgress,
                )
            })
            .collect::<Vec<_>>();
        let (service, task_state, _git_state) = build_service_with_state(tasks);
        let mut server_handles = Vec::new();
        let mut sessions = Vec::new();

        for index in 0..6 {
            let (port, server_handle) = spawn_delayed_opencode_session_status_server(
                format!(r#"{{"external-build-session-{index}":{{"type":"busy"}}}}"#),
                Duration::from_millis(300),
            )?;
            server_handles.push(server_handle);
            sessions.push(AgentSessionDocument {
                session_id: format!("build-session-{index}"),
                external_session_id: Some(format!("external-build-session-{index}")),
                role: "build".to_string(),
                scenario: "build_implementation_start".to_string(),
                started_at: "2026-03-17T11:00:00Z".to_string(),
                runtime_kind: "opencode".to_string(),
                working_directory: format!("/tmp/repo/worktree-{index}"),
                selected_model: None,
            });

            service
                .runs
                .lock()
                .expect("run state lock poisoned")
                .insert(
                    format!("run-{index}"),
                    RunProcess {
                        summary: RunSummary {
                            run_id: format!("run-{index}"),
                            runtime_kind: AgentRuntimeKind::opencode(),
                            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                                endpoint: format!("http://127.0.0.1:{port}"),
                            },
                            repo_path: "/tmp/repo".to_string(),
                            task_id: format!("task-{index}"),
                            branch: format!("odt/task-{index}"),
                            worktree_path: format!("/tmp/repo/worktree-{index}"),
                            port: Some(port),
                            state: host_domain::RunState::Running,
                            last_message: None,
                            started_at: format!("2026-03-17T11:00:0{index}Z"),
                        },
                        child: None,
                        _runtime_process_guard: None,
                        repo_path: "/tmp/repo".to_string(),
                        task_id: format!("task-{index}"),
                        worktree_path: format!("/tmp/repo/worktree-{index}"),
                        repo_config: RepoConfig::default(),
                    },
                );
        }

        task_state
            .lock()
            .expect("task store lock poisoned")
            .agent_sessions = sessions;

        let started_at = Instant::now();
        let runs = service.runs_list(Some("/tmp/repo"))?;
        let elapsed = started_at.elapsed();

        for server_handle in server_handles {
            server_handle
                .join()
                .expect("status server thread should finish");
        }

        assert_eq!(runs.len(), 6);
        assert!(
            elapsed < Duration::from_millis(1200),
            "expected bounded parallel latency, observed {elapsed:?}"
        );
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
