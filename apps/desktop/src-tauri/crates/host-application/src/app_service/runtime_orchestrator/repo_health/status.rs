use super::*;

impl AppService {
    pub(in crate::app_service::runtime_orchestrator) fn update_repo_runtime_health_status(
        &self,
        runtime_kind: &AgentRuntimeKind,
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

    pub(in crate::app_service::runtime_orchestrator) fn clear_repo_runtime_health_status(
        &self,
        runtime_kind: &AgentRuntimeKind,
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

    pub(in crate::app_service::runtime_orchestrator) fn clear_repo_runtime_health_status_for_runtime(
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
                    .optional_surfaces
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

    pub(in crate::app_service::runtime_orchestrator) fn repo_runtime_health_observation(
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

    pub(in crate::app_service::runtime_orchestrator) fn store_repo_runtime_health(
        &self,
        runtime_kind: &AgentRuntimeKind,
        repo_key: &str,
        health: RepoRuntimeHealthCheck,
    ) -> Result<RepoRuntimeHealthCheck> {
        self.update_repo_runtime_health_status(runtime_kind, repo_key, health.clone())?;
        Ok(health)
    }
}
