use super::*;

impl AppService {
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
            let supports_mcp_status = self
                .runtime_registry
                .definition(&runtime_kind)?
                .descriptor()
                .capabilities
                .optional_surfaces
                .supports_mcp_status;
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
                                    supports_mcp_status,
                                    mcp_ok: !supports_mcp_status,
                                    mcp_error: supports_mcp_status.then(|| {
                                        "Runtime is unavailable, so MCP cannot be verified."
                                            .to_string()
                                    }),
                                    mcp_failure_kind: supports_mcp_status
                                        .then(|| Self::repo_runtime_timeout_kind(&error)),
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
            if !runtime
                .descriptor
                .capabilities
                .optional_surfaces
                .supports_mcp_status
            {
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

    pub(in crate::app_service::runtime_orchestrator) fn complete_repo_runtime_health(
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
