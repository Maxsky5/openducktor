use super::*;

impl AppService {
    pub(in crate::app_service::runtime_orchestrator) fn repo_runtime_timeout_kind(
        error: &anyhow::Error,
    ) -> RepoRuntimeStartupFailureKind {
        error
            .chain()
            .find_map(|cause| {
                cause
                    .downcast_ref::<RuntimeStartupWaitFailure>()
                    .map(|failure| {
                        if failure.reason().is_timeout() {
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

    pub(in crate::app_service::runtime_orchestrator) fn repo_runtime_failure_reason(
        error: &anyhow::Error,
    ) -> Option<String> {
        error.chain().find_map(|cause| {
            cause
                .downcast_ref::<RuntimeStartupWaitFailure>()
                .map(|failure| failure.reason().as_str().to_string())
        })
    }

    pub(in crate::app_service::runtime_orchestrator) fn repo_runtime_delegate(
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

    pub(in crate::app_service::runtime_orchestrator) fn repo_runtime_normalize_mcp_server_status(
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

    pub(in crate::app_service::runtime_orchestrator) fn repo_runtime_refresh_mcp_status_after_connect(
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

    pub(in crate::app_service::runtime_orchestrator) fn repo_runtime_normalize_mcp_probe_failure(
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

    pub(in crate::app_service::runtime_orchestrator) fn repo_runtime_has_active_session(
        &self,
        runtime_kind: &AgentRuntimeKind,
        runtime: &RuntimeInstanceSummary,
    ) -> Result<bool> {
        let probe_target_resolution = self
            .runtime_registry
            .runtime(runtime_kind)?
            .session_status_probe_target(
                &runtime.runtime_route,
                runtime.working_directory.as_str(),
            )?;
        let RuntimeSessionStatusProbeTargetResolution::Target(probe_target) =
            probe_target_resolution
        else {
            return Ok(true);
        };
        let statuses = self.load_cached_runtime_session_statuses_for_targets(
            std::slice::from_ref(&probe_target),
        )?;
        match statuses.get(&probe_target) {
            Some(RuntimeSessionStatusProbeOutcome::Snapshot(snapshot)) => {
                Ok(snapshot.has_any_live_sessions())
            }
            Some(RuntimeSessionStatusProbeOutcome::Unsupported) => Ok(true),
            Some(RuntimeSessionStatusProbeOutcome::ActionableError(error)) => {
                Err(anyhow!(error.to_string()))
            }
            None => Err(anyhow!(
                "Missing cached runtime session status outcome for {}",
                runtime.working_directory
            )),
        }
    }

    pub(in crate::app_service::runtime_orchestrator) fn recover_repo_runtime_mcp_status_failure(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_key: &str,
        checked_at: &str,
        runtime: &RuntimeInstanceSummary,
        host_status: Option<RepoRuntimeStartupStatus>,
        error: RuntimeHealthCheckFailure,
    ) -> Result<RepoRuntimeHealthCheck> {
        if self.repo_runtime_has_active_session(&runtime_kind, runtime)? {
            let skipped_message = format!(
                "Failed to query runtime MCP status: {}. Automatic runtime restart was skipped because an active session is using this runtime.",
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
                        stage: RuntimeHealthWorkflowStage::RestartSkippedActiveSession,
                        observation: Some(
                            RepoRuntimeHealthObservation::RestartSkippedActiveSession,
                        ),
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
}
