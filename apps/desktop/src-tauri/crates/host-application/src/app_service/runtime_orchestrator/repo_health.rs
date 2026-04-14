use super::repo_health_snapshot::{
    build_repo_runtime_health_check, map_startup_stage_to_failed_health,
    map_startup_stage_to_health, repo_runtime_progress, RepoRuntimeHealthCheckInput,
    RepoRuntimeProgressInput, RuntimeHealthWorkflowStage,
};
use super::AppService;
use crate::app_service::runtime_registry::{ResolvedRuntimeMcpStatus, RuntimeHealthCheckFailure};
use crate::app_service::service_core::{RepoRuntimeHealthFlight, RepoRuntimeHealthFlightState};
use crate::app_service::OpencodeStartupWaitFailure;
use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use host_domain::{
    now_rfc3339, AgentRuntimeKind, RepoRuntimeHealthCheck, RepoRuntimeHealthObservation,
    RepoRuntimeStartupFailureKind, RepoRuntimeStartupStage, RepoRuntimeStartupStatus, RunState,
    RuntimeInstanceSummary, RuntimeRoute,
};
use std::sync::Arc;
use std::time::Duration;

const MCP_CONNECT_STARTUP_GRACE_PERIOD: Duration = Duration::from_secs(10);
const MCP_CONNECT_STATUS_RETRY_DELAY: Duration = Duration::from_millis(250);

struct CompleteRepoRuntimeHealthInput {
    repo_key: String,
    checked_at: String,
    runtime_kind: AgentRuntimeKind,
    runtime: RuntimeInstanceSummary,
    host_status: Option<RepoRuntimeStartupStatus>,
    observation: Option<RepoRuntimeHealthObservation>,
    allow_restart: bool,
}

impl AppService {
    fn update_repo_runtime_health_status(
        &self,
        runtime_kind: &AgentRuntimeKind,
        repo_key: &str,
        health: RepoRuntimeHealthCheck,
    ) -> Result<()> {
        let key = Self::runtime_ensure_flight_key(&runtime_kind, repo_key);
        let mut statuses = self
            .repo_runtime_health_snapshots
            .lock()
            .map_err(|_| anyhow!("Repo runtime health status lock poisoned"))?;
        statuses.insert(key, health);
        Ok(())
    }

    fn clear_repo_runtime_health_status(
        &self,
        runtime_kind: &AgentRuntimeKind,
        repo_key: &str,
    ) -> Result<()> {
        let key = Self::runtime_ensure_flight_key(&runtime_kind, repo_key);
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
        self.clear_repo_runtime_health_status(&runtime.kind, runtime.repo_path.as_str())
    }

    pub fn repo_runtime_health_status(
        &self,
        runtime_kind: &str,
        repo_path: &str,
    ) -> Result<RepoRuntimeHealthCheck> {
        let runtime_kind = self.resolve_supported_runtime_kind(runtime_kind)?;
        let repo_key = self.resolve_authorized_repo_path(repo_path)?;
        let status_key = Self::runtime_ensure_flight_key(&runtime_kind, repo_key.as_str());

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
                supports_mcp_status: self
                    .runtime_registry
                    .definition(&runtime_kind)?
                    .descriptor()
                    .capabilities
                    .supports_mcp_status,
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
        runtime_kind: &AgentRuntimeKind,
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
        let key = Self::runtime_ensure_flight_key(&runtime_kind, repo_key);
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
            let key = Self::runtime_ensure_flight_key(&runtime_kind, repo_key);
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
                            .downcast_ref::<RuntimeHealthCheckFailure>()
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

    fn repo_runtime_delegate(
        &self,
        runtime: &RuntimeInstanceSummary,
    ) -> std::result::Result<
        Arc<dyn crate::app_service::runtime_registry::AppRuntime>,
        RuntimeHealthCheckFailure,
    > {
        self.runtime_registry
            .runtime(&runtime.kind)
            .map_err(|error| RuntimeHealthCheckFailure {
                failure_kind: RepoRuntimeStartupFailureKind::Error,
                message: error.to_string(),
                is_connect_failure: false,
            })
    }

    fn repo_runtime_normalize_mcp_server_status(
        runtime: &RuntimeInstanceSummary,
        host_status: Option<&RepoRuntimeStartupStatus>,
        checked_at: &str,
        status: ResolvedRuntimeMcpStatus,
    ) -> ResolvedRuntimeMcpStatus {
        if status.is_connected() {
            return status;
        }

        if status.failure_kind != Some(RepoRuntimeStartupFailureKind::Error) {
            return status;
        }

        if !repo_runtime_is_within_mcp_startup_grace_window(runtime, host_status, checked_at) {
            return status;
        }

        ResolvedRuntimeMcpStatus {
            failure_kind: Some(RepoRuntimeStartupFailureKind::Timeout),
            ..status
        }
    }

    fn repo_runtime_refresh_mcp_status_after_connect(
        &self,
        runtime: &RuntimeInstanceSummary,
        host_status: Option<&RepoRuntimeStartupStatus>,
        initial_checked_at: &str,
    ) -> std::result::Result<ResolvedRuntimeMcpStatus, RuntimeHealthCheckFailure> {
        let runtime_delegate = self.repo_runtime_delegate(runtime)?;
        let mut checked_at = initial_checked_at.to_string();
        let mut latest_status = Self::repo_runtime_normalize_mcp_server_status(
            runtime,
            host_status,
            checked_at.as_str(),
            runtime_delegate.resolve_mcp_status(&runtime_delegate.load_mcp_status(runtime)?),
        );

        if latest_status.is_connected()
            || !repo_runtime_is_within_mcp_startup_grace_window(
                runtime,
                host_status,
                checked_at.as_str(),
            )
        {
            return Ok(latest_status);
        }

        while repo_runtime_is_within_mcp_startup_grace_window(
            runtime,
            host_status,
            checked_at.as_str(),
        ) {
            std::thread::sleep(MCP_CONNECT_STATUS_RETRY_DELAY);
            checked_at = now_rfc3339();
            latest_status = Self::repo_runtime_normalize_mcp_server_status(
                runtime,
                host_status,
                checked_at.as_str(),
                runtime_delegate.resolve_mcp_status(&runtime_delegate.load_mcp_status(runtime)?),
            );
            if latest_status.is_connected() {
                return Ok(latest_status);
            }
        }

        Ok(latest_status)
    }

    fn repo_runtime_normalize_mcp_probe_failure(
        runtime: &RuntimeInstanceSummary,
        host_status: Option<&RepoRuntimeStartupStatus>,
        checked_at: &str,
        error: RuntimeHealthCheckFailure,
    ) -> RuntimeHealthCheckFailure {
        if error.failure_kind == RepoRuntimeStartupFailureKind::Timeout {
            return error;
        }

        if error.is_connect_failure
            && repo_runtime_is_within_mcp_startup_grace_window(runtime, host_status, checked_at)
        {
            return RuntimeHealthCheckFailure {
                failure_kind: RepoRuntimeStartupFailureKind::Timeout,
                ..error
            };
        }

        error
    }

    fn repo_runtime_has_active_run(
        &self,
        repo_key: &str,
        runtime_route: &RuntimeRoute,
    ) -> Result<bool> {
        Ok(self.runs_list(Some(repo_key))?.iter().any(|run| {
            matches!(
                run.state,
                RunState::Starting
                    | RunState::Running
                    | RunState::Blocked
                    | RunState::AwaitingDoneConfirmation
            ) && &run.runtime_route == runtime_route
        }))
    }

    fn recover_repo_runtime_mcp_status_failure(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        checked_at: &str,
        runtime: &RuntimeInstanceSummary,
        host_status: Option<RepoRuntimeStartupStatus>,
        error: RuntimeHealthCheckFailure,
    ) -> Result<RepoRuntimeHealthCheck> {
        if self.repo_runtime_has_active_run(repo_key, &runtime.runtime_route)? {
            let skipped_message = format!(
                "Failed to query runtime MCP status: {}. Automatic runtime restart was skipped because an active run is using this runtime.",
                error.message
            );
            return self.store_repo_runtime_health(
                &runtime_kind,
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
            &runtime_kind,
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
                &runtime_kind,
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

        match self.ensure_workspace_runtime(runtime_kind.clone(), repo_key) {
            Ok(restarted_runtime) => {
                self.complete_repo_runtime_health(CompleteRepoRuntimeHealthInput {
                    repo_key: repo_key.to_string(),
                    checked_at: checked_at.to_string(),
                    runtime_kind: runtime_kind.clone(),
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
                    &runtime_kind,
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
        let runtime_kind = self.resolve_supported_runtime_kind(runtime_kind)?;
        let repo_key = self.resolve_authorized_repo_path(repo_path)?;
        let (flight, is_leader) =
            self.acquire_repo_runtime_health_flight(runtime_kind.clone(), repo_key.as_str())?;
        if !is_leader {
            return Self::wait_for_repo_runtime_health_flight(&flight);
        }
        let checked_at = now_rfc3339();
        let result = (|| -> Result<RepoRuntimeHealthCheck> {
            let mut host_status =
                Some(self.runtime_startup_status(runtime_kind.as_str(), repo_key.as_str())?);
            let existing_runtime =
                self.find_existing_workspace_runtime(&runtime_kind, repo_key.as_str())?;
            let mut observation = Self::repo_runtime_health_observation(
                existing_runtime.is_some(),
                host_status.as_ref(),
            );

            let runtime = match existing_runtime {
                Some(runtime) => runtime,
                None => {
                    match self.ensure_workspace_runtime(runtime_kind.clone(), repo_key.as_str()) {
                        Ok(runtime) => runtime,
                        Err(error) => {
                            let latest_host_status = self
                                .runtime_startup_status(runtime_kind.as_str(), repo_key.as_str())?;
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
                                &runtime_kind,
                                repo_key.as_str(),
                                build_repo_runtime_health_check(RepoRuntimeHealthCheckInput {
                                    checked_at: checked_at.clone(),
                                    runtime: None,
                                    runtime_ok: false,
                                    runtime_error: Some(format!("{error:#}")),
                                    runtime_failure_kind: Some(Self::repo_runtime_timeout_kind(
                                        &error,
                                    )),
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
                    }
                }
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
                    &runtime_kind,
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
                runtime_kind: runtime_kind.clone(),
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
            &runtime_kind,
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

        let runtime_delegate = self.repo_runtime_delegate(&runtime)?;
        let status_by_server = match runtime_delegate.load_mcp_status(&runtime) {
            Ok(status_by_server) => status_by_server,
            Err(error) => {
                let error = Self::repo_runtime_normalize_mcp_probe_failure(
                    &runtime,
                    host_status.as_ref(),
                    checked_at.as_str(),
                    error,
                );
                if allow_restart
                    && runtime_delegate.should_restart_for_mcp_status_error(error.message.as_str())
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
                    &runtime_kind,
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
                            stage: checking_progress.stage,
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

        let mut mcp_status = Self::repo_runtime_normalize_mcp_server_status(
            &runtime,
            host_status.as_ref(),
            checked_at.as_str(),
            runtime_delegate.resolve_mcp_status(&status_by_server),
        );
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
                &runtime_kind,
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

            match runtime_delegate.connect_mcp_server(&runtime, "openducktor") {
                Ok(()) => {
                    mcp_status = match self.repo_runtime_refresh_mcp_status_after_connect(
                        &runtime,
                        host_status.as_ref(),
                        checked_at.as_str(),
                    ) {
                        Ok(status) => status,
                        Err(error) => {
                            let error = Self::repo_runtime_normalize_mcp_probe_failure(
                                &runtime,
                                host_status.as_ref(),
                                checked_at.as_str(),
                                error,
                            );
                            let refresh_message = format!(
                                "Failed to refresh runtime MCP status after reconnect: {}",
                                error.message
                            );
                            return self.store_repo_runtime_health(
                                &runtime_kind,
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
                }
                Err(error) => {
                    let error = Self::repo_runtime_normalize_mcp_probe_failure(
                        &runtime,
                        host_status.as_ref(),
                        checked_at.as_str(),
                        error,
                    );
                    let mcp_message = format!(
                        "Failed to reconnect MCP server 'openducktor': {}",
                        error.message
                    );
                    return self.store_repo_runtime_health(
                        &runtime_kind,
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
            match runtime_delegate.load_tool_ids(&runtime) {
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
            &runtime_kind,
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

fn repo_runtime_is_within_mcp_startup_grace_window(
    runtime: &RuntimeInstanceSummary,
    host_status: Option<&RepoRuntimeStartupStatus>,
    checked_at: &str,
) -> bool {
    if host_status.is_some_and(|status| {
        matches!(
            status.stage,
            RepoRuntimeStartupStage::StartupRequested | RepoRuntimeStartupStage::WaitingForRuntime
        )
    }) {
        return true;
    }

    let Ok(started_at) = DateTime::parse_from_rfc3339(runtime.started_at.as_str()) else {
        return false;
    };
    let Ok(checked_at) = DateTime::parse_from_rfc3339(checked_at) else {
        return false;
    };

    let elapsed = checked_at.with_timezone(&Utc) - started_at.with_timezone(&Utc);
    elapsed >= chrono::TimeDelta::zero()
        && elapsed
            .to_std()
            .is_ok_and(|duration| duration <= MCP_CONNECT_STARTUP_GRACE_PERIOD)
}

#[cfg(test)]
mod tests {
    use super::repo_runtime_is_within_mcp_startup_grace_window;
    use crate::app_service::runtime_registry::{
        ResolvedRuntimeMcpStatus, RuntimeHealthHttpClient, RuntimeMcpServerStatus,
    };
    use host_domain::{
        AgentRuntimeKind, RepoRuntimeStartupStage, RepoRuntimeStartupStatus, RuntimeRole,
        RuntimeRoute,
    };
    use std::collections::HashMap;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;

    fn runtime_summary(started_at: &str) -> host_domain::RuntimeInstanceSummary {
        host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::opencode(),
            runtime_id: "runtime-1".to_string(),
            repo_path: "/tmp/repo".to_string(),
            task_id: None,
            role: RuntimeRole::Workspace,
            working_directory: "/tmp/repo".to_string(),
            runtime_route: RuntimeRoute::LocalHttp {
                endpoint: "http://127.0.0.1:4321".to_string(),
            },
            started_at: started_at.to_string(),
            descriptor: AgentRuntimeKind::opencode().descriptor(),
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

        assert_eq!(
            failure.failure_kind,
            super::RepoRuntimeStartupFailureKind::Error
        );
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
        let status = super::AppService::repo_runtime_normalize_mcp_server_status(
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
            Some(super::RepoRuntimeStartupFailureKind::Timeout)
        );
        assert_eq!(status.status.as_deref(), Some("failed"));
    }

    #[test]
    fn normalize_mcp_server_status_keeps_failed_status_hard_after_startup_grace() {
        let runtime = runtime_summary("2026-04-11T10:00:00Z");
        let status = super::AppService::repo_runtime_normalize_mcp_server_status(
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
            Some(super::RepoRuntimeStartupFailureKind::Error)
        );
        assert_eq!(status.status.as_deref(), Some("failed"));
    }
}
