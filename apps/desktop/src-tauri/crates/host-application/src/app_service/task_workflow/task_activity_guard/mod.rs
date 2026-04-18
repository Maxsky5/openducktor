use super::cleanup_plans::{
    normalize_path_for_comparison, normalize_path_key, IMPLEMENTATION_SESSION_ROLES,
};
use crate::app_service::{
    service_core::AppService, RuntimeSessionStatusProbeOutcome, RuntimeSessionStatusProbeTarget,
    RuntimeSessionStatusProbeTargetResolution,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{AgentSessionDocument, RunState};
use std::collections::{HashMap, HashSet};
use std::path::Path;

mod probe_support;

use self::probe_support::{
    build_run_probe_plans, build_session_probe_plans, RunProbeCandidate, RunProbePlan,
    SessionProbePlan, TaskActiveWorkEvidence, TaskActivityProbePlan, TaskRuntimeRouteIndex,
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
                    task_id,
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
            !evidence.has_active_run
                && evidence
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
            "Cannot delete tasks with active builder work in progress. Stop the active run(s) or session(s) first: {active_summary}"
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
            .collect_active_task_work_evidence(repo_path, task_id, sessions, session_roles)
            .with_context(|| {
                format!("Failed checking live runtime state before {operation_label} {task_id}")
            })?;

        if evidence.has_active_run {
            return Err(anyhow!(
                "Cannot {operation_label} while builder work is active for task {task_id}. Stop the active run first."
            ));
        }

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
        task_id: &str,
        sessions: &[AgentSessionDocument],
        session_roles: &[&str],
    ) -> Result<TaskActiveWorkEvidence> {
        let normalized_repo = normalize_path_for_comparison(repo_path);
        let candidate_runs = self.collect_candidate_runs(&normalized_repo, task_id)?;
        let runtime_routes_by_session =
            TaskRuntimeRouteIndex::collect(self.service, repo_path, task_id, &candidate_runs)?;
        let probe_plan = self.build_probe_plan(
            &candidate_runs,
            sessions,
            session_roles,
            &runtime_routes_by_session,
        )?;

        let probe_outcomes_by_target = self
            .service
            .load_cached_runtime_session_statuses_for_targets(&probe_plan.probe_targets)?;
        let has_active_run =
            self.evaluate_run_activity(&probe_plan.run_plans, &probe_outcomes_by_target)?;
        let active_session_roles = self
            .collect_active_session_roles(&probe_plan.session_plans, &probe_outcomes_by_target)?;

        Ok(TaskActiveWorkEvidence {
            has_active_run,
            active_session_roles,
        })
    }

    fn collect_candidate_runs(
        &self,
        normalized_repo: &Path,
        task_id: &str,
    ) -> Result<Vec<RunProbeCandidate>> {
        Ok(self
            .service
            .runs
            .lock()
            .map_err(|_| anyhow!("Run state lock poisoned"))?
            .values()
            .filter(|run| {
                normalize_path_for_comparison(run.repo_path.as_str()) == normalized_repo
                    && run.task_id == task_id
                    && matches!(
                        run.summary.state,
                        RunState::Starting
                            | RunState::Running
                            | RunState::Blocked
                            | RunState::AwaitingDoneConfirmation
                    )
            })
            .map(|run| RunProbeCandidate {
                runtime_kind: run.summary.runtime_kind.clone(),
                runtime_route: run.summary.runtime_route.clone(),
                worktree_path: run.worktree_path.clone(),
            })
            .collect())
    }

    fn build_probe_plan(
        &self,
        candidate_runs: &[RunProbeCandidate],
        sessions: &[AgentSessionDocument],
        session_roles: &[&str],
        runtime_route_index: &TaskRuntimeRouteIndex,
    ) -> Result<TaskActivityProbePlan> {
        let mut probe_targets = Vec::new();
        let run_plans =
            build_run_probe_plans(self.service, candidate_runs, sessions, &mut probe_targets)?;
        let session_plans = build_session_probe_plans(
            self.service,
            sessions,
            session_roles,
            runtime_route_index,
            &mut probe_targets,
        )?;

        Ok(TaskActivityProbePlan {
            run_plans,
            session_plans,
            probe_targets,
        })
    }

    fn evaluate_run_activity(
        &self,
        run_plans: &[RunProbePlan],
        probe_outcomes_by_target: &HashMap<
            RuntimeSessionStatusProbeTarget,
            RuntimeSessionStatusProbeOutcome,
        >,
    ) -> Result<bool> {
        for run_probe_plan in run_plans {
            let Some(probe_target_resolution) = run_probe_plan.probe_target_resolution.as_ref()
            else {
                continue;
            };

            let RuntimeSessionStatusProbeTargetResolution::Target(primary_target) =
                probe_target_resolution
            else {
                return Ok(true);
            };

            let probe_outcome = probe_outcomes_by_target
                .get(primary_target)
                .ok_or_else(|| {
                    anyhow!(
                        "Missing cached runtime session status outcome for {}",
                        run_probe_plan.worktree_path
                    )
                })?;

            match probe_outcome {
                RuntimeSessionStatusProbeOutcome::Snapshot(snapshot) => {
                    if snapshot.has_no_live_sessions() {
                        continue;
                    }

                    if run_probe_plan
                        .external_session_ids
                        .iter()
                        .any(|external_session_id| snapshot.has_live_session(external_session_id))
                    {
                        return Ok(true);
                    }
                }
                RuntimeSessionStatusProbeOutcome::Unsupported => return Ok(true),
                RuntimeSessionStatusProbeOutcome::ActionableError(error) => {
                    return Err(anyhow!(error.to_string()))
                }
            }
        }

        Ok(false)
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
