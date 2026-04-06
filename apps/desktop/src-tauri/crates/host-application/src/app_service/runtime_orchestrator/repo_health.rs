use super::repo_health_snapshot::{
    build_repo_runtime_health_check, map_startup_stage_to_failed_health,
    map_startup_stage_to_health, repo_runtime_progress, RepoRuntimeHealthCheckInput,
    RepoRuntimeProgressInput, RuntimeHealthWorkflowStage,
};
use super::AppService;
use crate::app_service::service_core::{RepoRuntimeHealthFlight, RepoRuntimeHealthFlightState};
use crate::app_service::OpencodeStartupWaitFailure;
use anyhow::{anyhow, Result};
use host_domain::{
    now_rfc3339, AgentRuntimeKind, RepoRuntimeHealthCheck, RepoRuntimeHealthObservation,
    RepoRuntimeStartupFailureKind, RepoRuntimeStartupStage, RepoRuntimeStartupStatus, RunState,
    RuntimeInstanceSummary, RuntimeRoute,
};
use reqwest::blocking::Client;
use serde::{de::DeserializeOwned, Deserialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use url::{form_urlencoded, Url};

const ODT_MCP_SERVER_NAME: &str = "openducktor";
const RUNTIME_HEALTH_HTTP_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Copy)]
enum RuntimeHealthHttpMethod {
    Get,
    Post,
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

impl RuntimeHealthHttpFailure {
    fn error(message: String) -> Self {
        Self {
            failure_kind: RepoRuntimeStartupFailureKind::Error,
            message,
        }
    }

    fn from_request_error(action: &str, error: &reqwest::Error) -> Self {
        Self {
            failure_kind: classify_runtime_health_request_failure(error),
            message: format!("Failed to query OpenCode runtime to {action}: {error}"),
        }
    }

    fn from_response_body_error(action: &str, error: reqwest::Error) -> Self {
        Self {
            failure_kind: classify_runtime_health_request_failure(&error),
            message: format!("Failed to read OpenCode runtime response body for {action}: {error}"),
        }
    }
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
struct RuntimeHealthMcpServerStatus {
    status: String,
    error: Option<String>,
}

struct RepoRuntimeHealthHttpClient<'a> {
    endpoint: &'a str,
}

struct RuntimeHealthHttpResponse {
    status_code: u16,
    body: String,
}

struct ResolvedMcpServerStatus {
    status: Option<String>,
    error: Option<String>,
    failure_kind: Option<RepoRuntimeStartupFailureKind>,
}

impl ResolvedMcpServerStatus {
    fn connected() -> Self {
        Self {
            status: Some("connected".to_string()),
            error: None,
            failure_kind: None,
        }
    }

    fn unavailable(status: Option<String>, error: String) -> Self {
        Self {
            status,
            error: Some(error),
            failure_kind: Some(RepoRuntimeStartupFailureKind::Error),
        }
    }

    fn is_connected(&self) -> bool {
        self.status.as_deref() == Some("connected")
    }
}

struct CompleteRepoRuntimeHealthInput {
    repo_key: String,
    checked_at: String,
    runtime_kind: AgentRuntimeKind,
    runtime: RuntimeInstanceSummary,
    host_status: Option<RepoRuntimeStartupStatus>,
    observation: Option<RepoRuntimeHealthObservation>,
    allow_restart: bool,
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
            RuntimeHealthHttpMethod::Get,
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
            RuntimeHealthHttpMethod::Post,
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
            RuntimeHealthHttpMethod::Get,
            Self::tool_ids_path(working_directory).as_str(),
            "list tool ids",
        )
    }

    fn request_json<T: DeserializeOwned>(
        &self,
        method: RuntimeHealthHttpMethod,
        request_path: &str,
        action: &str,
    ) -> std::result::Result<T, RuntimeHealthHttpFailure> {
        let RuntimeHealthHttpResponse { status_code, body } =
            self.send_request(method, request_path, action)?;
        if !(200..300).contains(&status_code) {
            return Err(runtime_health_http_status_failure(
                status_code,
                body.as_str(),
                action,
            ));
        }

        parse_runtime_health_json(body.as_str(), action)
    }

    fn send_request(
        &self,
        method: RuntimeHealthHttpMethod,
        request_path: &str,
        action: &str,
    ) -> std::result::Result<RuntimeHealthHttpResponse, RuntimeHealthHttpFailure> {
        let url = self.request_url(request_path, action)?;
        let client = self.http_client(action)?;
        let response = self
            .build_request(&client, method, url)
            .send()
            .map_err(|error| RuntimeHealthHttpFailure::from_request_error(action, &error))?;
        let status_code = response.status().as_u16();
        let body = response
            .text()
            .map_err(|error| RuntimeHealthHttpFailure::from_response_body_error(action, error))?;

        Ok(RuntimeHealthHttpResponse { status_code, body })
    }

    fn request_url(
        &self,
        request_path: &str,
        action: &str,
    ) -> std::result::Result<Url, RuntimeHealthHttpFailure> {
        let endpoint = Url::parse(self.endpoint).map_err(|error| {
            RuntimeHealthHttpFailure::error(format!(
                "Invalid OpenCode runtime endpoint {}: {error}",
                self.endpoint
            ))
        })?;
        endpoint.join(request_path).map_err(|error| {
            RuntimeHealthHttpFailure::error(format!(
                "Failed to build OpenCode runtime request URL for {action}: {error}"
            ))
        })
    }

    fn http_client(&self, action: &str) -> std::result::Result<Client, RuntimeHealthHttpFailure> {
        Client::builder()
            .timeout(RUNTIME_HEALTH_HTTP_TIMEOUT)
            .build()
            .map_err(|error| {
                RuntimeHealthHttpFailure::error(format!(
                    "Failed to build OpenCode runtime HTTP client for {action}: {error}"
                ))
            })
    }

    fn build_request(
        &self,
        client: &Client,
        method: RuntimeHealthHttpMethod,
        url: Url,
    ) -> reqwest::blocking::RequestBuilder {
        match method {
            RuntimeHealthHttpMethod::Get => client.get(url),
            RuntimeHealthHttpMethod::Post => client.post(url),
        }
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
        let progress = repo_runtime_progress(RepoRuntimeProgressInput {
            stage: map_startup_stage_to_health(startup_status.stage),
            observation: Self::repo_runtime_health_observation(
                startup_status.runtime.is_some(),
                Some(&startup_status),
            ),
            host: Some(startup_status.clone()),
            checked_at: checked_at.clone(),
            failure_reason: startup_status.failure_reason.clone(),
            started_at: startup_status.started_at.clone(),
            updated_at: Some(startup_status.updated_at.clone()),
            elapsed_ms: startup_status.elapsed_ms,
            attempts: startup_status.attempts,
        });

        Ok(build_repo_runtime_health_check(
            RepoRuntimeHealthCheckInput {
                checked_at,
                runtime: startup_status.runtime.clone(),
                runtime_ok: matches!(
                    progress.stage,
                    RuntimeHealthWorkflowStage::RuntimeReady | RuntimeHealthWorkflowStage::Ready
                ),
                runtime_error: match progress.stage {
                    RuntimeHealthWorkflowStage::Idle => {
                        Some("Runtime has not been started yet.".to_string())
                    }
                    RuntimeHealthWorkflowStage::StartupFailed
                    | RuntimeHealthWorkflowStage::StartupRequested
                    | RuntimeHealthWorkflowStage::WaitingForRuntime => startup_status.detail,
                    _ => None,
                },
                runtime_failure_kind: startup_status.failure_kind,
                supports_mcp_status: runtime_kind.descriptor().capabilities.supports_mcp_status,
                mcp_ok: false,
                mcp_error: (!matches!(
                    progress.stage,
                    RuntimeHealthWorkflowStage::RuntimeReady | RuntimeHealthWorkflowStage::Ready
                ))
                .then(|| "Runtime is unavailable, so MCP cannot be verified.".to_string()),
                mcp_failure_kind: startup_status.failure_kind,
                mcp_server_status: None,
                available_tool_ids: Vec::new(),
                progress: Some(progress),
            },
        ))
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

    fn acquire_repo_runtime_health_flight(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
    ) -> Result<(Arc<RepoRuntimeHealthFlight>, bool)> {
        let key = Self::runtime_ensure_flight_key(runtime_kind, repo_key);
        let mut flights = self
            .repo_runtime_health_flights
            .lock()
            .map_err(|_| anyhow!("Repo runtime health coordination state lock poisoned"))?;
        if let Some(existing) = flights.get(key.as_str()) {
            return Ok((existing.clone(), false));
        }

        let flight = Arc::new(RepoRuntimeHealthFlight::new());
        flights.insert(key, flight.clone());
        Ok((flight, true))
    }

    fn complete_repo_runtime_health_flight(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        flight: &Arc<RepoRuntimeHealthFlight>,
        result: &Result<RepoRuntimeHealthCheck>,
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
            *state = RepoRuntimeHealthFlightState::Finished(Box::new(stored_result));
            flight.condvar.notify_all();
        }

        {
            let mut flights = match self.repo_runtime_health_flights.lock() {
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
            return Err(anyhow!(
                "Repo runtime health coordination state lock poisoned"
            ));
        }

        Ok(())
    }

    fn wait_for_repo_runtime_health_flight(
        flight: &Arc<RepoRuntimeHealthFlight>,
    ) -> Result<RepoRuntimeHealthCheck> {
        let mut state = flight
            .state
            .lock()
            .map_err(|_| anyhow!("Repo runtime health coordination state lock poisoned"))?;
        loop {
            match &*state {
                RepoRuntimeHealthFlightState::Starting => {
                    state = flight.condvar.wait(state).map_err(|_| {
                        anyhow!("Repo runtime health coordination state lock poisoned")
                    })?;
                }
                RepoRuntimeHealthFlightState::Finished(result) => {
                    return result
                        .as_ref()
                        .clone()
                        .map_err(|message: String| anyhow!(message));
                }
            }
        }
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
    ) -> ResolvedMcpServerStatus {
        let Some(server_status) = status_by_server.get(ODT_MCP_SERVER_NAME) else {
            return ResolvedMcpServerStatus::unavailable(
                None,
                format!("MCP server '{ODT_MCP_SERVER_NAME}' is not configured for this runtime."),
            );
        };
        if server_status.status == "connected" {
            return ResolvedMcpServerStatus::connected();
        }

        ResolvedMcpServerStatus::unavailable(
            Some(server_status.status.clone()),
            server_status.error.clone().unwrap_or_else(|| {
                format!(
                    "MCP server '{ODT_MCP_SERVER_NAME}' is {}.",
                    server_status.status
                )
            }),
        )
    }

    fn repo_runtime_has_active_run(
        &self,
        repo_key: &str,
        runtime_route: &RuntimeRoute,
    ) -> Result<bool> {
        let runtime_endpoint = match runtime_route {
            RuntimeRoute::LocalHttp { endpoint } => endpoint.as_str(),
        };
        Ok(self.runs_list(Some(repo_key))?.iter().any(|run| {
            matches!(
                run.state,
                RunState::Starting
                    | RunState::Running
                    | RunState::Blocked
                    | RunState::AwaitingDoneConfirmation
            ) && matches!(&run.runtime_route, RuntimeRoute::LocalHttp { endpoint } if endpoint == runtime_endpoint)
        }))
    }

    fn recover_repo_runtime_mcp_status_failure(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        checked_at: &str,
        runtime: &RuntimeInstanceSummary,
        host_status: Option<RepoRuntimeStartupStatus>,
        error: RuntimeHealthHttpFailure,
    ) -> Result<RepoRuntimeHealthCheck> {
        if self.repo_runtime_has_active_run(repo_key, &runtime.runtime_route)? {
            let skipped_message = format!(
                "Failed to query runtime MCP status: {}. Automatic runtime restart was skipped because an active run is using this runtime.",
                error.message
            );
            return self.store_repo_runtime_health(
                runtime_kind,
                repo_key,
                build_repo_runtime_health_check(RepoRuntimeHealthCheckInput {
                    checked_at: checked_at.to_string(),
                    runtime: Some(runtime.clone()),
                    runtime_ok: true,
                    runtime_error: None,
                    runtime_failure_kind: None,
                    supports_mcp_status: true,
                    mcp_ok: false,
                    mcp_error: Some(skipped_message.clone()),
                    mcp_failure_kind: Some(error.failure_kind),
                    mcp_server_status: None,
                    available_tool_ids: Vec::new(),
                    progress: Some(repo_runtime_progress(RepoRuntimeProgressInput {
                        stage: RuntimeHealthWorkflowStage::RestartSkippedActiveRun,
                        observation: Some(RepoRuntimeHealthObservation::RestartSkippedActiveRun),
                        host: host_status,
                        checked_at: checked_at.to_string(),
                        failure_reason: None,
                        started_at: Some(runtime.started_at.clone()),
                        updated_at: Some(checked_at.to_string()),
                        elapsed_ms: None,
                        attempts: None,
                    })),
                }),
            );
        }

        self.update_repo_runtime_health_status(
            runtime_kind,
            repo_key,
            build_repo_runtime_health_check(RepoRuntimeHealthCheckInput {
                checked_at: checked_at.to_string(),
                runtime: Some(runtime.clone()),
                runtime_ok: true,
                runtime_error: None,
                runtime_failure_kind: None,
                supports_mcp_status: true,
                mcp_ok: false,
                mcp_error: Some(error.message.clone()),
                mcp_failure_kind: Some(error.failure_kind),
                mcp_server_status: None,
                available_tool_ids: Vec::new(),
                progress: Some(repo_runtime_progress(RepoRuntimeProgressInput {
                    stage: RuntimeHealthWorkflowStage::RestartingRuntime,
                    observation: Some(RepoRuntimeHealthObservation::RestartedForMcp),
                    host: host_status.clone(),
                    checked_at: checked_at.to_string(),
                    failure_reason: None,
                    started_at: Some(runtime.started_at.clone()),
                    updated_at: Some(checked_at.to_string()),
                    elapsed_ms: None,
                    attempts: None,
                })),
            }),
        )?;

        if let Err(stop_error) =
            self.stop_registered_runtime_preserving_repo_health(runtime.runtime_id.as_str())
        {
            let stop_message =
                format!("Failed to stop runtime before MCP recovery: {stop_error:#}");
            return self.store_repo_runtime_health(
                runtime_kind,
                repo_key,
                build_repo_runtime_health_check(RepoRuntimeHealthCheckInput {
                    checked_at: checked_at.to_string(),
                    runtime: Some(runtime.clone()),
                    runtime_ok: true,
                    runtime_error: None,
                    runtime_failure_kind: None,
                    supports_mcp_status: true,
                    mcp_ok: false,
                    mcp_error: Some(stop_message.clone()),
                    mcp_failure_kind: Some(RepoRuntimeStartupFailureKind::Error),
                    mcp_server_status: None,
                    available_tool_ids: Vec::new(),
                    progress: Some(repo_runtime_progress(RepoRuntimeProgressInput {
                        stage: RuntimeHealthWorkflowStage::RestartingRuntime,
                        observation: Some(RepoRuntimeHealthObservation::RestartedForMcp),
                        host: host_status,
                        checked_at: checked_at.to_string(),
                        failure_reason: None,
                        started_at: Some(runtime.started_at.clone()),
                        updated_at: Some(checked_at.to_string()),
                        elapsed_ms: None,
                        attempts: None,
                    })),
                }),
            );
        }

        match self.ensure_workspace_runtime(runtime_kind, repo_key) {
            Ok(restarted_runtime) => {
                self.complete_repo_runtime_health(CompleteRepoRuntimeHealthInput {
                    repo_key: repo_key.to_string(),
                    checked_at: checked_at.to_string(),
                    runtime_kind,
                    runtime: restarted_runtime,
                    host_status: Some(
                        self.runtime_startup_status(runtime_kind.as_str(), repo_key)?,
                    ),
                    observation: Some(RepoRuntimeHealthObservation::RestartedForMcp),
                    allow_restart: false,
                })
            }
            Err(restart_error) => {
                let latest_host_status =
                    self.runtime_startup_status(runtime_kind.as_str(), repo_key)?;
                self.store_repo_runtime_health(
                    runtime_kind,
                    repo_key,
                    build_repo_runtime_health_check(RepoRuntimeHealthCheckInput {
                        checked_at: checked_at.to_string(),
                        runtime: None,
                        runtime_ok: false,
                        runtime_error: Some(format!("{restart_error:#}")),
                        runtime_failure_kind: Some(Self::repo_runtime_timeout_kind(&restart_error)),
                        supports_mcp_status: true,
                        mcp_ok: false,
                        mcp_error: Some(
                            "Runtime is unavailable, so MCP cannot be verified.".to_string(),
                        ),
                        mcp_failure_kind: Some(Self::repo_runtime_timeout_kind(&restart_error)),
                        mcp_server_status: None,
                        available_tool_ids: Vec::new(),
                        progress: Some(repo_runtime_progress(RepoRuntimeProgressInput {
                            stage: match latest_host_status.stage {
                                RepoRuntimeStartupStage::WaitingForRuntime => {
                                    RuntimeHealthWorkflowStage::WaitingForRuntime
                                }
                                RepoRuntimeStartupStage::StartupRequested => {
                                    RuntimeHealthWorkflowStage::StartupRequested
                                }
                                RepoRuntimeStartupStage::RuntimeReady => {
                                    RuntimeHealthWorkflowStage::RuntimeReady
                                }
                                RepoRuntimeStartupStage::Idle => {
                                    RuntimeHealthWorkflowStage::RestartingRuntime
                                }
                                RepoRuntimeStartupStage::StartupFailed => {
                                    RuntimeHealthWorkflowStage::StartupFailed
                                }
                            },
                            observation: Some(RepoRuntimeHealthObservation::RestartedForMcp),
                            host: Some(latest_host_status),
                            checked_at: checked_at.to_string(),
                            failure_reason: Self::repo_runtime_failure_reason(&restart_error),
                            started_at: None,
                            updated_at: Some(checked_at.to_string()),
                            elapsed_ms: None,
                            attempts: None,
                        })),
                    }),
                )
            }
        }
    }

    pub fn repo_runtime_health(
        &self,
        runtime_kind: &str,
        repo_path: &str,
    ) -> Result<RepoRuntimeHealthCheck> {
        let runtime_kind = Self::resolve_supported_runtime_kind(runtime_kind)?;
        let repo_key = self.resolve_authorized_repo_path(repo_path)?;
        let (flight, is_leader) =
            self.acquire_repo_runtime_health_flight(runtime_kind, repo_key.as_str())?;
        if !is_leader {
            return Self::wait_for_repo_runtime_health_flight(&flight);
        }
        let checked_at = now_rfc3339();
        let result = (|| -> Result<RepoRuntimeHealthCheck> {
            let mut host_status =
                Some(self.runtime_startup_status(runtime_kind.as_str(), repo_key.as_str())?);
            let existing_runtime =
                self.find_existing_workspace_runtime(runtime_kind, repo_key.as_str())?;
            let mut observation = Self::repo_runtime_health_observation(
                existing_runtime.is_some(),
                host_status.as_ref(),
            );

            let runtime = match existing_runtime {
                Some(runtime) => runtime,
                None => match self.ensure_workspace_runtime(runtime_kind, repo_key.as_str()) {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        let latest_host_status =
                            self.runtime_startup_status(runtime_kind.as_str(), repo_key.as_str())?;
                        let progress = repo_runtime_progress(RepoRuntimeProgressInput {
                            stage: map_startup_stage_to_failed_health(latest_host_status.stage),
                            observation,
                            host: Some(latest_host_status),
                            checked_at: checked_at.clone(),
                            failure_reason: Self::repo_runtime_failure_reason(&error),
                            started_at: None,
                            updated_at: None,
                            elapsed_ms: None,
                            attempts: None,
                        });
                        return self.store_repo_runtime_health(
                            runtime_kind,
                            repo_key.as_str(),
                            build_repo_runtime_health_check(RepoRuntimeHealthCheckInput {
                                checked_at: checked_at.clone(),
                                runtime: None,
                                runtime_ok: false,
                                runtime_error: Some(format!("{error:#}")),
                                runtime_failure_kind: Some(Self::repo_runtime_timeout_kind(&error)),
                                supports_mcp_status: true,
                                mcp_ok: false,
                                mcp_error: Some(
                                    "Runtime is unavailable, so MCP cannot be verified."
                                        .to_string(),
                                ),
                                mcp_failure_kind: Some(Self::repo_runtime_timeout_kind(&error)),
                                mcp_server_status: None,
                                available_tool_ids: Vec::new(),
                                progress: Some(progress),
                            }),
                        );
                    }
                },
            };

            host_status =
                Some(self.runtime_startup_status(runtime_kind.as_str(), repo_key.as_str())?);
            if !runtime.descriptor.capabilities.supports_mcp_status {
                let progress = repo_runtime_progress(RepoRuntimeProgressInput {
                    stage: RuntimeHealthWorkflowStage::Ready,
                    observation,
                    host: host_status,
                    checked_at: checked_at.clone(),
                    failure_reason: None,
                    started_at: Some(runtime.started_at.clone()),
                    updated_at: Some(checked_at.clone()),
                    elapsed_ms: None,
                    attempts: None,
                });
                return self.store_repo_runtime_health(
                    runtime_kind,
                    repo_key.as_str(),
                    build_repo_runtime_health_check(RepoRuntimeHealthCheckInput {
                        checked_at: checked_at.clone(),
                        runtime: Some(runtime),
                        runtime_ok: true,
                        runtime_error: None,
                        runtime_failure_kind: None,
                        supports_mcp_status: false,
                        mcp_ok: true,
                        mcp_error: None,
                        mcp_failure_kind: None,
                        mcp_server_status: None,
                        available_tool_ids: Vec::new(),
                        progress: Some(progress),
                    }),
                );
            }

            self.complete_repo_runtime_health(CompleteRepoRuntimeHealthInput {
                repo_key: repo_key.clone(),
                checked_at: checked_at.clone(),
                runtime_kind,
                runtime,
                host_status,
                observation: observation.take(),
                allow_restart: true,
            })
        })();
        self.complete_repo_runtime_health_flight(
            runtime_kind,
            repo_key.as_str(),
            &flight,
            &result,
        )?;
        result
    }

    fn complete_repo_runtime_health(
        &self,
        input: CompleteRepoRuntimeHealthInput,
    ) -> Result<RepoRuntimeHealthCheck> {
        let CompleteRepoRuntimeHealthInput {
            repo_key,
            checked_at,
            runtime_kind,
            runtime,
            host_status,
            observation,
            allow_restart,
        } = input;
        let checking_progress = repo_runtime_progress(RepoRuntimeProgressInput {
            stage: RuntimeHealthWorkflowStage::CheckingMcpStatus,
            observation,
            host: host_status.clone(),
            checked_at: checked_at.clone(),
            failure_reason: None,
            started_at: Some(runtime.started_at.clone()),
            updated_at: Some(checked_at.clone()),
            elapsed_ms: None,
            attempts: None,
        });
        self.update_repo_runtime_health_status(
            runtime_kind,
            repo_key.as_str(),
            build_repo_runtime_health_check(RepoRuntimeHealthCheckInput {
                checked_at: checked_at.clone(),
                runtime: Some(runtime.clone()),
                runtime_ok: true,
                runtime_error: None,
                runtime_failure_kind: None,
                supports_mcp_status: true,
                mcp_ok: false,
                mcp_error: None,
                mcp_failure_kind: None,
                mcp_server_status: None,
                available_tool_ids: Vec::new(),
                progress: Some(checking_progress.clone()),
            }),
        )?;

        let status_by_server = match self.repo_runtime_load_mcp_status(&runtime) {
            Ok(status_by_server) => status_by_server,
            Err(error) => {
                if allow_restart
                    && Self::repo_runtime_should_restart_for_mcp_status_error(
                        error.message.as_str(),
                    )
                {
                    return self.recover_repo_runtime_mcp_status_failure(
                        runtime_kind,
                        repo_key.as_str(),
                        checked_at.as_str(),
                        &runtime,
                        host_status,
                        error,
                    );
                }

                let mcp_message = format!("Failed to query runtime MCP status: {}", error.message);
                return self.store_repo_runtime_health(
                    runtime_kind,
                    repo_key.as_str(),
                    build_repo_runtime_health_check(RepoRuntimeHealthCheckInput {
                        checked_at: checked_at.clone(),
                        runtime: Some(runtime.clone()),
                        runtime_ok: true,
                        runtime_error: None,
                        runtime_failure_kind: None,
                        supports_mcp_status: true,
                        mcp_ok: false,
                        mcp_error: Some(mcp_message.clone()),
                        mcp_failure_kind: Some(error.failure_kind),
                        mcp_server_status: None,
                        available_tool_ids: Vec::new(),
                        progress: Some(repo_runtime_progress(RepoRuntimeProgressInput {
                            stage: RuntimeHealthWorkflowStage::RuntimeReady,
                            observation,
                            host: host_status,
                            checked_at: checked_at.clone(),
                            failure_reason: None,
                            started_at: Some(runtime.started_at.clone()),
                            updated_at: Some(checked_at.clone()),
                            elapsed_ms: checking_progress.elapsed_ms,
                            attempts: checking_progress.attempts,
                        })),
                    }),
                );
            }
        };

        let mut mcp_status = Self::repo_runtime_resolve_mcp_status(&status_by_server);
        if !mcp_status.is_connected() {
            let reconnect_progress = repo_runtime_progress(RepoRuntimeProgressInput {
                stage: RuntimeHealthWorkflowStage::ReconnectingMcp,
                observation,
                host: host_status.clone(),
                checked_at: checked_at.clone(),
                failure_reason: None,
                started_at: Some(runtime.started_at.clone()),
                updated_at: Some(checked_at.clone()),
                elapsed_ms: checking_progress.elapsed_ms,
                attempts: checking_progress.attempts,
            });
            self.update_repo_runtime_health_status(
                runtime_kind,
                repo_key.as_str(),
                build_repo_runtime_health_check(RepoRuntimeHealthCheckInput {
                    checked_at: checked_at.clone(),
                    runtime: Some(runtime.clone()),
                    runtime_ok: true,
                    runtime_error: None,
                    runtime_failure_kind: None,
                    supports_mcp_status: true,
                    mcp_ok: false,
                    mcp_error: mcp_status.error.clone(),
                    mcp_failure_kind: mcp_status.failure_kind,
                    mcp_server_status: mcp_status.status.clone(),
                    available_tool_ids: Vec::new(),
                    progress: Some(reconnect_progress.clone()),
                }),
            )?;

            match self.repo_runtime_connect_mcp_server(&runtime, ODT_MCP_SERVER_NAME) {
                Ok(()) => {
                    let refreshed = match self.repo_runtime_load_mcp_status(&runtime) {
                        Ok(refreshed) => refreshed,
                        Err(error) => {
                            let refresh_message = format!(
                                "Failed to refresh runtime MCP status after reconnect: {}",
                                error.message
                            );
                            return self.store_repo_runtime_health(
                                runtime_kind,
                                repo_key.as_str(),
                                build_repo_runtime_health_check(RepoRuntimeHealthCheckInput {
                                    checked_at: checked_at.clone(),
                                    runtime: Some(runtime.clone()),
                                    runtime_ok: true,
                                    runtime_error: None,
                                    runtime_failure_kind: None,
                                    supports_mcp_status: true,
                                    mcp_ok: false,
                                    mcp_error: Some(refresh_message.clone()),
                                    mcp_failure_kind: Some(error.failure_kind),
                                    mcp_server_status: mcp_status.status.clone(),
                                    available_tool_ids: Vec::new(),
                                    progress: Some(repo_runtime_progress(
                                        RepoRuntimeProgressInput {
                                            stage: reconnect_progress.stage,
                                            observation: reconnect_progress.observation,
                                            host: reconnect_progress.host.clone(),
                                            checked_at: checked_at.clone(),
                                            failure_reason: None,
                                            started_at: reconnect_progress.started_at.clone(),
                                            updated_at: Some(checked_at.clone()),
                                            elapsed_ms: reconnect_progress.elapsed_ms,
                                            attempts: reconnect_progress.attempts,
                                        },
                                    )),
                                }),
                            );
                        }
                    };
                    mcp_status = Self::repo_runtime_resolve_mcp_status(&refreshed);
                }
                Err(error) => {
                    let mcp_message = format!(
                        "Failed to reconnect MCP server '{ODT_MCP_SERVER_NAME}': {}",
                        error.message
                    );
                    return self.store_repo_runtime_health(
                        runtime_kind,
                        repo_key.as_str(),
                        build_repo_runtime_health_check(RepoRuntimeHealthCheckInput {
                            checked_at: checked_at.clone(),
                            runtime: Some(runtime.clone()),
                            runtime_ok: true,
                            runtime_error: None,
                            runtime_failure_kind: None,
                            supports_mcp_status: true,
                            mcp_ok: false,
                            mcp_error: Some(mcp_message.clone()),
                            mcp_failure_kind: Some(error.failure_kind),
                            mcp_server_status: mcp_status.status.clone(),
                            available_tool_ids: Vec::new(),
                            progress: Some(repo_runtime_progress(RepoRuntimeProgressInput {
                                stage: reconnect_progress.stage,
                                observation: reconnect_progress.observation,
                                host: reconnect_progress.host,
                                checked_at: checked_at.clone(),
                                failure_reason: None,
                                started_at: reconnect_progress.started_at,
                                updated_at: Some(checked_at.clone()),
                                elapsed_ms: reconnect_progress.elapsed_ms,
                                attempts: reconnect_progress.attempts,
                            })),
                        }),
                    );
                }
            }
        }

        let mcp_ok = mcp_status.is_connected();
        let mcp_error = if mcp_ok {
            None
        } else {
            Some(
                mcp_status
                    .error
                    .clone()
                    .unwrap_or_else(|| "OpenDucktor MCP is unavailable.".to_string()),
            )
        };
        let progress = repo_runtime_progress(RepoRuntimeProgressInput {
            stage: if mcp_ok {
                RuntimeHealthWorkflowStage::Ready
            } else {
                RuntimeHealthWorkflowStage::CheckingMcpStatus
            },
            observation,
            host: host_status.clone(),
            checked_at: checked_at.clone(),
            failure_reason: None,
            started_at: Some(runtime.started_at.clone()),
            updated_at: Some(checked_at.clone()),
            elapsed_ms: checking_progress.elapsed_ms,
            attempts: checking_progress.attempts,
        });

        let (mcp_ok, mcp_error, mcp_failure_kind, available_tool_ids, progress) = if mcp_ok {
            match self.repo_runtime_load_tool_ids(&runtime) {
                Ok(tool_ids) => (true, None, None, tool_ids, progress),
                Err(error) => {
                    let tool_ids_message =
                        format!("Failed to load runtime MCP tool ids: {}", error.message);
                    let failed_progress = repo_runtime_progress(RepoRuntimeProgressInput {
                        stage: RuntimeHealthWorkflowStage::RuntimeReady,
                        observation,
                        host: host_status.clone(),
                        checked_at: checked_at.clone(),
                        failure_reason: None,
                        started_at: Some(runtime.started_at.clone()),
                        updated_at: Some(checked_at.clone()),
                        elapsed_ms: checking_progress.elapsed_ms,
                        attempts: checking_progress.attempts,
                    });
                    (
                        false,
                        Some(tool_ids_message),
                        Some(error.failure_kind),
                        Vec::new(),
                        failed_progress,
                    )
                }
            }
        } else {
            (
                false,
                mcp_error,
                mcp_status.failure_kind,
                Vec::new(),
                progress,
            )
        };

        self.store_repo_runtime_health(
            runtime_kind,
            repo_key.as_str(),
            build_repo_runtime_health_check(RepoRuntimeHealthCheckInput {
                checked_at,
                runtime: Some(runtime.clone()),
                runtime_ok: true,
                runtime_error: None,
                runtime_failure_kind: None,
                supports_mcp_status: true,
                mcp_ok,
                mcp_error,
                mcp_failure_kind,
                mcp_server_status: mcp_status.status,
                available_tool_ids,
                progress: Some(progress),
            }),
        )
    }
}

fn parse_runtime_health_json<T: DeserializeOwned>(
    body: &str,
    action: &str,
) -> std::result::Result<T, RuntimeHealthHttpFailure> {
    serde_json::from_str::<T>(body).map_err(|error| {
        RuntimeHealthHttpFailure::error(format!(
            "Failed to parse OpenCode runtime response for {action}: {error}"
        ))
    })
}

fn runtime_health_http_status_failure(
    status_code: u16,
    body: &str,
    action: &str,
) -> RuntimeHealthHttpFailure {
    let detail = runtime_health_http_error_detail(body);
    let failure_kind = if matches!(status_code, 408 | 504) {
        RepoRuntimeStartupFailureKind::Timeout
    } else {
        RepoRuntimeStartupFailureKind::Error
    };

    RuntimeHealthHttpFailure {
        failure_kind,
        message: match detail {
            Some(detail) => {
                format!("OpenCode runtime failed to {action}: HTTP {status_code}: {detail}")
            }
            None => format!("OpenCode runtime failed to {action}: HTTP {status_code}"),
        },
    }
}

fn runtime_health_http_error_detail(body: &str) -> Option<String> {
    if body.trim().is_empty() {
        return None;
    }

    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|payload| {
            payload
                .get("error")
                .and_then(|error| error.get("message"))
                .and_then(|message| message.as_str())
                .map(str::to_string)
        })
        .or_else(|| Some(body.to_string()))
        .filter(|detail| !detail.trim().is_empty())
}

fn classify_runtime_health_request_failure(
    error: &reqwest::Error,
) -> RepoRuntimeStartupFailureKind {
    if error.is_timeout() {
        RepoRuntimeStartupFailureKind::Timeout
    } else {
        RepoRuntimeStartupFailureKind::Error
    }
}

fn lower_contains_any(haystack: &str, needles: &[&str]) -> bool {
    let normalized = haystack.to_ascii_lowercase();
    needles.iter().any(|needle| normalized.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::{RepoRuntimeHealthHttpClient, RuntimeHealthMcpServerStatus};
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;

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
            RepoRuntimeHealthHttpClient::new(format!("http://127.0.0.1:{port}").as_str())
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
                RuntimeHealthMcpServerStatus {
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
}
