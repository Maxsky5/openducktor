use super::super::AppService;
use anyhow::{anyhow, Result};
use host_domain::{
    now_rfc3339, AgentRuntimeKind, RepoRuntimeStartupFailureKind, RepoRuntimeStartupStage,
    RepoRuntimeStartupStatus, RuntimeInstanceSummary,
};
use std::time::Instant;

#[derive(Clone)]
pub(in crate::app_service) struct RuntimeStartupProgress {
    pub(in crate::app_service) started_at_instant: Instant,
    pub(in crate::app_service) started_at: String,
    pub(in crate::app_service) attempts: Option<u32>,
    pub(in crate::app_service) elapsed_ms: Option<u64>,
}

pub(super) struct RuntimeStartupFailure {
    pub(super) failure_kind: RepoRuntimeStartupFailureKind,
    pub(super) failure_reason: String,
    pub(super) detail: String,
}

impl AppService {
    pub(in crate::app_service::runtime_orchestrator) fn runtime_ensure_flight_key(
        runtime_kind: &AgentRuntimeKind,
        repo_key: &str,
    ) -> String {
        format!("{}::{repo_key}", runtime_kind.as_str())
    }

    fn update_runtime_startup_status(
        &self,
        runtime_kind: &AgentRuntimeKind,
        repo_key: &str,
        update: impl FnOnce(&mut super::super::service_core::RuntimeStartupStatusEntry),
    ) -> Result<()> {
        let key = Self::runtime_ensure_flight_key(runtime_kind, repo_key);
        let mut statuses = self
            .runtime_startup_status
            .lock()
            .map_err(|_| anyhow!("Runtime startup status lock poisoned"))?;
        let entry = statuses.entry(key).or_insert_with(|| {
            super::super::service_core::RuntimeStartupStatusEntry::new(
                runtime_kind.clone(),
                repo_key.to_string(),
                RepoRuntimeStartupStage::Idle,
            )
        });
        update(entry);
        entry.updated_at = now_rfc3339();
        Ok(())
    }

    pub(in crate::app_service) fn mark_runtime_startup_requested(
        &self,
        runtime_kind: &AgentRuntimeKind,
        repo_key: &str,
        progress: &RuntimeStartupProgress,
    ) -> Result<()> {
        self.update_runtime_startup_status(runtime_kind, repo_key, |entry| {
            entry.stage = RepoRuntimeStartupStage::StartupRequested;
            entry.runtime = None;
            entry.started_at = Some(progress.started_at.clone());
            entry.started_at_instant = Some(progress.started_at_instant);
            entry.elapsed_ms = None;
            entry.attempts = Some(0);
            entry.failure_kind = None;
            entry.failure_reason = None;
            entry.detail = None;
        })
    }

    pub(in crate::app_service) fn mark_runtime_startup_waiting(
        &self,
        runtime_kind: &AgentRuntimeKind,
        repo_key: &str,
        progress: &RuntimeStartupProgress,
    ) -> Result<()> {
        self.update_runtime_startup_status(runtime_kind, repo_key, |entry| {
            entry.stage = RepoRuntimeStartupStage::WaitingForRuntime;
            entry.runtime = None;
            entry.started_at = Some(progress.started_at.clone());
            entry.started_at_instant = Some(progress.started_at_instant);
            entry.elapsed_ms = None;
            entry.attempts = progress.attempts;
            entry.failure_kind = None;
            entry.failure_reason = None;
            entry.detail = None;
        })
    }

    pub(in crate::app_service) fn mark_runtime_startup_ready(
        &self,
        runtime_kind: &AgentRuntimeKind,
        repo_key: &str,
        runtime: &RuntimeInstanceSummary,
        progress: &RuntimeStartupProgress,
    ) -> Result<()> {
        self.update_runtime_startup_status(runtime_kind, repo_key, |entry| {
            entry.stage = RepoRuntimeStartupStage::RuntimeReady;
            entry.runtime = Some(runtime.clone());
            entry.started_at = Some(progress.started_at.clone());
            entry.started_at_instant = Some(progress.started_at_instant);
            entry.elapsed_ms = progress.elapsed_ms;
            entry.attempts = progress.attempts;
            entry.failure_kind = None;
            entry.failure_reason = None;
            entry.detail = None;
        })
    }

    pub(in crate::app_service::runtime_orchestrator) fn mark_runtime_startup_failed(
        &self,
        runtime_kind: &AgentRuntimeKind,
        repo_key: &str,
        progress: &RuntimeStartupProgress,
        failure: RuntimeStartupFailure,
    ) -> Result<()> {
        self.update_runtime_startup_status(runtime_kind, repo_key, |entry| {
            entry.stage = RepoRuntimeStartupStage::StartupFailed;
            entry.runtime = None;
            entry.started_at = Some(progress.started_at.clone());
            entry.started_at_instant = Some(progress.started_at_instant);
            entry.elapsed_ms = progress.elapsed_ms;
            entry.attempts = progress.attempts;
            entry.failure_kind = Some(failure.failure_kind);
            entry.failure_reason = Some(failure.failure_reason.clone());
            entry.detail = Some(failure.detail.clone());
        })
    }

    pub(in crate::app_service::runtime_orchestrator) fn clear_runtime_startup_status(
        &self,
        runtime_kind: &AgentRuntimeKind,
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

    pub(in crate::app_service::runtime_orchestrator) fn clear_runtime_startup_status_for_runtime(
        &self,
        runtime: &RuntimeInstanceSummary,
    ) -> Result<()> {
        self.clear_runtime_startup_status(&runtime.kind, runtime.repo_path.as_str())
    }

    pub fn runtime_startup_status(
        &self,
        runtime_kind: &str,
        repo_path: &str,
    ) -> Result<RepoRuntimeStartupStatus> {
        let runtime_kind = self.resolve_supported_runtime_kind(runtime_kind)?;
        let repo_key = self.resolve_authorized_repo_path(repo_path)?;
        let status_key = Self::runtime_ensure_flight_key(&runtime_kind, repo_key.as_str());
        let existing_runtime =
            self.find_existing_workspace_runtime(&runtime_kind, repo_key.as_str())?;

        if let Some(snapshot) = self
            .runtime_startup_status
            .lock()
            .map_err(|_| anyhow!("Runtime startup status lock poisoned"))?
            .get(status_key.as_str())
            .cloned()
        {
            if snapshot.stage != RepoRuntimeStartupStage::RuntimeReady && existing_runtime.is_none()
            {
                return Ok(snapshot.to_public_status());
            }
        }

        if let Some(runtime) = existing_runtime {
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
}

#[cfg(test)]
mod tests {
    use super::{RuntimeStartupFailure, RuntimeStartupProgress};
    use crate::app_service::service_core::AgentRuntimeProcess;
    use crate::app_service::test_support::{
        build_service_with_state, builtin_opencode_runtime_descriptor,
    };
    use crate::AppService;
    use anyhow::Result;
    use host_domain::{
        AgentRuntimeKind, RepoRuntimeStartupFailureKind, RepoRuntimeStartupStage, RuntimeRole,
    };
    use std::time::Instant;

    fn insert_workspace_runtime(
        service: &AppService,
        runtime: host_domain::RuntimeInstanceSummary,
    ) {
        service
            .agent_runtimes
            .lock()
            .expect("agent runtimes lock poisoned")
            .insert(
                runtime.runtime_id.clone(),
                AgentRuntimeProcess {
                    summary: runtime,
                    child: None,
                    _runtime_process_guard: None,
                    cleanup_target: None,
                },
            );
    }

    #[test]
    fn runtime_startup_status_tracks_waiting_and_failure_stages() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let repo_path = "/tmp/runtime-startup-status";
        let started_at_instant = Instant::now();
        let started_at = "2026-04-04T16:00:00Z";

        service.mark_runtime_startup_requested(
            &AgentRuntimeKind::opencode(),
            repo_path,
            &RuntimeStartupProgress {
                started_at_instant,
                started_at: started_at.to_string(),
                attempts: Some(0),
                elapsed_ms: None,
            },
        )?;
        service.mark_runtime_startup_waiting(
            &AgentRuntimeKind::opencode(),
            repo_path,
            &RuntimeStartupProgress {
                started_at_instant,
                started_at: started_at.to_string(),
                attempts: Some(3),
                elapsed_ms: None,
            },
        )?;

        let waiting_status = service.runtime_startup_status("opencode", repo_path)?;
        assert_eq!(
            waiting_status.stage,
            RepoRuntimeStartupStage::WaitingForRuntime
        );
        assert_eq!(waiting_status.attempts, Some(3));
        assert_eq!(waiting_status.started_at.as_deref(), Some(started_at));

        service.mark_runtime_startup_failed(
            &AgentRuntimeKind::opencode(),
            repo_path,
            &RuntimeStartupProgress {
                started_at_instant,
                started_at: started_at.to_string(),
                attempts: Some(4),
                elapsed_ms: Some(4200),
            },
            RuntimeStartupFailure {
                failure_kind: RepoRuntimeStartupFailureKind::Timeout,
                failure_reason: "timeout".to_string(),
                detail: "OpenCode startup probe failed reason=timeout".to_string(),
            },
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
    fn mark_runtime_startup_waiting_clears_stale_ready_and_failure_fields() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let repo_path = "/tmp/runtime-waiting-reset";
        let started_at_instant = Instant::now();
        let started_at = "2026-04-04T16:00:00Z";

        service.mark_runtime_startup_failed(
            &AgentRuntimeKind::opencode(),
            repo_path,
            &RuntimeStartupProgress {
                started_at_instant,
                started_at: started_at.to_string(),
                attempts: Some(3),
                elapsed_ms: Some(1200),
            },
            RuntimeStartupFailure {
                failure_kind: RepoRuntimeStartupFailureKind::Error,
                failure_reason: "child_exited".to_string(),
                detail: "startup failed".to_string(),
            },
        )?;

        service.mark_runtime_startup_ready(
            &AgentRuntimeKind::opencode(),
            repo_path,
            &host_domain::RuntimeInstanceSummary {
                kind: AgentRuntimeKind::opencode(),
                runtime_id: "runtime-ready".to_string(),
                repo_path: repo_path.to_string(),
                task_id: None,
                role: RuntimeRole::Workspace,
                working_directory: repo_path.to_string(),
                runtime_route: host_domain::RuntimeRoute::LocalHttp {
                    endpoint: "http://127.0.0.1:9999".to_string(),
                },
                started_at: started_at.to_string(),
                descriptor: builtin_opencode_runtime_descriptor(),
            },
            &RuntimeStartupProgress {
                started_at_instant,
                started_at: started_at.to_string(),
                attempts: Some(2),
                elapsed_ms: Some(1000),
            },
        )?;

        service.mark_runtime_startup_waiting(
            &AgentRuntimeKind::opencode(),
            repo_path,
            &RuntimeStartupProgress {
                started_at_instant,
                started_at: started_at.to_string(),
                attempts: Some(4),
                elapsed_ms: None,
            },
        )?;

        let waiting_status = service.runtime_startup_status("opencode", repo_path)?;
        assert_eq!(
            waiting_status.stage,
            RepoRuntimeStartupStage::WaitingForRuntime
        );
        assert!(waiting_status.runtime.is_none());
        assert_eq!(waiting_status.failure_kind, None);
        assert_eq!(waiting_status.failure_reason, None);
        assert_eq!(waiting_status.detail, None);
        assert_eq!(waiting_status.attempts, Some(4));

        Ok(())
    }

    #[test]
    fn runtime_startup_status_ignores_stale_ready_snapshot_without_live_runtime() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let repo_path = "/tmp/runtime-stale-ready";
        let started_at_instant = Instant::now();
        let started_at = "2026-04-04T16:00:00Z";

        service.mark_runtime_startup_waiting(
            &AgentRuntimeKind::opencode(),
            repo_path,
            &RuntimeStartupProgress {
                started_at_instant,
                started_at: started_at.to_string(),
                attempts: Some(1),
                elapsed_ms: None,
            },
        )?;
        service.mark_runtime_startup_ready(
            &AgentRuntimeKind::opencode(),
            repo_path,
            &host_domain::RuntimeInstanceSummary {
                kind: AgentRuntimeKind::opencode(),
                runtime_id: "runtime-stale".to_string(),
                repo_path: repo_path.to_string(),
                task_id: None,
                role: RuntimeRole::Workspace,
                working_directory: repo_path.to_string(),
                runtime_route: host_domain::RuntimeRoute::LocalHttp {
                    endpoint: "http://127.0.0.1:9999".to_string(),
                },
                started_at: started_at.to_string(),
                descriptor: builtin_opencode_runtime_descriptor(),
            },
            &RuntimeStartupProgress {
                started_at_instant,
                started_at: started_at.to_string(),
                attempts: Some(2),
                elapsed_ms: Some(1000),
            },
        )?;

        let status = service.runtime_startup_status("opencode", repo_path)?;

        assert_eq!(status.stage, RepoRuntimeStartupStage::Idle);
        assert!(status.runtime.is_none());
        Ok(())
    }

    #[test]
    fn runtime_startup_status_prefers_live_runtime_over_stale_waiting_snapshot() -> Result<()> {
        let (service, _task_state, _git_state) = build_service_with_state(vec![]);
        let repo_path = "/tmp/runtime-live-over-waiting";
        let started_at_instant = Instant::now();
        let started_at = "2026-04-04T16:00:00Z";

        service.mark_runtime_startup_waiting(
            &AgentRuntimeKind::opencode(),
            repo_path,
            &RuntimeStartupProgress {
                started_at_instant,
                started_at: started_at.to_string(),
                attempts: Some(2),
                elapsed_ms: None,
            },
        )?;

        let runtime = host_domain::RuntimeInstanceSummary {
            kind: AgentRuntimeKind::opencode(),
            runtime_id: "runtime-live".to_string(),
            repo_path: repo_path.to_string(),
            task_id: None,
            role: RuntimeRole::Workspace,
            working_directory: repo_path.to_string(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: "http://127.0.0.1:9999".to_string(),
            },
            started_at: started_at.to_string(),
            descriptor: builtin_opencode_runtime_descriptor(),
        };
        insert_workspace_runtime(&service, runtime.clone());

        let status = service.runtime_startup_status("opencode", repo_path)?;

        assert_eq!(status.stage, RepoRuntimeStartupStage::RuntimeReady);
        assert_eq!(
            status
                .runtime
                .as_ref()
                .map(|value| value.runtime_id.as_str()),
            Some("runtime-live")
        );

        service.runtime_stop("runtime-live")?;
        Ok(())
    }
}
