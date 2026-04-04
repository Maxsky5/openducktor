use super::AppService;
use crate::app_service::OpencodeStartupWaitFailure;
use anyhow::{anyhow, Result};
use host_domain::{
    now_rfc3339, AgentRuntimeKind, RepoRuntimeHealthCheck, RepoRuntimeHealthFailureOrigin,
    RepoRuntimeHealthObservation, RepoRuntimeHealthProgress, RepoRuntimeHealthStage,
    RepoRuntimeStartupFailureKind, RepoRuntimeStartupStage, RepoRuntimeStartupStatus, RunState,
    RuntimeInstanceSummary, RuntimeRoute,
};
use serde::{de::DeserializeOwned, Deserialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, ErrorKind, Read, Write};
use std::net::TcpStream;
use std::time::Duration;
use url::{form_urlencoded, Url};

const ODT_MCP_SERVER_NAME: &str = "openducktor";
const RUNTIME_HEALTH_HTTP_TIMEOUT: Duration = Duration::from_secs(5);

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

struct RepoRuntimeHealthHttpClient<'a> {
    endpoint: &'a str,
}

impl<'a> RepoRuntimeHealthHttpClient<'a> {
    fn new(endpoint: &'a str) -> Self {
        Self { endpoint }
    }

    fn load_mcp_status(
        &self,
        working_directory: &str,
    ) -> std::result::Result<HashMap<String, RuntimeHealthMcpServerStatus>, RuntimeHealthHttpFailure>
    {
        self.request_json(
            "GET",
            Self::mcp_status_path(working_directory).as_str(),
            "load MCP status",
        )
    }

    fn connect_mcp_server(
        &self,
        name: &str,
        working_directory: &str,
    ) -> std::result::Result<(), RuntimeHealthHttpFailure> {
        let _: serde_json::Value = self.request_json(
            "POST",
            Self::connect_mcp_path(name, working_directory).as_str(),
            "connect MCP server",
        )?;
        Ok(())
    }

    fn load_tool_ids(
        &self,
        working_directory: &str,
    ) -> std::result::Result<Vec<String>, RuntimeHealthHttpFailure> {
        self.request_json(
            "GET",
            Self::tool_ids_path(working_directory).as_str(),
            "list tool ids",
        )
    }

    fn request_json<T: DeserializeOwned>(
        &self,
        method: &str,
        request_path: &str,
        action: &str,
    ) -> std::result::Result<T, RuntimeHealthHttpFailure> {
        let parsed_endpoint =
            Url::parse(self.endpoint).map_err(|error| RuntimeHealthHttpFailure {
                failure_kind: RepoRuntimeStartupFailureKind::Error,
                message: format!(
                    "Invalid OpenCode runtime endpoint {}: {error}",
                    self.endpoint
                ),
            })?;
        let host = parsed_endpoint
            .host_str()
            .ok_or_else(|| RuntimeHealthHttpFailure {
                failure_kind: RepoRuntimeStartupFailureKind::Error,
                message: format!(
                    "OpenCode runtime endpoint is missing a host: {}",
                    self.endpoint
                ),
            })?;
        let port = parsed_endpoint
            .port()
            .ok_or_else(|| RuntimeHealthHttpFailure {
                failure_kind: RepoRuntimeStartupFailureKind::Error,
                message: format!(
                    "OpenCode runtime endpoint is missing a port: {}",
                    self.endpoint
                ),
            })?;

        let mut stream =
            TcpStream::connect((host, port)).map_err(|error| RuntimeHealthHttpFailure {
                failure_kind: classify_runtime_health_io_failure(&error),
                message: format!(
                    "Failed to connect to OpenCode runtime at {} to {action}: {error}",
                    self.endpoint
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

    fn mcp_status_path(working_directory: &str) -> String {
        format!(
            "/mcp?{}",
            form_urlencoded::Serializer::new(String::new())
                .append_pair("directory", working_directory)
                .finish()
        )
    }

    fn tool_ids_path(working_directory: &str) -> String {
        format!(
            "/experimental/tool/ids?{}",
            form_urlencoded::Serializer::new(String::new())
                .append_pair("directory", working_directory)
                .finish()
        )
    }

    fn connect_mcp_path(name: &str, working_directory: &str) -> String {
        let encoded_name: String = form_urlencoded::byte_serialize(name.as_bytes()).collect();
        format!(
            "/mcp/{encoded_name}/connect?{}",
            form_urlencoded::Serializer::new(String::new())
                .append_pair("directory", working_directory)
                .finish()
        )
    }
}

impl AppService {
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

    pub(super) fn clear_repo_runtime_health_status_for_runtime(
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
            map_startup_stage_to_health(startup_status.stage),
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

        Ok(Self::build_repo_runtime_health_check(
            checked_at,
            startup_status.runtime.clone(),
            matches!(
                progress.stage,
                RepoRuntimeHealthStage::RuntimeReady | RepoRuntimeHealthStage::Ready
            ),
            match progress.stage {
                RepoRuntimeHealthStage::StartupFailed
                | RepoRuntimeHealthStage::StartupRequested
                | RepoRuntimeHealthStage::WaitingForRuntime => startup_status.detail,
                _ => None,
            },
            startup_status.failure_kind,
            false,
            (!matches!(
                progress.stage,
                RepoRuntimeHealthStage::RuntimeReady | RepoRuntimeHealthStage::Ready
            ))
            .then(|| "Runtime is unavailable, so MCP cannot be verified.".to_string()),
            startup_status.failure_kind,
            None,
            Vec::new(),
            Some(progress),
        ))
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
                    .downcast_ref::<OpencodeStartupWaitFailure>()
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
                .downcast_ref::<OpencodeStartupWaitFailure>()
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

    fn repo_runtime_client(runtime: &RuntimeInstanceSummary) -> RepoRuntimeHealthHttpClient<'_> {
        match &runtime.runtime_route {
            RuntimeRoute::LocalHttp { endpoint } => {
                RepoRuntimeHealthHttpClient::new(endpoint.as_str())
            }
        }
    }

    fn repo_runtime_load_mcp_status(
        &self,
        runtime: &RuntimeInstanceSummary,
    ) -> std::result::Result<HashMap<String, RuntimeHealthMcpServerStatus>, RuntimeHealthHttpFailure>
    {
        Self::repo_runtime_client(runtime).load_mcp_status(runtime.working_directory.as_str())
    }

    fn repo_runtime_connect_mcp_server(
        &self,
        runtime: &RuntimeInstanceSummary,
        name: &str,
    ) -> std::result::Result<(), RuntimeHealthHttpFailure> {
        Self::repo_runtime_client(runtime)
            .connect_mcp_server(name, runtime.working_directory.as_str())
    }

    fn repo_runtime_load_tool_ids(
        &self,
        runtime: &RuntimeInstanceSummary,
    ) -> std::result::Result<Vec<String>, RuntimeHealthHttpFailure> {
        Self::repo_runtime_client(runtime).load_tool_ids(runtime.working_directory.as_str())
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
                        map_startup_stage_to_failed_health(latest_host_status.stage),
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
                    return self.store_repo_runtime_health(
                        runtime_kind,
                        repo_key.as_str(),
                        Self::build_repo_runtime_health_check(
                            checked_at,
                            None,
                            false,
                            Some(format!("{error:#}")),
                            Some(Self::repo_runtime_timeout_kind(&error)),
                            false,
                            Some("Runtime is unavailable, so MCP cannot be verified.".to_string()),
                            Some(Self::repo_runtime_timeout_kind(&error)),
                            None,
                            Vec::new(),
                            Some(progress),
                        ),
                    );
                }
            },
        };

        host_status = Some(self.runtime_startup_status(runtime_kind.as_str(), repo_key.as_str())?);
        if !runtime.descriptor.capabilities.supports_mcp_status {
            let progress = self.repo_runtime_progress(
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
            );
            return self.store_repo_runtime_health(
                runtime_kind,
                repo_key.as_str(),
                Self::build_repo_runtime_health_check(
                    checked_at,
                    Some(runtime),
                    true,
                    None,
                    None,
                    true,
                    None,
                    None,
                    None,
                    Vec::new(),
                    Some(progress),
                ),
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
            Self::build_repo_runtime_health_check(
                checked_at.to_string(),
                Some(runtime.clone()),
                true,
                None,
                None,
                false,
                None,
                None,
                None,
                Vec::new(),
                Some(checking_progress.clone()),
            ),
        )?;

        let status_by_server = match self.repo_runtime_load_mcp_status(&runtime) {
            Ok(status_by_server) => status_by_server,
            Err(error) => {
                if allow_restart
                    && Self::repo_runtime_should_restart_for_mcp_status_error(
                        error.message.as_str(),
                    )
                {
                    let runtime_endpoint = match &runtime.runtime_route {
                        RuntimeRoute::LocalHttp { endpoint } => endpoint.as_str(),
                    };
                    let has_active_run = self.runs_list(Some(repo_key))?.iter().any(|run| {
                        matches!(
                            run.state,
                            RunState::Starting
                                | RunState::Running
                                | RunState::Blocked
                                | RunState::AwaitingDoneConfirmation
                        ) && matches!(&run.runtime_route, RuntimeRoute::LocalHttp { endpoint } if endpoint == runtime_endpoint)
                    });
                    if has_active_run {
                        let skipped_message = format!(
                            "Failed to query runtime MCP status: {}. Automatic runtime restart was skipped because an active run is using this runtime.",
                            error.message
                        );
                        return self.store_repo_runtime_health(
                            runtime_kind,
                            repo_key,
                            Self::build_repo_runtime_health_check(
                                checked_at.to_string(),
                                Some(runtime.clone()),
                                true,
                                None,
                                None,
                                false,
                                Some(skipped_message.clone()),
                                Some(error.failure_kind),
                                None,
                                Vec::new(),
                                Some(self.repo_runtime_progress(
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
                            ),
                        );
                    }

                    self.update_repo_runtime_health_status(
                        runtime_kind,
                        repo_key,
                        Self::build_repo_runtime_health_check(
                            checked_at.to_string(),
                            Some(runtime.clone()),
                            true,
                            None,
                            None,
                            false,
                            Some(error.message.clone()),
                            Some(error.failure_kind),
                            None,
                            Vec::new(),
                            Some(self.repo_runtime_progress(
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
                        ),
                    )?;

                    if let Err(stop_error) = self.runtime_stop(runtime.runtime_id.as_str()) {
                        let stop_message =
                            format!("Failed to stop runtime before MCP recovery: {stop_error:#}");
                        return self.store_repo_runtime_health(
                            runtime_kind,
                            repo_key,
                            Self::build_repo_runtime_health_check(
                                checked_at.to_string(),
                                Some(runtime.clone()),
                                true,
                                None,
                                None,
                                false,
                                Some(stop_message.clone()),
                                Some(RepoRuntimeStartupFailureKind::Error),
                                None,
                                Vec::new(),
                                Some(self.repo_runtime_progress(
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
                            ),
                        );
                    }

                    return match self.ensure_workspace_runtime(runtime_kind, repo_key) {
                        Ok(restarted_runtime) => self.complete_repo_runtime_health(
                            repo_key,
                            checked_at,
                            runtime_kind,
                            restarted_runtime,
                            Some(self.runtime_startup_status(runtime_kind.as_str(), repo_key)?),
                            Some(RepoRuntimeHealthObservation::RestartedForMcp),
                            false,
                        ),
                        Err(restart_error) => {
                            let latest_host_status =
                                self.runtime_startup_status(runtime_kind.as_str(), repo_key)?;
                            self.store_repo_runtime_health(
                                runtime_kind,
                                repo_key,
                                Self::build_repo_runtime_health_check(
                                    checked_at.to_string(),
                                    None,
                                    false,
                                    Some(format!("{restart_error:#}")),
                                    Some(Self::repo_runtime_timeout_kind(&restart_error)),
                                    false,
                                    Some(
                                        "Runtime is unavailable, so MCP cannot be verified."
                                            .to_string(),
                                    ),
                                    Some(Self::repo_runtime_timeout_kind(&restart_error)),
                                    None,
                                    Vec::new(),
                                    Some(self.repo_runtime_progress(
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
                                ),
                            )
                        }
                    };
                }

                let mcp_message = format!("Failed to query runtime MCP status: {}", error.message);
                return self.store_repo_runtime_health(
                    runtime_kind,
                    repo_key,
                    Self::build_repo_runtime_health_check(
                        checked_at.to_string(),
                        Some(runtime.clone()),
                        true,
                        None,
                        None,
                        false,
                        Some(mcp_message.clone()),
                        Some(error.failure_kind),
                        None,
                        Vec::new(),
                        Some(self.repo_runtime_progress(
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
                    ),
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
                Self::build_repo_runtime_health_check(
                    checked_at.to_string(),
                    Some(runtime.clone()),
                    true,
                    None,
                    None,
                    false,
                    mcp_server_error.clone(),
                    mcp_failure_kind,
                    mcp_server_status.clone(),
                    Vec::new(),
                    Some(reconnect_progress.clone()),
                ),
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
                        Self::build_repo_runtime_health_check(
                            checked_at.to_string(),
                            Some(runtime.clone()),
                            true,
                            None,
                            None,
                            false,
                            Some(mcp_message.clone()),
                            Some(error.failure_kind),
                            mcp_server_status,
                            Vec::new(),
                            Some(self.repo_runtime_progress(
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
                        ),
                    );
                }
            }
        }

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
            if mcp_ok {
                RepoRuntimeHealthStage::Ready
            } else {
                RepoRuntimeHealthStage::CheckingMcpStatus
            },
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
            Self::build_repo_runtime_health_check(
                checked_at.to_string(),
                Some(runtime.clone()),
                true,
                None,
                None,
                mcp_ok,
                mcp_error,
                mcp_failure_kind,
                mcp_server_status,
                self.repo_runtime_load_tool_ids(&runtime)
                    .unwrap_or_default(),
                Some(progress),
            ),
        )
    }

    fn build_repo_runtime_health_check(
        checked_at: impl Into<String>,
        runtime: Option<RuntimeInstanceSummary>,
        runtime_ok: bool,
        runtime_error: Option<String>,
        runtime_failure_kind: Option<RepoRuntimeStartupFailureKind>,
        mcp_ok: bool,
        mcp_error: Option<String>,
        mcp_failure_kind: Option<RepoRuntimeStartupFailureKind>,
        mcp_server_status: Option<String>,
        available_tool_ids: Vec<String>,
        progress: Option<RepoRuntimeHealthProgress>,
    ) -> RepoRuntimeHealthCheck {
        let checked_at = checked_at.into();
        let mcp_server_error = mcp_error.clone();
        let mut errors = Vec::new();
        if let Some(error) = runtime_error.clone() {
            errors.push(error);
        }
        if let Some(error) = mcp_error.clone() {
            if errors.last() != Some(&error) {
                errors.push(error);
            }
        }

        RepoRuntimeHealthCheck {
            runtime_ok,
            runtime_error,
            runtime_failure_kind,
            runtime,
            mcp_ok,
            mcp_error,
            mcp_failure_kind,
            mcp_server_name: ODT_MCP_SERVER_NAME.to_string(),
            mcp_server_status,
            mcp_server_error,
            available_tool_ids,
            checked_at,
            errors,
            progress,
        }
    }
}

fn map_startup_stage_to_health(stage: RepoRuntimeStartupStage) -> RepoRuntimeHealthStage {
    match stage {
        RepoRuntimeStartupStage::Idle => RepoRuntimeHealthStage::Idle,
        RepoRuntimeStartupStage::StartupRequested => RepoRuntimeHealthStage::StartupRequested,
        RepoRuntimeStartupStage::WaitingForRuntime => RepoRuntimeHealthStage::WaitingForRuntime,
        RepoRuntimeStartupStage::RuntimeReady => RepoRuntimeHealthStage::RuntimeReady,
        RepoRuntimeStartupStage::StartupFailed => RepoRuntimeHealthStage::StartupFailed,
    }
}

fn map_startup_stage_to_failed_health(stage: RepoRuntimeStartupStage) -> RepoRuntimeHealthStage {
    match stage {
        RepoRuntimeStartupStage::Idle => RepoRuntimeHealthStage::StartupFailed,
        RepoRuntimeStartupStage::StartupRequested => RepoRuntimeHealthStage::StartupRequested,
        RepoRuntimeStartupStage::WaitingForRuntime => RepoRuntimeHealthStage::WaitingForRuntime,
        RepoRuntimeStartupStage::RuntimeReady => RepoRuntimeHealthStage::RuntimeReady,
        RepoRuntimeStartupStage::StartupFailed => RepoRuntimeHealthStage::StartupFailed,
    }
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
