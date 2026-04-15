use super::super::{AppService, OpencodeStartupWaitFailure};
use super::ensure_flight::RuntimeEnsureFlightGuard;
use super::start_pipeline::{RuntimeExistingLookup, RuntimePostStartPolicy, RuntimeStartInput};
use super::startup_status::{RuntimeStartupFailure, RuntimeStartupProgress};
use anyhow::{anyhow, Result};
use host_domain::{
    now_rfc3339, AgentRuntimeKind, RepoRuntimeStartupFailureKind, RuntimeInstanceSummary,
};
use std::time::Instant;

impl AppService {
    pub(in crate::app_service::runtime_orchestrator) fn find_existing_workspace_runtime(
        &self,
        runtime_kind: &AgentRuntimeKind,
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
        .filter(|runtime| runtime.kind == *runtime_kind))
    }

    pub(in crate::app_service::runtime_orchestrator) fn ensure_workspace_runtime(
        &self,
        runtime_kind: AgentRuntimeKind,
        repo_path: &str,
    ) -> Result<RuntimeInstanceSummary> {
        let repo_key = self.resolve_authorized_repo_path(repo_path)?;
        let repo_path = repo_key.as_str();

        if let Some(existing) =
            self.find_existing_workspace_runtime(&runtime_kind, repo_key.as_str())?
        {
            return Ok(existing);
        }

        let (flight, is_leader) =
            self.acquire_runtime_ensure_flight(runtime_kind.clone(), repo_key.as_str())?;
        if !is_leader {
            return Self::wait_for_runtime_ensure_flight(&flight);
        }
        let mut flight_guard =
            RuntimeEnsureFlightGuard::new(self, runtime_kind.clone(), repo_key.as_str(), flight);
        let startup_started_at_instant = Instant::now();
        let startup_started_at = now_rfc3339();

        let startup_result = (|| -> Result<RuntimeInstanceSummary> {
            if let Some(existing) =
                self.find_existing_workspace_runtime(&runtime_kind, repo_key.as_str())?
            {
                return Ok(existing);
            }

            let startup_error_context = format!(
                "{} workspace runtime failed to start for {repo_path}",
                runtime_kind.as_str()
            );
            let startup_policy = self.resolve_runtime_startup_policy(
                &runtime_kind,
                "workspace_runtime",
                repo_path,
                Self::WORKSPACE_RUNTIME_TASK_ID,
                Self::WORKSPACE_RUNTIME_ROLE,
                startup_error_context.as_str(),
            )?;

            self.spawn_and_register_runtime(RuntimeStartInput {
                runtime_kind: runtime_kind.clone(),
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
                .find_map(|cause| cause.downcast_ref::<OpencodeStartupWaitFailure>());
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
                &runtime_kind,
                repo_key.as_str(),
                &RuntimeStartupProgress {
                    started_at_instant: startup_started_at_instant,
                    started_at: startup_started_at.clone(),
                    attempts,
                    elapsed_ms,
                },
                RuntimeStartupFailure {
                    failure_kind,
                    failure_reason: failure_reason.to_string(),
                    detail: format!("{error:#}"),
                },
            )?;
        }
        flight_guard.complete(&startup_result)?;
        startup_result
    }

    pub(in crate::app_service::runtime_orchestrator) fn spawn_and_register_runtime(
        &self,
        input: RuntimeStartInput<'_>,
    ) -> Result<RuntimeInstanceSummary> {
        let spawned_server = self.spawn_runtime_server(&input)?;
        let startup_started_at_instant = spawned_server.startup_started_at_instant;
        let startup_started_at = spawned_server.startup_started_at.clone();
        let startup_report = spawned_server.startup_report;
        let runtime_kind = input.runtime_kind.clone();
        let repo_key = input.repo_key.clone();
        let summary = self.attach_runtime_session(input, spawned_server)?;
        self.mark_runtime_startup_ready(
            &runtime_kind,
            repo_key.as_str(),
            &summary,
            &RuntimeStartupProgress {
                started_at_instant: startup_started_at_instant,
                started_at: startup_started_at,
                attempts: Some(startup_report.attempts()),
                elapsed_ms: Some(startup_report.startup_ms()),
            },
        )?;
        Ok(summary)
    }
}
