use super::cleanup_plans::{normalize_path_for_comparison, normalize_path_key};
use crate::app_service::{
    dedupe_opencode_session_status_probe_targets, has_live_opencode_session_status,
    service_core::AppService, OpencodeSessionStatusMap, OpencodeSessionStatusProbeTarget,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{AgentRuntimeKind, AgentSessionDocument, RunState, RuntimeRole, RuntimeRoute};
use std::collections::{HashMap, HashSet};
use std::path::Path;

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
        const IMPLEMENTATION_SESSION_ROLES: &[&str] = &["build", "qa"];
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
        let runtime_routes_by_worktree = collect_runtime_routes_by_worktree(&candidate_runs);
        let repo_runtime_routes_by_kind = self.collect_repo_runtime_routes_by_kind(repo_path)?;
        let probe_plan = self.build_probe_plan(
            &candidate_runs,
            sessions,
            session_roles,
            &runtime_routes_by_worktree,
            &repo_runtime_routes_by_kind,
        );

        let primary_statuses_by_target = self
            .service
            .load_cached_opencode_session_statuses_for_targets(&probe_plan.primary_probe_targets)?;
        let has_active_run =
            self.evaluate_run_activity(&probe_plan.run_plans, &primary_statuses_by_target)?;

        let fallback_probe_targets = probe_plan.fallback_probe_targets(&primary_statuses_by_target);
        let fallback_statuses_by_target = self
            .service
            .load_cached_opencode_session_statuses_for_targets(&fallback_probe_targets)?;
        let active_session_roles = self.collect_active_session_roles(
            &probe_plan.session_plans,
            &primary_statuses_by_target,
            &fallback_statuses_by_target,
        )?;

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
                runtime_kind: run.summary.runtime_kind,
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
        runtime_routes_by_worktree: &HashMap<String, RuntimeRoute>,
        repo_runtime_routes_by_kind: &HashMap<AgentRuntimeKind, RuntimeRoute>,
    ) -> TaskActivityProbePlan {
        let mut primary_probe_targets = Vec::new();
        let run_plans = build_run_probe_plans(candidate_runs, sessions, &mut primary_probe_targets);
        let session_plans = build_session_probe_plans(
            sessions,
            session_roles,
            runtime_routes_by_worktree,
            repo_runtime_routes_by_kind,
            &mut primary_probe_targets,
        );

        TaskActivityProbePlan {
            run_plans,
            session_plans,
            primary_probe_targets,
        }
    }

    fn evaluate_run_activity(
        &self,
        run_plans: &[RunProbePlan],
        primary_statuses_by_target: &HashMap<
            OpencodeSessionStatusProbeTarget,
            OpencodeSessionStatusMap,
        >,
    ) -> Result<bool> {
        for run_probe_plan in run_plans {
            let Some(primary_target) = run_probe_plan.primary_target.as_ref() else {
                return Ok(true);
            };

            let statuses = primary_statuses_by_target
                .get(primary_target)
                .ok_or_else(|| {
                    anyhow!(
                        "Missing cached OpenCode session statuses for {}",
                        run_probe_plan.worktree_path
                    )
                })?;
            if run_probe_plan
                .external_session_ids
                .iter()
                .any(|external_session_id| {
                    has_live_opencode_session_status(statuses, external_session_id)
                })
            {
                return Ok(true);
            }
        }

        Ok(false)
    }

    fn collect_active_session_roles(
        &self,
        session_plans: &[SessionProbePlan],
        primary_statuses_by_target: &HashMap<
            OpencodeSessionStatusProbeTarget,
            OpencodeSessionStatusMap,
        >,
        fallback_statuses_by_target: &HashMap<
            OpencodeSessionStatusProbeTarget,
            OpencodeSessionStatusMap,
        >,
    ) -> Result<Vec<String>> {
        let mut active_roles = HashSet::new();
        for session_probe_plan in session_plans {
            let statuses = resolve_session_statuses(
                session_probe_plan,
                primary_statuses_by_target,
                fallback_statuses_by_target,
            )?;
            if has_live_opencode_session_status(
                statuses,
                session_probe_plan.external_session_id.as_str(),
            ) {
                active_roles.insert(session_probe_plan.role.clone());
            }
        }

        let mut active_session_roles = active_roles.into_iter().collect::<Vec<_>>();
        active_session_roles.sort_unstable();
        Ok(active_session_roles)
    }

    fn collect_repo_runtime_routes_by_kind(
        &self,
        repo_path: &str,
    ) -> Result<HashMap<AgentRuntimeKind, RuntimeRoute>> {
        let normalized_repo = normalize_path_for_comparison(repo_path);
        let runtimes = self
            .service
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;
        let mut routes_by_kind = HashMap::new();

        for runtime in runtimes.values() {
            if normalize_path_for_comparison(runtime.summary.repo_path.as_str()) != normalized_repo
            {
                continue;
            }

            if runtime.summary.role == RuntimeRole::Workspace {
                routes_by_kind.insert(runtime.summary.kind, runtime.summary.runtime_route.clone());
                continue;
            }

            routes_by_kind
                .entry(runtime.summary.kind)
                .or_insert_with(|| runtime.summary.runtime_route.clone());
        }

        Ok(routes_by_kind)
    }
}

#[derive(Default)]
struct TaskActiveWorkEvidence {
    has_active_run: bool,
    active_session_roles: Vec<String>,
}

impl TaskActiveWorkEvidence {
    fn has_any_activity(&self) -> bool {
        self.has_active_run || !self.active_session_roles.is_empty()
    }

    fn delete_blocker_summary(&self) -> String {
        let mut blockers = Vec::new();
        if self.has_active_run {
            blockers.push("builder run".to_string());
        }

        for role in &self.active_session_roles {
            blockers.push(format!("{role} session"));
        }

        blockers.join(", ")
    }
}

struct TaskActivityProbePlan {
    run_plans: Vec<RunProbePlan>,
    session_plans: Vec<SessionProbePlan>,
    primary_probe_targets: Vec<OpencodeSessionStatusProbeTarget>,
}

impl TaskActivityProbePlan {
    fn fallback_probe_targets(
        &self,
        primary_statuses_by_target: &HashMap<
            OpencodeSessionStatusProbeTarget,
            OpencodeSessionStatusMap,
        >,
    ) -> Vec<OpencodeSessionStatusProbeTarget> {
        dedupe_probe_targets(
            self.session_plans
                .iter()
                .filter_map(|session_probe_plan| {
                    let primary_statuses =
                        primary_statuses_by_target.get(&session_probe_plan.primary_target)?;
                    if primary_statuses.is_empty() {
                        session_probe_plan.fallback_target.clone()
                    } else {
                        None
                    }
                })
                .collect(),
        )
    }
}

fn build_run_probe_plans(
    candidate_runs: &[RunProbeCandidate],
    sessions: &[AgentSessionDocument],
    primary_probe_targets: &mut Vec<OpencodeSessionStatusProbeTarget>,
) -> Vec<RunProbePlan> {
    let mut run_plans = Vec::with_capacity(candidate_runs.len());
    for run_candidate in candidate_runs {
        let external_session_ids = collect_build_external_session_ids(run_candidate, sessions);
        let primary_target = if external_session_ids.is_empty() {
            None
        } else {
            let target = OpencodeSessionStatusProbeTarget::for_runtime_route(
                &run_candidate.runtime_route,
                run_candidate.worktree_path.as_str(),
            );
            primary_probe_targets.push(target.clone());
            Some(target)
        };
        run_plans.push(RunProbePlan {
            worktree_path: run_candidate.worktree_path.clone(),
            external_session_ids,
            primary_target,
        });
    }
    run_plans
}

fn build_session_probe_plans(
    sessions: &[AgentSessionDocument],
    session_roles: &[&str],
    runtime_routes_by_worktree: &HashMap<String, RuntimeRoute>,
    repo_runtime_routes_by_kind: &HashMap<AgentRuntimeKind, RuntimeRoute>,
    primary_probe_targets: &mut Vec<OpencodeSessionStatusProbeTarget>,
) -> Vec<SessionProbePlan> {
    let allowed_roles = session_roles
        .iter()
        .map(|role| role.trim())
        .collect::<HashSet<_>>();
    let mut session_plans = Vec::new();
    for session in sessions
        .iter()
        .filter(|session| allowed_roles.contains(session.role.trim()))
    {
        let external_session_id = session
            .external_session_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let Some(external_session_id) = external_session_id else {
            continue;
        };

        let worktree_key = normalize_path_key(session.working_directory.as_str());
        let fallback_runtime_kind = parse_runtime_kind(session.runtime_kind.as_str());
        let worktree_runtime_route = runtime_routes_by_worktree.get(worktree_key.as_str());
        let repo_runtime_route =
            fallback_runtime_kind.and_then(|kind| repo_runtime_routes_by_kind.get(&kind));
        let runtime_route = worktree_runtime_route.or(repo_runtime_route);
        let Some(runtime_route) = runtime_route else {
            continue;
        };

        let primary_target = OpencodeSessionStatusProbeTarget::for_runtime_route(
            runtime_route,
            session.working_directory.as_str(),
        );
        primary_probe_targets.push(primary_target.clone());
        let fallback_target = select_fallback_probe_target(
            worktree_runtime_route,
            repo_runtime_route,
            session.working_directory.as_str(),
        );

        session_plans.push(SessionProbePlan {
            worktree_key,
            role: session.role.clone(),
            external_session_id: external_session_id.to_string(),
            primary_target,
            fallback_target,
        });
    }
    session_plans
}

fn collect_runtime_routes_by_worktree(
    candidate_runs: &[RunProbeCandidate],
) -> HashMap<String, RuntimeRoute> {
    candidate_runs
        .iter()
        .map(|run_candidate| {
            (
                normalize_path_key(run_candidate.worktree_path.as_str()),
                run_candidate.runtime_route.clone(),
            )
        })
        .collect()
}

fn resolve_session_statuses<'a>(
    session_probe_plan: &SessionProbePlan,
    primary_statuses_by_target: &'a HashMap<
        OpencodeSessionStatusProbeTarget,
        OpencodeSessionStatusMap,
    >,
    fallback_statuses_by_target: &'a HashMap<
        OpencodeSessionStatusProbeTarget,
        OpencodeSessionStatusMap,
    >,
) -> Result<&'a OpencodeSessionStatusMap> {
    let primary_statuses = primary_statuses_by_target
        .get(&session_probe_plan.primary_target)
        .ok_or_else(|| {
            anyhow!(
                "Missing cached OpenCode session statuses for {}",
                session_probe_plan.worktree_key
            )
        })?;
    if !primary_statuses.is_empty() {
        return Ok(primary_statuses);
    }

    let Some(fallback_target) = session_probe_plan.fallback_target.as_ref() else {
        return Ok(primary_statuses);
    };
    let fallback_statuses = fallback_statuses_by_target
        .get(fallback_target)
        .ok_or_else(|| {
            anyhow!(
                "Missing cached OpenCode session fallback statuses for {}",
                session_probe_plan.worktree_key
            )
        })?;
    if fallback_statuses.is_empty() {
        Ok(primary_statuses)
    } else {
        Ok(fallback_statuses)
    }
}

fn select_fallback_probe_target(
    worktree_runtime_route: Option<&RuntimeRoute>,
    repo_runtime_route: Option<&RuntimeRoute>,
    working_directory: &str,
) -> Option<OpencodeSessionStatusProbeTarget> {
    let (Some(primary_route), Some(fallback_route)) = (worktree_runtime_route, repo_runtime_route)
    else {
        return None;
    };
    let primary_endpoint = runtime_route_endpoint(primary_route);
    let fallback_endpoint = runtime_route_endpoint(fallback_route);
    if primary_endpoint == fallback_endpoint {
        return None;
    }

    Some(OpencodeSessionStatusProbeTarget::for_runtime_route(
        fallback_route,
        working_directory,
    ))
}

fn dedupe_probe_targets(
    targets: Vec<OpencodeSessionStatusProbeTarget>,
) -> Vec<OpencodeSessionStatusProbeTarget> {
    dedupe_opencode_session_status_probe_targets(targets)
}

fn parse_runtime_kind(value: &str) -> Option<AgentRuntimeKind> {
    match value.trim() {
        "opencode" => Some(AgentRuntimeKind::Opencode),
        _ => None,
    }
}

fn runtime_route_endpoint(route: &RuntimeRoute) -> &str {
    match route {
        RuntimeRoute::LocalHttp { endpoint } => endpoint.as_str(),
    }
}

fn collect_build_external_session_ids(
    run_summary: &RunProbeCandidate,
    sessions: &[AgentSessionDocument],
) -> Vec<String> {
    let normalized_worktree = normalize_path_for_comparison(run_summary.worktree_path.as_str());
    sessions
        .iter()
        .filter(|session| session.role.trim() == "build")
        .filter(|session| session.runtime_kind.trim() == run_summary.runtime_kind.as_str())
        .filter(|session| {
            normalize_path_for_comparison(session.working_directory.as_str()) == normalized_worktree
        })
        .filter_map(|session| {
            session
                .external_session_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .collect()
}

#[derive(Clone)]
struct RunProbeCandidate {
    runtime_kind: AgentRuntimeKind,
    runtime_route: RuntimeRoute,
    worktree_path: String,
}

struct RunProbePlan {
    worktree_path: String,
    external_session_ids: Vec<String>,
    primary_target: Option<OpencodeSessionStatusProbeTarget>,
}

struct SessionProbePlan {
    worktree_key: String,
    role: String,
    external_session_id: String,
    primary_target: OpencodeSessionStatusProbeTarget,
    fallback_target: Option<OpencodeSessionStatusProbeTarget>,
}
