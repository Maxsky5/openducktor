use super::cleanup_plans::{
    normalize_path_for_comparison, normalize_path_key, IMPLEMENTATION_SESSION_ROLES,
};
use crate::app_service::{
    service_core::AppService, RuntimeSessionStatusProbeOutcome, RuntimeSessionStatusProbeTarget,
    RuntimeSessionStatusProbeTargetResolution,
};
use anyhow::{anyhow, Context, Result};
use host_domain::AgentSessionDocument;
use std::collections::{HashMap, HashSet};

mod probe_support;

use self::probe_support::{
    build_session_probe_plans, SessionProbePlan, TaskActiveWorkEvidence, TaskActivityProbePlan,
    TaskRuntimeRouteIndex,
};

pub(super) struct TaskActivityGuard<'a> {
    service: &'a AppService,
}

impl<'a> TaskActivityGuard<'a> {
    pub(super) fn new(service: &'a AppService) -> Self {
        Self { service }
    }

    pub(super) fn ensure_no_active_task_delete_runs(
        &self,
        repo_path: &str,
        task_ids: &[&str],
    ) -> Result<()> {
        let mut active_tasks = Vec::new();
        for task_id in task_ids {
            let sessions = self.service.agent_sessions_list(repo_path, task_id)?;
            let evidence = self
                .collect_active_task_work_evidence(
                    repo_path,
                    &sessions,
                    IMPLEMENTATION_SESSION_ROLES,
                )
                .with_context(|| {
                    format!("Failed checking active task work before deleting {task_id}")
                })?;
            if evidence.has_any_activity() {
                active_tasks.push(((*task_id).to_string(), evidence));
            }
        }

        if active_tasks.is_empty() {
            return Ok(());
        }

        active_tasks.sort_by(|left, right| left.0.cmp(&right.0));
        let qa_only = active_tasks.iter().all(|(_, evidence)| {
            evidence
                .active_session_roles
                .iter()
                .all(|role| role == "qa")
        });
        let active_summary = active_tasks
            .iter()
            .map(|(task_id, evidence)| format!("{task_id} ({})", evidence.delete_blocker_summary()))
            .collect::<Vec<_>>()
            .join(", ");
        if qa_only {
            return Err(anyhow!(
                "Cannot delete tasks with active QA work in progress. Stop the active QA session(s) first: {active_summary}"
            ));
        }

        Err(anyhow!(
            "Cannot delete tasks with active builder work in progress. Stop the active session(s) first: {active_summary}"
        ))
    }

    pub(super) fn ensure_no_active_task_reset_activity(
        &self,
        repo_path: &str,
        task_id: &str,
        sessions: &[AgentSessionDocument],
        operation_label: &str,
        session_roles: &[&str],
    ) -> Result<()> {
        let evidence = self
            .collect_active_task_work_evidence(repo_path, sessions, session_roles)
            .with_context(|| {
                format!("Failed checking live runtime state before {operation_label} {task_id}")
            })?;

        if evidence.active_session_roles.is_empty() {
            return Ok(());
        }

        Err(anyhow!(
            "Cannot {operation_label} while active {} session(s) exist for task {task_id}. Stop the active session(s) first.",
            evidence.active_session_roles.join("/")
        ))
    }

    fn collect_active_task_work_evidence(
        &self,
        repo_path: &str,
        sessions: &[AgentSessionDocument],
        session_roles: &[&str],
    ) -> Result<TaskActiveWorkEvidence> {
        let runtime_routes_by_session = TaskRuntimeRouteIndex::collect(self.service, repo_path)?;
        let probe_plan =
            self.build_probe_plan(sessions, session_roles, &runtime_routes_by_session)?;

        let probe_outcomes_by_target = self
            .service
            .load_cached_runtime_session_statuses_for_targets(&probe_plan.probe_targets)?;
        let active_session_roles = self
            .collect_active_session_roles(&probe_plan.session_plans, &probe_outcomes_by_target)?;

        Ok(TaskActiveWorkEvidence {
            active_session_roles,
        })
    }

    fn build_probe_plan(
        &self,
        sessions: &[AgentSessionDocument],
        session_roles: &[&str],
        runtime_route_index: &TaskRuntimeRouteIndex,
    ) -> Result<TaskActivityProbePlan> {
        let mut probe_targets = Vec::new();
        let session_plans = build_session_probe_plans(
            self.service,
            sessions,
            session_roles,
            runtime_route_index,
            &mut probe_targets,
        )?;

        Ok(TaskActivityProbePlan {
            session_plans,
            probe_targets,
        })
    }

    fn collect_active_session_roles(
        &self,
        session_plans: &[SessionProbePlan],
        probe_outcomes_by_target: &HashMap<
            RuntimeSessionStatusProbeTarget,
            RuntimeSessionStatusProbeOutcome,
        >,
    ) -> Result<Vec<String>> {
        let mut active_roles = HashSet::new();
        for session_probe_plan in session_plans {
            let Some(probe_target_resolution) = session_probe_plan.probe_target_resolution.as_ref()
            else {
                continue;
            };
            match probe_target_resolution {
                RuntimeSessionStatusProbeTargetResolution::Unsupported => {
                    active_roles.insert(session_probe_plan.role.clone());
                }
                RuntimeSessionStatusProbeTargetResolution::Target(primary_target) => {
                    let probe_outcome =
                        probe_outcomes_by_target
                            .get(primary_target)
                            .ok_or_else(|| {
                                anyhow!(
                                    "Missing cached runtime session status outcome for {}",
                                    session_probe_plan.worktree_key
                                )
                            })?;
                    match probe_outcome {
                        RuntimeSessionStatusProbeOutcome::Snapshot(snapshot) => {
                            if snapshot.has_no_live_sessions() {
                                continue;
                            }

                            if snapshot
                                .has_live_session(session_probe_plan.external_session_id.as_str())
                            {
                                active_roles.insert(session_probe_plan.role.clone());
                            }
                        }
                        RuntimeSessionStatusProbeOutcome::Unsupported => {
                            active_roles.insert(session_probe_plan.role.clone());
                        }
                        RuntimeSessionStatusProbeOutcome::ActionableError(error) => {
                            return Err(anyhow!(error.to_string()))
                        }
                    }
                }
            }
        }

        let mut active_session_roles = active_roles.into_iter().collect::<Vec<_>>();
        active_session_roles.sort_unstable();
        Ok(active_session_roles)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_service::test_support::{
        build_service_with_git_state, builtin_opencode_runtime_descriptor,
        builtin_opencode_runtime_route, spawn_opencode_session_status_server, unique_temp_path,
    };
    use crate::app_service::AgentRuntimeProcess;
    use host_domain::{AgentRuntimeKind, GitCurrentBranch, RuntimeInstanceSummary, RuntimeRole};

    fn insert_workspace_runtime_for_kind(
        service: &AppService,
        runtime_kind: AgentRuntimeKind,
        runtime_id: &str,
        repo_path: &str,
        runtime_route: host_domain::RuntimeRoute,
    ) {
        let descriptor = if runtime_kind == AgentRuntimeKind::opencode() {
            builtin_opencode_runtime_descriptor()
        } else {
            let mut descriptor = builtin_opencode_runtime_descriptor();
            descriptor.kind = runtime_kind.clone();
            descriptor
        };
        let summary = RuntimeInstanceSummary {
            kind: runtime_kind,
            runtime_id: runtime_id.to_string(),
            repo_path: repo_path.to_string(),
            task_id: None,
            role: RuntimeRole::Workspace,
            working_directory: repo_path.to_string(),
            runtime_route,
            started_at: "2026-03-17T11:00:00Z".to_string(),
            descriptor,
        };

        service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .insert(
                runtime_id.to_string(),
                AgentRuntimeProcess {
                    summary,
                    child: None,
                    _runtime_process_guard: None,
                    cleanup_target: None,
                },
            );
    }

    fn build_service() -> AppService {
        let (service, _task_state, _git_state) = build_service_with_git_state(
            Vec::new(),
            Vec::new(),
            GitCurrentBranch {
                name: Some("main".to_string()),
                detached: false,
                revision: None,
            },
        );
        service
    }

    #[test]
    fn active_session_probe_uses_repo_runtime_for_task_worktree_session_cwd() -> Result<()> {
        let repo_path = unique_temp_path("activity-guard-repo-runtime-task-worktree");
        let worktree_path = repo_path.join("task-worktree");
        let repo_path_string = repo_path.to_string_lossy().to_string();
        let worktree_path_string = worktree_path.to_string_lossy().to_string();
        let service = build_service();
        let (port, server_handle) =
            spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"busy"}}"#)?;
        insert_workspace_runtime_for_kind(
            &service,
            AgentRuntimeKind::opencode(),
            "runtime-opencode-repo",
            repo_path_string.as_str(),
            builtin_opencode_runtime_route(port),
        );
        let sessions = vec![AgentSessionDocument {
            external_session_id: "external-build-session".to_string(),
            role: "build".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: worktree_path_string,
            selected_model: None,
        }];

        let evidence = TaskActivityGuard::new(&service).collect_active_task_work_evidence(
            repo_path_string.as_str(),
            &sessions,
            &["build"],
        )?;

        assert_eq!(evidence.active_session_roles, vec!["build".to_string()]);
        server_handle
            .join()
            .expect("status server thread should finish");
        Ok(())
    }

    #[test]
    fn active_session_probe_does_not_use_runtime_from_another_kind() -> Result<()> {
        let repo_path = unique_temp_path("activity-guard-runtime-kind-selection");
        let repo_path_string = repo_path.to_string_lossy().to_string();
        let service = build_service();
        insert_workspace_runtime_for_kind(
            &service,
            AgentRuntimeKind::from("other-runtime"),
            "runtime-other-repo",
            repo_path_string.as_str(),
            host_domain::RuntimeRoute::LocalHttp {
                endpoint: "http://127.0.0.1:1".to_string(),
            },
        );
        let sessions = vec![AgentSessionDocument {
            external_session_id: "external-build-session".to_string(),
            role: "build".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: repo_path_string.clone(),
            selected_model: None,
        }];

        let evidence = TaskActivityGuard::new(&service).collect_active_task_work_evidence(
            repo_path_string.as_str(),
            &sessions,
            &["build"],
        )?;

        assert!(evidence.active_session_roles.is_empty());
        Ok(())
    }
}
