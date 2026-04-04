mod registry;
mod startup;

use super::AppService;
use anyhow::{anyhow, Result};
use host_domain::{
    now_rfc3339, AgentRuntimeKind, RepoRuntimeHealthCheck, RepoRuntimeHealthFailureOrigin,
    RepoRuntimeHealthObservation, RepoRuntimeHealthProgress, RepoRuntimeHealthStage,
    RepoRuntimeStartupFailureKind, RepoRuntimeStartupStage, RepoRuntimeStartupStatus, RunState,
    RunSummary, RuntimeDescriptor, RuntimeInstanceSummary, RuntimeRole,
};
use serde::{de::DeserializeOwned, Deserialize};
use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::net::TcpStream;
use std::process::Child;
use std::sync::Arc;
use std::time::{Duration, Instant};
use url::{form_urlencoded, Url};

const ODT_MCP_SERVER_NAME: &str = "openducktor";
const RUNTIME_HEALTH_HTTP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy)]
pub(super) struct RuntimeExistingLookup<'a> {
    repo_key: &'a str,
    role: RuntimeRole,
    task_id: Option<&'a str>,
}

pub(super) struct RuntimePostStartPolicy<'a> {
    existing_lookup: RuntimeExistingLookup<'a>,
    prune_error_context: String,
}

pub(super) struct RuntimeStartInput<'a> {
    runtime_kind: AgentRuntimeKind,
    startup_scope: &'a str,
    repo_path: &'a str,
    repo_key: String,
    startup_started_at_instant: Instant,
    startup_started_at: String,
    task_id: &'a str,
    role: RuntimeRole,
    startup_policy: super::OpencodeStartupReadinessPolicy,
    working_directory: String,
    cleanup_target: Option<super::RuntimeCleanupTarget>,
    tracking_error_context: &'static str,
    startup_error_context: String,
    post_start_policy: Option<RuntimePostStartPolicy<'a>>,
}

pub(super) struct SpawnedRuntimeServer {
    runtime_id: String,
    port: u16,
    child: Child,
    opencode_process_guard: super::TrackedOpencodeProcessGuard,
    startup_started_at_instant: Instant,
    startup_started_at: String,
    startup_report: super::OpencodeStartupWaitReport,
}

#[derive(Debug)]
struct RuntimeHealthHttpFailure {
    failure_kind: RepoRuntimeStartupFailureKind,
    message: String,
}

impl std::fmt::Display for RuntimeHealthHttpFailure {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message.as_str())
    }
}

impl std::error::Error for RuntimeHealthHttpFailure {}

#[derive(Debug, Deserialize)]
struct RuntimeHealthResponseEnvelope<T> {
    data: Option<T>,
    error: Option<RuntimeHealthResponseError>,
}

#[derive(Debug, Deserialize)]
struct RuntimeHealthResponseError {
    message: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RuntimeHealthMcpServerStatus {
    status: String,
    error: Option<String>,
}

fn parse_http_status_code(status_line: &str) -> Result<u16> {
    let mut parts = status_line.split_whitespace();
    let _http_version = parts
        .next()
        .ok_or_else(|| anyhow!("Missing HTTP version in response status line"))?;
    let status_code = parts
        .next()
        .ok_or_else(|| anyhow!("Missing HTTP status code in response status line"))?
        .parse::<u16>()
        .map_err(|error| anyhow!("Invalid HTTP status code in response status line: {error}"))?;
    Ok(status_code)
}

fn extract_http_response_body(response: &str) -> String {
    response
        .split_once("\r\n\r\n")
        .map(|(_, body)| body.to_string())
        .unwrap_or_default()
}

fn classify_runtime_health_io_failure(error: &std::io::Error) -> RepoRuntimeStartupFailureKind {
    match error.kind() {
        ErrorKind::TimedOut => RepoRuntimeStartupFailureKind::Timeout,
        _ => RepoRuntimeStartupFailureKind::Error,
    }
}

fn lower_contains_any(haystack: &str, needles: &[&str]) -> bool {
    let normalized = haystack.to_ascii_lowercase();
    needles.iter().any(|needle| normalized.contains(needle))
}

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
    probe_target: Option<super::OpencodeSessionStatusProbeTarget>,
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
        probe_target: super::OpencodeSessionStatusProbeTarget,
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
            super::OpencodeSessionStatusProbeTarget,
            super::OpencodeSessionStatusMap,
        >,
    ) -> Result<bool> {
        let Some(probe_target) = self.probe_target.as_ref() else {
            return Ok(true);
        };

        let statuses = statuses_by_target.get(probe_target).ok_or_else(|| {
            anyhow!(
                "Missing cached OpenCode session statuses for run {}",
                self.summary.run_id
            )
        })?;
        Ok(self.external_session_ids.iter().any(|external_session_id| {
            super::has_live_opencode_session_status(statuses, external_session_id)
        }))
    }
}

struct RuntimeEnsureFlightGuard<'a> {
    service: &'a AppService,
    runtime_kind: AgentRuntimeKind,
    repo_key: String,
    flight: Arc<super::service_core::RuntimeEnsureFlight>,
    completed: bool,
}

impl<'a> RuntimeEnsureFlightGuard<'a> {
    fn new(
        service: &'a AppService,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        flight: Arc<super::service_core::RuntimeEnsureFlight>,
    ) -> Self {
        Self {
            service,
            runtime_kind,
            repo_key: repo_key.to_string(),
            flight,
            completed: false,
        }
    }

    fn complete(&mut self, result: &Result<RuntimeInstanceSummary>) -> Result<()> {
        self.completed = true;
        self.service.complete_runtime_ensure_flight(
            self.runtime_kind,
            self.repo_key.as_str(),
            &self.flight,
            result,
        )
    }
}

impl Drop for RuntimeEnsureFlightGuard<'_> {
    fn drop(&mut self) {
        if self.completed {
            return;
        }

        let aborted = Err(anyhow!("Runtime ensure aborted unexpectedly"));
        if let Err(error) = self.service.complete_runtime_ensure_flight(
            self.runtime_kind,
            self.repo_key.as_str(),
            &self.flight,
            &aborted,
        ) {
            eprintln!(
                "OpenDucktor warning: failed completing runtime ensure flight after abort: {error:#}"
            );
        }
    }
}

impl AppService {
    fn runtime_ensure_flight_key(runtime_kind: AgentRuntimeKind, repo_key: &str) -> String {
        format!("{}::{repo_key}", runtime_kind.as_str())
    }

    fn update_runtime_startup_status(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        update: impl FnOnce(&mut super::service_core::RuntimeStartupStatusEntry),
    ) -> Result<()> {
        let key = Self::runtime_ensure_flight_key(runtime_kind, repo_key);
        let mut statuses = self
            .runtime_startup_status
            .lock()
            .map_err(|_| anyhow!("Runtime startup status lock poisoned"))?;
        let entry = statuses.entry(key).or_insert_with(|| {
            super::service_core::RuntimeStartupStatusEntry::new(
                runtime_kind,
                repo_key.to_string(),
                RepoRuntimeStartupStage::Idle,
            )
        });
        update(entry);
        entry.updated_at = now_rfc3339();
        Ok(())
    }

    fn mark_runtime_startup_requested(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        started_at_instant: Instant,
        started_at: &str,
    ) -> Result<()> {
        self.update_runtime_startup_status(runtime_kind, repo_key, |entry| {
            entry.stage = RepoRuntimeStartupStage::StartupRequested;
            entry.runtime = None;
            entry.started_at = Some(started_at.to_string());
            entry.started_at_instant = Some(started_at_instant);
            entry.elapsed_ms = None;
            entry.attempts = Some(0);
            entry.failure_kind = None;
            entry.failure_reason = None;
            entry.detail = None;
        })
    }

    fn mark_runtime_startup_waiting(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        started_at_instant: Instant,
        started_at: &str,
        attempts: u32,
    ) -> Result<()> {
        self.update_runtime_startup_status(runtime_kind, repo_key, |entry| {
            entry.stage = RepoRuntimeStartupStage::WaitingForRuntime;
            entry.started_at = Some(started_at.to_string());
            entry.started_at_instant = Some(started_at_instant);
            entry.elapsed_ms = None;
            entry.attempts = Some(attempts);
        })
    }

    fn mark_runtime_startup_ready(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        runtime: &RuntimeInstanceSummary,
        started_at_instant: Instant,
        started_at: &str,
        attempts: u32,
        elapsed_ms: u64,
    ) -> Result<()> {
        self.update_runtime_startup_status(runtime_kind, repo_key, |entry| {
            entry.stage = RepoRuntimeStartupStage::RuntimeReady;
            entry.runtime = Some(runtime.clone());
            entry.started_at = Some(started_at.to_string());
            entry.started_at_instant = Some(started_at_instant);
            entry.elapsed_ms = Some(elapsed_ms);
            entry.attempts = Some(attempts);
            entry.failure_kind = None;
            entry.failure_reason = None;
            entry.detail = None;
        })
    }

    fn mark_runtime_startup_failed(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        failure_kind: RepoRuntimeStartupFailureKind,
        failure_reason: &str,
        detail: String,
        started_at_instant: Instant,
        started_at: &str,
        attempts: Option<u32>,
        elapsed_ms: Option<u64>,
    ) -> Result<()> {
        self.update_runtime_startup_status(runtime_kind, repo_key, |entry| {
            entry.stage = RepoRuntimeStartupStage::StartupFailed;
            entry.runtime = None;
            entry.started_at = Some(started_at.to_string());
            entry.started_at_instant = Some(started_at_instant);
            entry.elapsed_ms = elapsed_ms;
            entry.attempts = attempts;
            entry.failure_kind = Some(failure_kind);
            entry.failure_reason = Some(failure_reason.to_string());
            entry.detail = Some(detail);
        })
    }

    fn clear_runtime_startup_status(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
    ) -> Result<()> {
        let key = Self::runtime_ensure_flight_key(runtime_kind, repo_key);
        let mut statuses = self
            .runtime_startup_status
            .lock()
            .map_err(|_| anyhow!("Runtime startup status lock poisoned"))?;
        statuses.remove(key.as_str());
        Ok(())
    }

    fn update_repo_runtime_health_status(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        health: RepoRuntimeHealthCheck,
    ) -> Result<()> {
        let key = Self::runtime_ensure_flight_key(runtime_kind, repo_key);
        let mut statuses = self
            .repo_runtime_health_snapshots
            .lock()
            .map_err(|_| anyhow!("Repo runtime health status lock poisoned"))?;
        statuses.insert(key, health);
        Ok(())
    }

    fn clear_repo_runtime_health_status(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
    ) -> Result<()> {
        let key = Self::runtime_ensure_flight_key(runtime_kind, repo_key);
        let mut statuses = self
            .repo_runtime_health_snapshots
            .lock()
            .map_err(|_| anyhow!("Repo runtime health status lock poisoned"))?;
        statuses.remove(key.as_str());
        Ok(())
    }

    fn clear_repo_runtime_health_status_for_runtime(
        &self,
        runtime: &RuntimeInstanceSummary,
    ) -> Result<()> {
        self.clear_repo_runtime_health_status(runtime.kind, runtime.repo_path.as_str())
    }

    pub fn repo_runtime_health_status(
        &self,
        runtime_kind: &str,
        repo_path: &str,
    ) -> Result<RepoRuntimeHealthCheck> {
        let runtime_kind = Self::resolve_supported_runtime_kind(runtime_kind)?;
        let repo_key = self.resolve_authorized_repo_path(repo_path)?;
        let status_key = Self::runtime_ensure_flight_key(runtime_kind, repo_key.as_str());

        if let Some(snapshot) = self
            .repo_runtime_health_snapshots
            .lock()
            .map_err(|_| anyhow!("Repo runtime health status lock poisoned"))?
            .get(status_key.as_str())
            .cloned()
        {
            return Ok(snapshot);
        }

        let startup_status =
            self.runtime_startup_status(runtime_kind.as_str(), repo_key.as_str())?;
        let checked_at = now_rfc3339();
        let progress = self.repo_runtime_progress(
            match startup_status.stage {
                RepoRuntimeStartupStage::Idle => RepoRuntimeHealthStage::Idle,
                RepoRuntimeStartupStage::StartupRequested => {
                    RepoRuntimeHealthStage::StartupRequested
                }
                RepoRuntimeStartupStage::WaitingForRuntime => {
                    RepoRuntimeHealthStage::WaitingForRuntime
                }
                RepoRuntimeStartupStage::RuntimeReady => RepoRuntimeHealthStage::RuntimeReady,
                RepoRuntimeStartupStage::StartupFailed => RepoRuntimeHealthStage::StartupFailed,
            },
            Self::repo_runtime_health_observation(
                startup_status.runtime.is_some(),
                Some(&startup_status),
            ),
            Some(startup_status.clone()),
            checked_at.as_str(),
            startup_status.detail.clone(),
            startup_status.failure_kind,
            startup_status.failure_reason.clone(),
            None,
            startup_status.started_at.clone(),
            Some(startup_status.updated_at.clone()),
            startup_status.elapsed_ms,
            startup_status.attempts,
        );

        let runtime_error = match progress.stage {
            RepoRuntimeHealthStage::StartupFailed => startup_status.detail.clone(),
            RepoRuntimeHealthStage::StartupRequested
            | RepoRuntimeHealthStage::WaitingForRuntime => startup_status.detail.clone(),
            _ => None,
        };
        let mcp_unavailable = (!matches!(
            progress.stage,
            RepoRuntimeHealthStage::RuntimeReady | RepoRuntimeHealthStage::Ready
        ))
        .then(|| "Runtime is unavailable, so MCP cannot be verified.".to_string());

        Ok(RepoRuntimeHealthCheck {
            runtime_ok: matches!(
                progress.stage,
                RepoRuntimeHealthStage::RuntimeReady | RepoRuntimeHealthStage::Ready
            ),
            runtime_error,
            runtime_failure_kind: startup_status.failure_kind,
            runtime: startup_status.runtime.clone(),
            mcp_ok: false,
            mcp_error: mcp_unavailable.clone(),
            mcp_failure_kind: startup_status.failure_kind,
            mcp_server_name: ODT_MCP_SERVER_NAME.to_string(),
            mcp_server_status: None,
            mcp_server_error: mcp_unavailable.clone(),
            available_tool_ids: Vec::new(),
            checked_at,
            errors: [startup_status.detail, mcp_unavailable]
                .into_iter()
                .flatten()
                .collect(),
            progress: Some(progress),
        })
    }

    fn clear_runtime_startup_status_for_runtime(
        &self,
        runtime: &RuntimeInstanceSummary,
    ) -> Result<()> {
        self.clear_runtime_startup_status(runtime.kind, runtime.repo_path.as_str())
    }

    pub fn runtime_startup_status(
        &self,
        runtime_kind: &str,
        repo_path: &str,
    ) -> Result<RepoRuntimeStartupStatus> {
        let runtime_kind = Self::resolve_supported_runtime_kind(runtime_kind)?;
        let repo_key = self.resolve_authorized_repo_path(repo_path)?;
        let status_key = Self::runtime_ensure_flight_key(runtime_kind, repo_key.as_str());

        if let Some(snapshot) = self
            .runtime_startup_status
            .lock()
            .map_err(|_| anyhow!("Runtime startup status lock poisoned"))?
            .get(status_key.as_str())
            .cloned()
        {
            return Ok(snapshot.to_public_status());
        }

        if let Some(runtime) =
            self.find_existing_workspace_runtime(runtime_kind, repo_key.as_str())?
        {
            return Ok(RepoRuntimeStartupStatus {
                runtime_kind,
                repo_path: repo_key,
                stage: RepoRuntimeStartupStage::RuntimeReady,
                runtime: Some(runtime.clone()),
                started_at: Some(runtime.started_at.clone()),
                updated_at: runtime.started_at,
                elapsed_ms: None,
                attempts: None,
                failure_kind: None,
                failure_reason: None,
                detail: None,
            });
        }

        Ok(RepoRuntimeStartupStatus {
            runtime_kind,
            repo_path: repo_key,
            stage: RepoRuntimeStartupStage::Idle,
            runtime: None,
            started_at: None,
            updated_at: now_rfc3339(),
            elapsed_ms: None,
            attempts: None,
            failure_kind: None,
            failure_reason: None,
            detail: None,
        })
    }

    fn runtime_health_http_request_json<T: DeserializeOwned>(
        &self,
        endpoint: &str,
        method: &str,
        request_path: &str,
        action: &str,
    ) -> std::result::Result<T, RuntimeHealthHttpFailure> {
        let parsed_endpoint = Url::parse(endpoint).map_err(|error| RuntimeHealthHttpFailure {
            failure_kind: RepoRuntimeStartupFailureKind::Error,
            message: format!("Invalid OpenCode runtime endpoint {endpoint}: {error}"),
        })?;
        let host = parsed_endpoint
            .host_str()
            .ok_or_else(|| RuntimeHealthHttpFailure {
                failure_kind: RepoRuntimeStartupFailureKind::Error,
                message: format!("OpenCode runtime endpoint is missing a host: {endpoint}"),
            })?;
        let port = parsed_endpoint
            .port()
            .ok_or_else(|| RuntimeHealthHttpFailure {
                failure_kind: RepoRuntimeStartupFailureKind::Error,
                message: format!("OpenCode runtime endpoint is missing a port: {endpoint}"),
            })?;

        let mut stream =
            TcpStream::connect((host, port)).map_err(|error| RuntimeHealthHttpFailure {
                failure_kind: classify_runtime_health_io_failure(&error),
                message: format!(
                    "Failed to connect to OpenCode runtime at {endpoint} to {action}: {error}"
                ),
            })?;
        stream
            .set_read_timeout(Some(RUNTIME_HEALTH_HTTP_TIMEOUT))
            .map_err(|error| RuntimeHealthHttpFailure {
                failure_kind: classify_runtime_health_io_failure(&error),
                message: format!(
                    "Failed to configure OpenCode runtime read timeout for {action}: {error}"
                ),
            })?;
        stream
            .set_write_timeout(Some(RUNTIME_HEALTH_HTTP_TIMEOUT))
            .map_err(|error| RuntimeHealthHttpFailure {
                failure_kind: classify_runtime_health_io_failure(&error),
                message: format!(
                    "Failed to configure OpenCode runtime write timeout for {action}: {error}"
                ),
            })?;

        let request = if method == "POST" {
            format!(
                "POST {request_path} HTTP/1.1\r\nHost: {host}:{port}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            )
        } else {
            format!(
                "GET {request_path} HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n"
            )
        };
        stream
            .write_all(request.as_bytes())
            .map_err(|error| RuntimeHealthHttpFailure {
                failure_kind: classify_runtime_health_io_failure(&error),
                message: format!("Failed to send OpenCode runtime request to {action}: {error}"),
            })?;
        stream.flush().map_err(|error| RuntimeHealthHttpFailure {
            failure_kind: classify_runtime_health_io_failure(&error),
            message: format!("Failed to flush OpenCode runtime request to {action}: {error}"),
        })?;

        let mut reader = BufReader::new(stream);
        let mut status_line = String::new();
        reader
            .read_line(&mut status_line)
            .map_err(|error| RuntimeHealthHttpFailure {
                failure_kind: classify_runtime_health_io_failure(&error),
                message: format!("Failed to read OpenCode runtime response for {action}: {error}"),
            })?;
        let status_code = parse_http_status_code(status_line.as_str()).map_err(|error| {
            RuntimeHealthHttpFailure {
                failure_kind: RepoRuntimeStartupFailureKind::Error,
                message: format!("Invalid OpenCode runtime response for {action}: {error:#}"),
            }
        })?;

        let mut response = String::new();
        reader
            .read_to_string(&mut response)
            .map_err(|error| RuntimeHealthHttpFailure {
                failure_kind: classify_runtime_health_io_failure(&error),
                message: format!(
                    "Failed to read OpenCode runtime response body for {action}: {error}"
                ),
            })?;
        let body = extract_http_response_body(response.as_str());

        if !(200..300).contains(&status_code) {
            let detail = if body.is_empty() {
                None
            } else {
                serde_json::from_str::<RuntimeHealthResponseEnvelope<serde_json::Value>>(
                    body.as_str(),
                )
                .ok()
                .and_then(|payload| payload.error.and_then(|error| error.message))
                .or(Some(body.clone()))
            };
            let failure_kind = if matches!(status_code, 408 | 504) {
                RepoRuntimeStartupFailureKind::Timeout
            } else {
                RepoRuntimeStartupFailureKind::Error
            };
            return Err(RuntimeHealthHttpFailure {
                failure_kind,
                message: match detail {
                    Some(detail) if !detail.trim().is_empty() => {
                        format!("OpenCode runtime failed to {action}: HTTP {status_code}: {detail}")
                    }
                    _ => format!("OpenCode runtime failed to {action}: HTTP {status_code}"),
                },
            });
        }

        let payload = serde_json::from_str::<RuntimeHealthResponseEnvelope<T>>(body.as_str())
            .map_err(|error| RuntimeHealthHttpFailure {
                failure_kind: RepoRuntimeStartupFailureKind::Error,
                message: format!("Failed to parse OpenCode runtime response for {action}: {error}"),
            })?;
        payload.data.ok_or_else(|| RuntimeHealthHttpFailure {
            failure_kind: RepoRuntimeStartupFailureKind::Error,
            message: payload
                .error
                .and_then(|error| error.message)
                .unwrap_or_else(|| format!("OpenCode runtime returned no data for {action}")),
        })
    }

    fn repo_runtime_progress(
        &self,
        stage: RepoRuntimeHealthStage,
        observation: Option<RepoRuntimeHealthObservation>,
        host: Option<RepoRuntimeStartupStatus>,
        checked_at: &str,
        detail: Option<String>,
        failure_kind: Option<RepoRuntimeStartupFailureKind>,
        failure_reason: Option<String>,
        failure_origin: Option<RepoRuntimeHealthFailureOrigin>,
        started_at: Option<String>,
        updated_at: Option<String>,
        elapsed_ms: Option<u64>,
        attempts: Option<u32>,
    ) -> RepoRuntimeHealthProgress {
        let host_started_at = host.as_ref().and_then(|value| value.started_at.clone());
        let host_updated_at = host.as_ref().map(|value| value.updated_at.clone());
        let host_elapsed_ms = host.as_ref().and_then(|value| value.elapsed_ms);
        let host_attempts = host.as_ref().and_then(|value| value.attempts);
        let host_detail = host.as_ref().and_then(|value| value.detail.clone());
        let host_failure_kind = host.as_ref().and_then(|value| value.failure_kind);
        let host_failure_reason = host.as_ref().and_then(|value| value.failure_reason.clone());

        RepoRuntimeHealthProgress {
            stage,
            observation,
            started_at: started_at.or(host_started_at),
            updated_at: updated_at
                .or(host_updated_at)
                .unwrap_or_else(|| checked_at.to_string()),
            elapsed_ms: elapsed_ms.or(host_elapsed_ms),
            attempts: attempts.or(host_attempts),
            detail: detail.or(host_detail),
            failure_kind: failure_kind.or(host_failure_kind),
            failure_reason: failure_reason.or(host_failure_reason),
            failure_origin,
            host,
        }
    }

    fn repo_runtime_health_observation(
        existing_runtime: bool,
        host_status: Option<&RepoRuntimeStartupStatus>,
    ) -> Option<RepoRuntimeHealthObservation> {
        if existing_runtime {
            return Some(RepoRuntimeHealthObservation::ObservedExistingRuntime);
        }
        if host_status.is_some_and(|status| status.stage != RepoRuntimeStartupStage::Idle) {
            return Some(RepoRuntimeHealthObservation::ObservingExistingStartup);
        }
        Some(RepoRuntimeHealthObservation::StartedByDiagnostics)
    }

    fn store_repo_runtime_health(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        health: RepoRuntimeHealthCheck,
    ) -> Result<RepoRuntimeHealthCheck> {
        self.update_repo_runtime_health_status(runtime_kind, repo_key, health.clone())?;
        Ok(health)
    }

    fn repo_runtime_timeout_kind(error: &anyhow::Error) -> RepoRuntimeStartupFailureKind {
        error
            .chain()
            .find_map(|cause| {
                cause
                    .downcast_ref::<super::OpencodeStartupWaitFailure>()
                    .map(|failure| {
                        if failure.reason == "timeout" {
                            RepoRuntimeStartupFailureKind::Timeout
                        } else {
                            RepoRuntimeStartupFailureKind::Error
                        }
                    })
                    .or_else(|| {
                        cause
                            .downcast_ref::<RuntimeHealthHttpFailure>()
                            .map(|failure| failure.failure_kind)
                    })
            })
            .unwrap_or(RepoRuntimeStartupFailureKind::Error)
    }

    fn repo_runtime_failure_reason(error: &anyhow::Error) -> Option<String> {
        error.chain().find_map(|cause| {
            cause
                .downcast_ref::<super::OpencodeStartupWaitFailure>()
                .map(|failure| failure.reason.to_string())
        })
    }

    fn repo_runtime_should_restart_for_mcp_status_error(message: &str) -> bool {
        lower_contains_any(
            message,
            &[
                "configinvaliderror",
                "opencode_config_content",
                "loglevel",
                "invalid option",
            ],
        )
    }

    fn repo_runtime_mcp_status_path(working_directory: &str) -> String {
        format!(
            "/mcp?{}",
            form_urlencoded::Serializer::new(String::new())
                .append_pair("directory", working_directory)
                .finish()
        )
    }

    fn repo_runtime_tool_ids_path(working_directory: &str) -> String {
        format!(
            "/experimental/tool/ids?{}",
            form_urlencoded::Serializer::new(String::new())
                .append_pair("directory", working_directory)
                .finish()
        )
    }

    fn repo_runtime_connect_mcp_path(name: &str, working_directory: &str) -> String {
        let encoded_name: String = form_urlencoded::byte_serialize(name.as_bytes()).collect();
        format!(
            "/mcp/{encoded_name}/connect?{}",
            form_urlencoded::Serializer::new(String::new())
                .append_pair("directory", working_directory)
                .finish()
        )
    }

    fn repo_runtime_load_mcp_status(
        &self,
        runtime: &RuntimeInstanceSummary,
    ) -> std::result::Result<HashMap<String, RuntimeHealthMcpServerStatus>, RuntimeHealthHttpFailure>
    {
        let endpoint = match &runtime.runtime_route {
            host_domain::RuntimeRoute::LocalHttp { endpoint } => endpoint.as_str(),
        };
        self.runtime_health_http_request_json(
            endpoint,
            "GET",
            Self::repo_runtime_mcp_status_path(runtime.working_directory.as_str()).as_str(),
            "load MCP status",
        )
    }

    fn repo_runtime_connect_mcp_server(
        &self,
        runtime: &RuntimeInstanceSummary,
        name: &str,
    ) -> std::result::Result<(), RuntimeHealthHttpFailure> {
        let endpoint = match &runtime.runtime_route {
            host_domain::RuntimeRoute::LocalHttp { endpoint } => endpoint.as_str(),
        };
        let _: serde_json::Value = self.runtime_health_http_request_json(
            endpoint,
            "POST",
            Self::repo_runtime_connect_mcp_path(name, runtime.working_directory.as_str()).as_str(),
            "connect MCP server",
        )?;
        Ok(())
    }

    fn repo_runtime_load_tool_ids(
        &self,
        runtime: &RuntimeInstanceSummary,
    ) -> std::result::Result<Vec<String>, RuntimeHealthHttpFailure> {
        let endpoint = match &runtime.runtime_route {
            host_domain::RuntimeRoute::LocalHttp { endpoint } => endpoint.as_str(),
        };
        self.runtime_health_http_request_json(
            endpoint,
            "GET",
            Self::repo_runtime_tool_ids_path(runtime.working_directory.as_str()).as_str(),
            "list tool ids",
        )
    }

    fn repo_runtime_resolve_mcp_status(
        status_by_server: &HashMap<String, RuntimeHealthMcpServerStatus>,
    ) -> (
        Option<String>,
        Option<String>,
        Option<RepoRuntimeStartupFailureKind>,
    ) {
        let Some(server_status) = status_by_server.get(ODT_MCP_SERVER_NAME) else {
            return (
                None,
                Some(format!(
                    "MCP server '{ODT_MCP_SERVER_NAME}' is not configured for this runtime."
                )),
                Some(RepoRuntimeStartupFailureKind::Error),
            );
        };
        if server_status.status == "connected" {
            return (Some(server_status.status.clone()), None, None);
        }
        (
            Some(server_status.status.clone()),
            Some(server_status.error.clone().unwrap_or_else(|| {
                format!(
                    "MCP server '{ODT_MCP_SERVER_NAME}' is {}.",
                    server_status.status
                )
            })),
            Some(RepoRuntimeStartupFailureKind::Error),
        )
    }

    pub fn repo_runtime_health(
        &self,
        runtime_kind: &str,
        repo_path: &str,
    ) -> Result<RepoRuntimeHealthCheck> {
        let runtime_kind = Self::resolve_supported_runtime_kind(runtime_kind)?;
        let repo_key = self.resolve_authorized_repo_path(repo_path)?;
        let checked_at = now_rfc3339();
        let mut host_status =
            Some(self.runtime_startup_status(runtime_kind.as_str(), repo_key.as_str())?);
        let existing_runtime =
            self.find_existing_workspace_runtime(runtime_kind, repo_key.as_str())?;
        let mut observation =
            Self::repo_runtime_health_observation(existing_runtime.is_some(), host_status.as_ref());

        let runtime = match existing_runtime {
            Some(runtime) => runtime,
            None => match self.ensure_workspace_runtime(runtime_kind, repo_key.as_str()) {
                Ok(runtime) => runtime,
                Err(error) => {
                    let latest_host_status =
                        self.runtime_startup_status(runtime_kind.as_str(), repo_key.as_str())?;
                    let progress = self.repo_runtime_progress(
                        match latest_host_status.stage {
                            RepoRuntimeStartupStage::Idle => RepoRuntimeHealthStage::StartupFailed,
                            RepoRuntimeStartupStage::StartupRequested => {
                                RepoRuntimeHealthStage::StartupRequested
                            }
                            RepoRuntimeStartupStage::WaitingForRuntime => {
                                RepoRuntimeHealthStage::WaitingForRuntime
                            }
                            RepoRuntimeStartupStage::RuntimeReady => {
                                RepoRuntimeHealthStage::RuntimeReady
                            }
                            RepoRuntimeStartupStage::StartupFailed => {
                                RepoRuntimeHealthStage::StartupFailed
                            }
                        },
                        observation,
                        Some(latest_host_status),
                        checked_at.as_str(),
                        Some(format!("{error:#}")),
                        Some(Self::repo_runtime_timeout_kind(&error)),
                        Self::repo_runtime_failure_reason(&error),
                        Some(RepoRuntimeHealthFailureOrigin::RuntimeStartup),
                        None,
                        None,
                        None,
                        None,
                    );
                    let runtime_error = format!("{error:#}");
                    let unavailable_message =
                        "Runtime is unavailable, so MCP cannot be verified.".to_string();
                    return self.store_repo_runtime_health(
                        runtime_kind,
                        repo_key.as_str(),
                        RepoRuntimeHealthCheck {
                            runtime_ok: false,
                            runtime_error: Some(runtime_error.clone()),
                            runtime_failure_kind: Some(Self::repo_runtime_timeout_kind(&error)),
                            runtime: None,
                            mcp_ok: false,
                            mcp_error: Some(unavailable_message.clone()),
                            mcp_failure_kind: Some(Self::repo_runtime_timeout_kind(&error)),
                            mcp_server_name: ODT_MCP_SERVER_NAME.to_string(),
                            mcp_server_status: None,
                            mcp_server_error: Some(unavailable_message.clone()),
                            available_tool_ids: Vec::new(),
                            checked_at,
                            errors: vec![runtime_error, unavailable_message],
                            progress: Some(progress),
                        },
                    );
                }
            },
        };

        host_status = Some(self.runtime_startup_status(runtime_kind.as_str(), repo_key.as_str())?);
        if !runtime.descriptor.capabilities.supports_mcp_status {
            return self.store_repo_runtime_health(
                runtime_kind,
                repo_key.as_str(),
                RepoRuntimeHealthCheck {
                    runtime_ok: true,
                    runtime_error: None,
                    runtime_failure_kind: None,
                    runtime: Some(runtime.clone()),
                    mcp_ok: true,
                    mcp_error: None,
                    mcp_failure_kind: None,
                    mcp_server_name: ODT_MCP_SERVER_NAME.to_string(),
                    mcp_server_status: None,
                    mcp_server_error: None,
                    available_tool_ids: Vec::new(),
                    checked_at: checked_at.clone(),
                    errors: Vec::new(),
                    progress: Some(self.repo_runtime_progress(
                        RepoRuntimeHealthStage::Ready,
                        observation,
                        host_status,
                        checked_at.as_str(),
                        None,
                        None,
                        None,
                        None,
                        Some(runtime.started_at.clone()),
                        Some(checked_at.clone()),
                        None,
                        None,
                    )),
                },
            );
        }

        self.complete_repo_runtime_health(
            repo_key.as_str(),
            checked_at.as_str(),
            runtime_kind,
            runtime,
            host_status,
            observation.take(),
            true,
        )
    }

    fn complete_repo_runtime_health(
        &self,
        repo_key: &str,
        checked_at: &str,
        runtime_kind: AgentRuntimeKind,
        runtime: RuntimeInstanceSummary,
        host_status: Option<RepoRuntimeStartupStatus>,
        observation: Option<RepoRuntimeHealthObservation>,
        allow_restart: bool,
    ) -> Result<RepoRuntimeHealthCheck> {
        let checking_progress = self.repo_runtime_progress(
            RepoRuntimeHealthStage::CheckingMcpStatus,
            observation,
            host_status.clone(),
            checked_at,
            None,
            None,
            None,
            None,
            Some(runtime.started_at.clone()),
            Some(checked_at.to_string()),
            None,
            None,
        );
        self.update_repo_runtime_health_status(
            runtime_kind,
            repo_key,
            RepoRuntimeHealthCheck {
                runtime_ok: true,
                runtime_error: None,
                runtime_failure_kind: None,
                runtime: Some(runtime.clone()),
                mcp_ok: false,
                mcp_error: None,
                mcp_failure_kind: None,
                mcp_server_name: ODT_MCP_SERVER_NAME.to_string(),
                mcp_server_status: None,
                mcp_server_error: None,
                available_tool_ids: Vec::new(),
                checked_at: checked_at.to_string(),
                errors: Vec::new(),
                progress: Some(checking_progress.clone()),
            },
        )?;

        let status_by_server = match self.repo_runtime_load_mcp_status(&runtime) {
            Ok(status_by_server) => status_by_server,
            Err(error) => {
                if allow_restart
                    && Self::repo_runtime_should_restart_for_mcp_status_error(
                        error.message.as_str(),
                    )
                {
                    let runs = self.runs_list(Some(repo_key))?;
                    let runtime_endpoint = match &runtime.runtime_route {
                        host_domain::RuntimeRoute::LocalHttp { endpoint } => endpoint.as_str(),
                    };
                    let has_active_run = runs.iter().any(|run| {
                        matches!(
                            run.state,
                            RunState::Starting
                                | RunState::Running
                                | RunState::Blocked
                                | RunState::AwaitingDoneConfirmation
                        ) && matches!(&run.runtime_route, host_domain::RuntimeRoute::LocalHttp { endpoint } if endpoint == runtime_endpoint)
                    });
                    if has_active_run {
                        let skipped_message = format!(
                            "Failed to query runtime MCP status: {}. Automatic runtime restart was skipped because an active run is using this runtime.",
                            error.message
                        );
                        return self.store_repo_runtime_health(
                            runtime_kind,
                            repo_key,
                            RepoRuntimeHealthCheck {
                                runtime_ok: true,
                                runtime_error: None,
                                runtime_failure_kind: None,
                                runtime: Some(runtime.clone()),
                                mcp_ok: false,
                                mcp_error: Some(skipped_message.clone()),
                                mcp_failure_kind: Some(error.failure_kind),
                                mcp_server_name: ODT_MCP_SERVER_NAME.to_string(),
                                mcp_server_status: None,
                                mcp_server_error: Some(skipped_message.clone()),
                                available_tool_ids: Vec::new(),
                                checked_at: checked_at.to_string(),
                                errors: vec![skipped_message.clone()],
                                progress: Some(self.repo_runtime_progress(
                                    RepoRuntimeHealthStage::RestartSkippedActiveRun,
                                    Some(RepoRuntimeHealthObservation::RestartSkippedActiveRun),
                                    host_status,
                                    checked_at,
                                    Some(skipped_message),
                                    Some(error.failure_kind),
                                    None,
                                    Some(RepoRuntimeHealthFailureOrigin::RuntimeRestart),
                                    Some(runtime.started_at.clone()),
                                    Some(checked_at.to_string()),
                                    None,
                                    None,
                                )),
                            },
                        );
                    }

                    self.update_repo_runtime_health_status(
                        runtime_kind,
                        repo_key,
                        RepoRuntimeHealthCheck {
                            runtime_ok: true,
                            runtime_error: None,
                            runtime_failure_kind: None,
                            runtime: Some(runtime.clone()),
                            mcp_ok: false,
                            mcp_error: Some(error.message.clone()),
                            mcp_failure_kind: Some(error.failure_kind),
                            mcp_server_name: ODT_MCP_SERVER_NAME.to_string(),
                            mcp_server_status: None,
                            mcp_server_error: Some(error.message.clone()),
                            available_tool_ids: Vec::new(),
                            checked_at: checked_at.to_string(),
                            errors: vec![error.message.clone()],
                            progress: Some(self.repo_runtime_progress(
                                RepoRuntimeHealthStage::RestartingRuntime,
                                Some(RepoRuntimeHealthObservation::RestartedForMcp),
                                host_status.clone(),
                                checked_at,
                                Some(error.message.clone()),
                                Some(error.failure_kind),
                                None,
                                Some(RepoRuntimeHealthFailureOrigin::RuntimeRestart),
                                Some(runtime.started_at.clone()),
                                Some(checked_at.to_string()),
                                None,
                                None,
                            )),
                        },
                    )?;

                    if let Err(stop_error) = self.runtime_stop(runtime.runtime_id.as_str()) {
                        let stop_message =
                            format!("Failed to stop runtime before MCP recovery: {stop_error:#}");
                        return self.store_repo_runtime_health(
                            runtime_kind,
                            repo_key,
                            RepoRuntimeHealthCheck {
                                runtime_ok: true,
                                runtime_error: None,
                                runtime_failure_kind: None,
                                runtime: Some(runtime.clone()),
                                mcp_ok: false,
                                mcp_error: Some(stop_message.clone()),
                                mcp_failure_kind: Some(RepoRuntimeStartupFailureKind::Error),
                                mcp_server_name: ODT_MCP_SERVER_NAME.to_string(),
                                mcp_server_status: None,
                                mcp_server_error: Some(stop_message.clone()),
                                available_tool_ids: Vec::new(),
                                checked_at: checked_at.to_string(),
                                errors: vec![stop_message.clone()],
                                progress: Some(self.repo_runtime_progress(
                                    RepoRuntimeHealthStage::RestartingRuntime,
                                    Some(RepoRuntimeHealthObservation::RestartedForMcp),
                                    host_status,
                                    checked_at,
                                    Some(stop_message),
                                    Some(RepoRuntimeStartupFailureKind::Error),
                                    None,
                                    Some(RepoRuntimeHealthFailureOrigin::RuntimeStop),
                                    Some(runtime.started_at.clone()),
                                    Some(checked_at.to_string()),
                                    None,
                                    None,
                                )),
                            },
                        );
                    }

                    match self.ensure_workspace_runtime(runtime_kind, repo_key) {
                        Ok(restarted_runtime) => {
                            let restarted_host_status =
                                Some(self.runtime_startup_status(runtime_kind.as_str(), repo_key)?);
                            return self.complete_repo_runtime_health(
                                repo_key,
                                checked_at,
                                runtime_kind,
                                restarted_runtime,
                                restarted_host_status,
                                Some(RepoRuntimeHealthObservation::RestartedForMcp),
                                false,
                            );
                        }
                        Err(restart_error) => {
                            let latest_host_status =
                                self.runtime_startup_status(runtime_kind.as_str(), repo_key)?;
                            let runtime_error = format!("{restart_error:#}");
                            let unavailable_message =
                                "Runtime is unavailable, so MCP cannot be verified.".to_string();
                            return self.store_repo_runtime_health(
                                runtime_kind,
                                repo_key,
                                RepoRuntimeHealthCheck {
                                    runtime_ok: false,
                                    runtime_error: Some(runtime_error.clone()),
                                    runtime_failure_kind: Some(Self::repo_runtime_timeout_kind(
                                        &restart_error,
                                    )),
                                    runtime: None,
                                    mcp_ok: false,
                                    mcp_error: Some(unavailable_message.clone()),
                                    mcp_failure_kind: Some(Self::repo_runtime_timeout_kind(
                                        &restart_error,
                                    )),
                                    mcp_server_name: ODT_MCP_SERVER_NAME.to_string(),
                                    mcp_server_status: None,
                                    mcp_server_error: Some(unavailable_message.clone()),
                                    available_tool_ids: Vec::new(),
                                    checked_at: checked_at.to_string(),
                                    errors: vec![runtime_error, unavailable_message],
                                    progress: Some(self.repo_runtime_progress(
                                        match latest_host_status.stage {
                                            RepoRuntimeStartupStage::WaitingForRuntime => {
                                                RepoRuntimeHealthStage::WaitingForRuntime
                                            }
                                            RepoRuntimeStartupStage::StartupRequested => {
                                                RepoRuntimeHealthStage::StartupRequested
                                            }
                                            RepoRuntimeStartupStage::RuntimeReady => {
                                                RepoRuntimeHealthStage::RuntimeReady
                                            }
                                            RepoRuntimeStartupStage::Idle => {
                                                RepoRuntimeHealthStage::RestartingRuntime
                                            }
                                            RepoRuntimeStartupStage::StartupFailed => {
                                                RepoRuntimeHealthStage::StartupFailed
                                            }
                                        },
                                        Some(RepoRuntimeHealthObservation::RestartedForMcp),
                                        Some(latest_host_status),
                                        checked_at,
                                        Some(format!("{restart_error:#}")),
                                        Some(Self::repo_runtime_timeout_kind(&restart_error)),
                                        Self::repo_runtime_failure_reason(&restart_error),
                                        Some(RepoRuntimeHealthFailureOrigin::RuntimeRestart),
                                        None,
                                        Some(checked_at.to_string()),
                                        None,
                                        None,
                                    )),
                                },
                            );
                        }
                    }
                }

                let mcp_message = format!("Failed to query runtime MCP status: {}", error.message);
                return self.store_repo_runtime_health(
                    runtime_kind,
                    repo_key,
                    RepoRuntimeHealthCheck {
                        runtime_ok: true,
                        runtime_error: None,
                        runtime_failure_kind: None,
                        runtime: Some(runtime.clone()),
                        mcp_ok: false,
                        mcp_error: Some(mcp_message.clone()),
                        mcp_failure_kind: Some(error.failure_kind),
                        mcp_server_name: ODT_MCP_SERVER_NAME.to_string(),
                        mcp_server_status: None,
                        mcp_server_error: Some(mcp_message.clone()),
                        available_tool_ids: Vec::new(),
                        checked_at: checked_at.to_string(),
                        errors: vec![mcp_message.clone()],
                        progress: Some(self.repo_runtime_progress(
                            RepoRuntimeHealthStage::CheckingMcpStatus,
                            observation,
                            host_status,
                            checked_at,
                            Some(mcp_message),
                            Some(error.failure_kind),
                            None,
                            Some(RepoRuntimeHealthFailureOrigin::McpStatus),
                            Some(runtime.started_at.clone()),
                            Some(checked_at.to_string()),
                            checking_progress.elapsed_ms,
                            checking_progress.attempts,
                        )),
                    },
                );
            }
        };

        let (mut mcp_server_status, mut mcp_server_error, mut mcp_failure_kind) =
            Self::repo_runtime_resolve_mcp_status(&status_by_server);
        if mcp_server_status.as_deref() != Some("connected") {
            let reconnect_progress = self.repo_runtime_progress(
                RepoRuntimeHealthStage::ReconnectingMcp,
                observation,
                host_status.clone(),
                checked_at,
                mcp_server_error.clone(),
                mcp_failure_kind,
                None,
                Some(RepoRuntimeHealthFailureOrigin::McpConnect),
                Some(runtime.started_at.clone()),
                Some(checked_at.to_string()),
                checking_progress.elapsed_ms,
                checking_progress.attempts,
            );
            self.update_repo_runtime_health_status(
                runtime_kind,
                repo_key,
                RepoRuntimeHealthCheck {
                    runtime_ok: true,
                    runtime_error: None,
                    runtime_failure_kind: None,
                    runtime: Some(runtime.clone()),
                    mcp_ok: false,
                    mcp_error: mcp_server_error.clone(),
                    mcp_failure_kind,
                    mcp_server_name: ODT_MCP_SERVER_NAME.to_string(),
                    mcp_server_status: mcp_server_status.clone(),
                    mcp_server_error: mcp_server_error.clone(),
                    available_tool_ids: Vec::new(),
                    checked_at: checked_at.to_string(),
                    errors: mcp_server_error.clone().into_iter().collect(),
                    progress: Some(reconnect_progress.clone()),
                },
            )?;
            match self.repo_runtime_connect_mcp_server(&runtime, ODT_MCP_SERVER_NAME) {
                Ok(()) => {
                    let refreshed = self
                        .repo_runtime_load_mcp_status(&runtime)
                        .map_err(anyhow::Error::new)?;
                    let resolved = Self::repo_runtime_resolve_mcp_status(&refreshed);
                    mcp_server_status = resolved.0;
                    mcp_server_error = resolved.1;
                    mcp_failure_kind = resolved.2;
                }
                Err(error) => {
                    let mcp_message = format!(
                        "Failed to reconnect MCP server '{ODT_MCP_SERVER_NAME}': {}",
                        error.message
                    );
                    return self.store_repo_runtime_health(
                        runtime_kind,
                        repo_key,
                        RepoRuntimeHealthCheck {
                            runtime_ok: true,
                            runtime_error: None,
                            runtime_failure_kind: None,
                            runtime: Some(runtime.clone()),
                            mcp_ok: false,
                            mcp_error: Some(mcp_message.clone()),
                            mcp_failure_kind: Some(error.failure_kind),
                            mcp_server_name: ODT_MCP_SERVER_NAME.to_string(),
                            mcp_server_status,
                            mcp_server_error: Some(mcp_message.clone()),
                            available_tool_ids: Vec::new(),
                            checked_at: checked_at.to_string(),
                            errors: vec![mcp_message.clone()],
                            progress: Some(self.repo_runtime_progress(
                                reconnect_progress.stage,
                                reconnect_progress.observation,
                                reconnect_progress.host,
                                checked_at,
                                Some(mcp_message),
                                Some(error.failure_kind),
                                None,
                                Some(RepoRuntimeHealthFailureOrigin::McpConnect),
                                reconnect_progress.started_at,
                                Some(checked_at.to_string()),
                                reconnect_progress.elapsed_ms,
                                reconnect_progress.attempts,
                            )),
                        },
                    );
                }
            }
        }

        let available_tool_ids = self
            .repo_runtime_load_tool_ids(&runtime)
            .unwrap_or_default();
        let final_stage = if mcp_server_status.as_deref() == Some("connected") {
            RepoRuntimeHealthStage::Ready
        } else {
            RepoRuntimeHealthStage::CheckingMcpStatus
        };
        let mcp_ok = mcp_server_status.as_deref() == Some("connected");
        let mcp_error = if mcp_ok {
            None
        } else {
            Some(
                mcp_server_error
                    .clone()
                    .unwrap_or_else(|| "OpenDucktor MCP is unavailable.".to_string()),
            )
        };
        let progress = self.repo_runtime_progress(
            final_stage,
            observation,
            host_status,
            checked_at,
            mcp_error.clone(),
            mcp_failure_kind,
            None,
            if mcp_ok {
                None
            } else {
                Some(RepoRuntimeHealthFailureOrigin::McpStatus)
            },
            Some(runtime.started_at.clone()),
            Some(checked_at.to_string()),
            checking_progress.elapsed_ms,
            checking_progress.attempts,
        );

        self.store_repo_runtime_health(
            runtime_kind,
            repo_key,
            RepoRuntimeHealthCheck {
                runtime_ok: true,
                runtime_error: None,
                runtime_failure_kind: None,
                runtime: Some(runtime),
                mcp_ok,
                mcp_error: mcp_error.clone(),
                mcp_failure_kind,
                mcp_server_name: ODT_MCP_SERVER_NAME.to_string(),
                mcp_server_status,
                mcp_server_error: mcp_error.clone(),
                available_tool_ids,
                checked_at: checked_at.to_string(),
                errors: mcp_error.into_iter().collect(),
                progress: Some(progress),
            },
        )
    }

    fn acquire_runtime_ensure_flight(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
    ) -> Result<(Arc<super::service_core::RuntimeEnsureFlight>, bool)> {
        let key = Self::runtime_ensure_flight_key(runtime_kind, repo_key);
        let mut flights = self
            .runtime_ensure_flights
            .lock()
            .map_err(|_| anyhow!("Runtime ensure coordination state lock poisoned"))?;
        if let Some(existing) = flights.get(key.as_str()) {
            return Ok((existing.clone(), false));
        }

        let flight = Arc::new(super::service_core::RuntimeEnsureFlight::new());
        flights.insert(key, flight.clone());
        Ok((flight, true))
    }

    fn complete_runtime_ensure_flight(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        flight: &Arc<super::service_core::RuntimeEnsureFlight>,
        result: &Result<RuntimeInstanceSummary>,
    ) -> Result<()> {
        let stored_result = match result {
            Ok(summary) => Ok(summary.clone()),
            Err(error) => Err(format!("{error:#}")),
        };
        let mut poisoned = false;

        {
            let mut state = match flight.state.lock() {
                Ok(state) => state,
                Err(poisoned_state) => {
                    poisoned = true;
                    poisoned_state.into_inner()
                }
            };
            *state =
                super::service_core::RuntimeEnsureFlightState::Finished(Box::new(stored_result));
            flight.condvar.notify_all();
        }

        {
            let mut flights = match self.runtime_ensure_flights.lock() {
                Ok(flights) => flights,
                Err(poisoned_flights) => {
                    poisoned = true;
                    poisoned_flights.into_inner()
                }
            };
            let key = Self::runtime_ensure_flight_key(runtime_kind, repo_key);
            flights.remove(key.as_str());
        }

        if poisoned {
            return Err(anyhow!("Runtime ensure coordination state lock poisoned"));
        }

        Ok(())
    }

    fn wait_for_runtime_ensure_flight(
        flight: &Arc<super::service_core::RuntimeEnsureFlight>,
    ) -> Result<RuntimeInstanceSummary> {
        let mut state = flight
            .state
            .lock()
            .map_err(|_| anyhow!("Runtime ensure coordination state lock poisoned"))?;
        loop {
            match &*state {
                super::service_core::RuntimeEnsureFlightState::Starting => {
                    state = flight
                        .condvar
                        .wait(state)
                        .map_err(|_| anyhow!("Runtime ensure coordination state lock poisoned"))?;
                }
                super::service_core::RuntimeEnsureFlightState::Finished(result) => {
                    return result.as_ref().clone().map_err(|message| anyhow!(message));
                }
            }
        }
    }

    fn find_existing_workspace_runtime(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
    ) -> Result<Option<RuntimeInstanceSummary>> {
        let mut runtimes = self
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
        self.prune_stale_runtimes(&mut runtimes)?;
        Ok(Self::find_existing_runtime(
            &runtimes,
            RuntimeExistingLookup {
                repo_key,
                role: Self::WORKSPACE_RUNTIME_ROLE,
                task_id: None,
            },
        )
        .filter(|runtime| runtime.kind == runtime_kind))
    }

    pub(super) fn ensure_runtime_supports_all_workflow_scopes(
        runtime_kind: AgentRuntimeKind,
    ) -> Result<()> {
        let descriptor = runtime_kind.descriptor();
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
        let definitions = vec![AgentRuntimeKind::Opencode.descriptor()];
        for definition in &definitions {
            let validation_errors = definition.validate_for_openducktor();
            if !validation_errors.is_empty() {
                return Err(anyhow!(
                    "Runtime '{}' is incompatible with OpenDucktor: {}.",
                    definition.kind.as_str(),
                    validation_errors.join("; "),
                ));
            }
        }

        Ok(definitions)
    }

    pub fn runtime_list(
        &self,
        runtime_kind: &str,
        repo_path: Option<&str>,
    ) -> Result<Vec<RuntimeInstanceSummary>> {
        let supported_kind = Self::resolve_supported_runtime_kind(runtime_kind)?;
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
        let runtime_kind = Self::resolve_supported_runtime_kind(runtime_kind)?;
        Self::ensure_runtime_supports_all_workflow_scopes(runtime_kind)?;
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
            self.load_cached_opencode_session_statuses_for_targets(&probe_targets)?;
        let mut list = self.visible_run_summaries(exposure_plans, &statuses_by_target)?;

        list.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        Ok(list)
    }

    fn build_run_exposure_plans(
        &self,
        run_candidates: Vec<RunExposureCandidate>,
    ) -> Result<(
        Vec<RunExposurePlan>,
        Vec<super::OpencodeSessionStatusProbeTarget>,
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

            let probe_target = super::OpencodeSessionStatusProbeTarget::for_runtime_route(
                &run.summary.runtime_route,
                run.worktree_path.as_str(),
            );
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
            super::OpencodeSessionStatusProbeTarget,
            super::OpencodeSessionStatusMap,
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

    fn ensure_workspace_runtime(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_path: &str,
    ) -> Result<RuntimeInstanceSummary> {
        let repo_key = self.resolve_authorized_repo_path(repo_path)?;
        let repo_path = repo_key.as_str();

        if let Some(existing) =
            self.find_existing_workspace_runtime(runtime_kind, repo_key.as_str())?
        {
            return Ok(existing);
        }

        let (flight, is_leader) =
            self.acquire_runtime_ensure_flight(runtime_kind, repo_key.as_str())?;
        if !is_leader {
            return Self::wait_for_runtime_ensure_flight(&flight);
        }
        let mut flight_guard =
            RuntimeEnsureFlightGuard::new(self, runtime_kind, repo_key.as_str(), flight);
        let startup_started_at_instant = Instant::now();
        let startup_started_at = now_rfc3339();

        let startup_result = (|| -> Result<RuntimeInstanceSummary> {
            if let Some(existing) =
                self.find_existing_workspace_runtime(runtime_kind, repo_key.as_str())?
            {
                return Ok(existing);
            }

            let startup_error_context = format!(
                "{} workspace runtime failed to start for {repo_path}",
                runtime_kind.as_str()
            );
            let startup_policy = self.resolve_runtime_startup_policy(
                "workspace_runtime",
                repo_path,
                Self::WORKSPACE_RUNTIME_TASK_ID,
                Self::WORKSPACE_RUNTIME_ROLE,
                startup_error_context.as_str(),
            )?;

            self.spawn_and_register_runtime(RuntimeStartInput {
                runtime_kind,
                startup_scope: "workspace_runtime",
                repo_path,
                repo_key: repo_key.clone(),
                startup_started_at_instant,
                startup_started_at: startup_started_at.clone(),
                task_id: Self::WORKSPACE_RUNTIME_TASK_ID,
                role: Self::WORKSPACE_RUNTIME_ROLE,
                startup_policy,
                working_directory: repo_key.clone(),
                cleanup_target: None,
                tracking_error_context: "Failed tracking spawned OpenCode workspace runtime",
                startup_error_context,
                post_start_policy: Some(RuntimePostStartPolicy {
                    existing_lookup: RuntimeExistingLookup {
                        repo_key: repo_key.as_str(),
                        role: Self::WORKSPACE_RUNTIME_ROLE,
                        task_id: None,
                    },
                    prune_error_context: format!(
                        "Failed pruning stale runtimes while finalizing workspace runtime for {repo_path}"
                    ),
                }),
            })
        })();
        if let Err(error) = startup_result.as_ref() {
            let startup_failure = error
                .chain()
                .find_map(|cause| cause.downcast_ref::<super::OpencodeStartupWaitFailure>());
            let (failure_kind, failure_reason, attempts, elapsed_ms) = match startup_failure {
                Some(failure) => (
                    if failure.reason == "timeout" {
                        RepoRuntimeStartupFailureKind::Timeout
                    } else {
                        RepoRuntimeStartupFailureKind::Error
                    },
                    failure.reason,
                    Some(failure.report().attempts()),
                    Some(failure.report().startup_ms()),
                ),
                None => (RepoRuntimeStartupFailureKind::Error, "error", None, None),
            };
            self.mark_runtime_startup_failed(
                runtime_kind,
                repo_key.as_str(),
                failure_kind,
                failure_reason,
                format!("{error:#}"),
                startup_started_at_instant,
                startup_started_at.as_str(),
                attempts,
                elapsed_ms,
            )?;
        }
        flight_guard.complete(&startup_result)?;
        startup_result
    }

    fn spawn_and_register_runtime(
        &self,
        input: RuntimeStartInput<'_>,
    ) -> Result<RuntimeInstanceSummary> {
        let spawned_server = self.spawn_runtime_server(&input)?;
        let startup_started_at_instant = spawned_server.startup_started_at_instant;
        let startup_started_at = spawned_server.startup_started_at.clone();
        let startup_report = spawned_server.startup_report;
        let runtime_kind = input.runtime_kind;
        let repo_key = input.repo_key.clone();
        let summary = self.attach_runtime_session(input, spawned_server)?;
        self.mark_runtime_startup_ready(
            runtime_kind,
            repo_key.as_str(),
            &summary,
            startup_started_at_instant,
            startup_started_at.as_str(),
            startup_report.attempts(),
            startup_report.startup_ms(),
        )?;
        Ok(summary)
    }

    pub(super) fn resolve_supported_runtime_kind(runtime_kind: &str) -> Result<AgentRuntimeKind> {
        match runtime_kind.trim() {
            "opencode" => Ok(AgentRuntimeKind::Opencode),
            other => Err(anyhow!("Unsupported agent runtime kind: {other}")),
        }
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
    use super::{AppService, RuntimeEnsureFlightGuard};
    use crate::app_service::test_support::{build_service_with_state, make_task};
    use crate::app_service::{AgentRuntimeProcess, RunProcess};
    use anyhow::{anyhow, Result};
    use host_domain::{
        AgentRuntimeKind, AgentSessionDocument, RepoRuntimeHealthObservation,
        RepoRuntimeHealthStage, RepoRuntimeStartupFailureKind, RepoRuntimeStartupStage, RunSummary,
        TaskStatus,
    };
    use host_infra_system::RepoConfig;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::process::Command;
    use std::thread;
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
                    child,
                    _opencode_process_guard: None,
                    cleanup_target: None,
                },
            );
        Ok(())
    }

    #[test]
    fn runtime_ensure_flight_guard_finishes_waiters_when_dropped_uncompleted() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let repo_key = "/tmp/runtime-flight-guard";
        let (flight, is_leader) =
            service.acquire_runtime_ensure_flight(AgentRuntimeKind::Opencode, repo_key)?;
        assert!(is_leader);

        {
            let _guard = RuntimeEnsureFlightGuard::new(
                &service,
                AgentRuntimeKind::Opencode,
                repo_key,
                flight.clone(),
            );
        }

        let error = AppService::wait_for_runtime_ensure_flight(&flight)
            .expect_err("dropped leader should finish waiters with an error");
        assert!(error
            .to_string()
            .contains("Runtime ensure aborted unexpectedly"));

        Ok(())
    }

    #[test]
    fn complete_runtime_ensure_flight_recovers_poisoned_state_and_removes_entry() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let repo_key = "/tmp/runtime-flight-poison";
        let (flight, is_leader) =
            service.acquire_runtime_ensure_flight(AgentRuntimeKind::Opencode, repo_key)?;
        assert!(is_leader);

        let poison_handle = thread::spawn({
            let flight = flight.clone();
            move || {
                let _lock = flight
                    .state
                    .lock()
                    .expect("flight state should be available for poisoning");
                panic!("poison runtime ensure flight state");
            }
        });
        assert!(poison_handle.join().is_err());

        let error = service
            .complete_runtime_ensure_flight(
                AgentRuntimeKind::Opencode,
                repo_key,
                &flight,
                &Err(anyhow!("simulated startup failure")),
            )
            .expect_err("poisoned completion should surface an error");
        assert!(error
            .to_string()
            .contains("Runtime ensure coordination state lock poisoned"));

        let flights = service
            .runtime_ensure_flights
            .lock()
            .expect("runtime ensure flights lock should remain available");
        assert!(flights.is_empty());

        Ok(())
    }

    #[test]
    fn runtime_startup_status_tracks_waiting_and_failure_stages() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let repo_path = "/tmp/runtime-startup-status";
        let started_at_instant = Instant::now();
        let started_at = "2026-04-04T16:00:00Z";

        service.mark_runtime_startup_requested(
            AgentRuntimeKind::Opencode,
            repo_path,
            started_at_instant,
            started_at,
        )?;
        service.mark_runtime_startup_waiting(
            AgentRuntimeKind::Opencode,
            repo_path,
            started_at_instant,
            started_at,
            3,
        )?;

        let waiting_status = service.runtime_startup_status("opencode", repo_path)?;
        assert_eq!(
            waiting_status.stage,
            RepoRuntimeStartupStage::WaitingForRuntime
        );
        assert_eq!(waiting_status.attempts, Some(3));
        assert_eq!(waiting_status.started_at.as_deref(), Some(started_at));

        service.mark_runtime_startup_failed(
            AgentRuntimeKind::Opencode,
            repo_path,
            RepoRuntimeStartupFailureKind::Timeout,
            "timeout",
            "OpenCode startup probe failed reason=timeout".to_string(),
            started_at_instant,
            started_at,
            Some(4),
            Some(4200),
        )?;

        let failed_status = service.runtime_startup_status("opencode", repo_path)?;
        assert_eq!(failed_status.stage, RepoRuntimeStartupStage::StartupFailed);
        assert_eq!(
            failed_status.failure_kind,
            Some(RepoRuntimeStartupFailureKind::Timeout)
        );
        assert_eq!(failed_status.failure_reason.as_deref(), Some("timeout"));
        assert_eq!(failed_status.attempts, Some(4));
        assert_eq!(failed_status.elapsed_ms, Some(4200));

        Ok(())
    }

    #[test]
    fn repo_runtime_health_reports_ready_connected_runtime() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let (port, server_handle) = spawn_runtime_http_server(vec![
            runtime_http_response(
                "200 OK",
                r#"{"data":{"openducktor":{"status":"connected"}}}"#,
            ),
            runtime_http_response("200 OK", r#"{"data":["odt_read_task"]}"#),
        ])?;
        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::Opencode,
            runtime_id: "runtime-ready".to_string(),
            repo_path: "/tmp/repo-health-ready".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-ready".to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: format!("http://127.0.0.1:{port}"),
            },
            started_at: "2026-04-04T16:00:00Z".to_string(),
            descriptor: AgentRuntimeKind::Opencode.descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;

        let health = service.repo_runtime_health("opencode", "/tmp/repo-health-ready")?;
        let requests = server_handle.join().expect("server thread should finish");

        assert!(requests[0].starts_with("GET /mcp?directory=%2Ftmp%2Frepo-health-ready "));
        assert!(requests[1]
            .starts_with("GET /experimental/tool/ids?directory=%2Ftmp%2Frepo-health-ready "));
        assert!(health.runtime_ok);
        assert!(health.mcp_ok);
        assert_eq!(health.available_tool_ids, vec!["odt_read_task"]);
        assert_eq!(
            health.progress.as_ref().map(|value| value.stage),
            Some(RepoRuntimeHealthStage::Ready)
        );
        assert_eq!(
            health.progress.as_ref().and_then(|value| value.observation),
            Some(RepoRuntimeHealthObservation::ObservedExistingRuntime)
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
                r#"{"data":{"openducktor":{"status":"disconnected","error":"not connected"}}}"#,
            ),
            runtime_http_response("200 OK", r#"{"data":true}"#),
            runtime_http_response(
                "200 OK",
                r#"{"data":{"openducktor":{"status":"connected"}}}"#,
            ),
            runtime_http_response("200 OK", r#"{"data":["odt_read_task"]}"#),
        ])?;
        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::Opencode,
            runtime_id: "runtime-reconnect".to_string(),
            repo_path: "/tmp/repo-health-reconnect".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-reconnect".to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: format!("http://127.0.0.1:{port}"),
            },
            started_at: "2026-04-04T16:00:00Z".to_string(),
            descriptor: AgentRuntimeKind::Opencode.descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;

        let health = service.repo_runtime_health("opencode", "/tmp/repo-health-reconnect")?;
        let requests = server_handle.join().expect("server thread should finish");

        assert!(requests[1].starts_with(
            "POST /mcp/openducktor/connect?directory=%2Ftmp%2Frepo-health-reconnect "
        ));
        assert!(health.runtime_ok);
        assert!(health.mcp_ok);
        assert_eq!(health.available_tool_ids, vec!["odt_read_task"]);
        service.runtime_stop(runtime.runtime_id.as_str())?;
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
            kind: AgentRuntimeKind::Opencode,
            runtime_id: "runtime-active-run".to_string(),
            repo_path: "/tmp/repo-health-active-run".to_string(),
            task_id: None,
            role: host_domain::RuntimeRole::Workspace,
            working_directory: "/tmp/repo-health-active-run".to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: format!("http://127.0.0.1:{port}"),
            },
            started_at: "2026-04-04T16:00:00Z".to_string(),
            descriptor: AgentRuntimeKind::Opencode.descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone())?;
        service.runs.lock().expect("runs lock poisoned").insert(
            "run-1".to_string(),
            RunProcess {
                summary: RunSummary {
                    run_id: "run-1".to_string(),
                    runtime_kind: AgentRuntimeKind::Opencode,
                    runtime_route: runtime.runtime_route.clone(),
                    repo_path: runtime.repo_path.clone(),
                    task_id: "task-1".to_string(),
                    branch: "odt/task-1".to_string(),
                    worktree_path: runtime.working_directory.clone(),
                    port,
                    state: host_domain::RunState::Running,
                    last_message: None,
                    started_at: "2026-04-04T16:00:10Z".to_string(),
                },
                child: None,
                _opencode_process_guard: None,
                repo_path: runtime.repo_path.clone(),
                task_id: "task-1".to_string(),
                worktree_path: runtime.working_directory.clone(),
                repo_config: RepoConfig::default(),
            },
        );

        let health = service.repo_runtime_health("opencode", "/tmp/repo-health-active-run")?;
        let _requests = server_handle.join().expect("server thread should finish");

        assert!(health.runtime_ok);
        assert!(!health.mcp_ok);
        assert!(health
            .mcp_error
            .as_deref()
            .is_some_and(|value| value.contains("restart was skipped")));
        assert_eq!(
            health.progress.as_ref().map(|value| value.stage),
            Some(RepoRuntimeHealthStage::RestartSkippedActiveRun)
        );
        assert_eq!(
            health.progress.as_ref().and_then(|value| value.observation),
            Some(RepoRuntimeHealthObservation::RestartSkippedActiveRun)
        );
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
                        runtime_kind: AgentRuntimeKind::Opencode,
                        runtime_route: host_domain::RuntimeRoute::LocalHttp {
                            endpoint: format!("http://127.0.0.1:{port}"),
                        },
                        repo_path: "/tmp/repo".to_string(),
                        task_id: "task-1".to_string(),
                        branch: "odt/task-1".to_string(),
                        worktree_path: "/tmp/repo/worktree".to_string(),
                        port,
                        state: host_domain::RunState::Running,
                        last_message: None,
                        started_at: "2026-03-17T11:00:00Z".to_string(),
                    },
                    child: None,
                    _opencode_process_guard: None,
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
                        runtime_kind: AgentRuntimeKind::Opencode,
                        runtime_route: host_domain::RuntimeRoute::LocalHttp {
                            endpoint: format!("http://127.0.0.1:{port}"),
                        },
                        repo_path: "/tmp/repo".to_string(),
                        task_id: "task-1".to_string(),
                        branch: "odt/task-1".to_string(),
                        worktree_path: "/tmp/repo/worktree".to_string(),
                        port,
                        state: host_domain::RunState::Running,
                        last_message: None,
                        started_at: "2026-03-17T11:00:00Z".to_string(),
                    },
                    child: None,
                    _opencode_process_guard: None,
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
                            runtime_kind: AgentRuntimeKind::Opencode,
                            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                                endpoint: format!("http://127.0.0.1:{port}"),
                            },
                            repo_path: "/tmp/repo".to_string(),
                            task_id: format!("task-{index}"),
                            branch: format!("odt/task-{index}"),
                            worktree_path: format!("/tmp/repo/worktree-{index}"),
                            port,
                            state: host_domain::RunState::Running,
                            last_message: None,
                            started_at: format!("2026-03-17T11:00:0{index}Z"),
                        },
                        child: None,
                        _opencode_process_guard: None,
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
