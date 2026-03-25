use super::cleanup_plans::{normalize_path_for_comparison, normalize_path_key};
use crate::app_service::{
    has_live_opencode_session_status, is_unreachable_opencode_session_status_error,
    load_opencode_session_statuses, service_core::AppService, OpencodeSessionStatusMap,
};
use anyhow::{anyhow, Context, Result};
use host_domain::{AgentRuntimeKind, AgentSessionDocument, RunState, RuntimeRole, RuntimeRoute};
use std::collections::{HashMap, HashSet};

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
                .collect_active_task_work_evidence(repo_path, task_id, &sessions)
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

    pub(super) fn ensure_no_active_task_reset_runs(
        &self,
        repo_path: &str,
        task_id: &str,
        sessions: &[AgentSessionDocument],
    ) -> Result<()> {
        let evidence = self
            .collect_active_task_work_evidence(repo_path, task_id, sessions)
            .with_context(|| {
                format!("Failed checking live runtime state before resetting {task_id}")
            })?;

        if evidence.has_active_run {
            return Err(anyhow!(
                "Cannot reset implementation while builder work is active for task {task_id}. Stop the active run first."
            ));
        }

        if evidence.active_session_roles.is_empty() {
            return Ok(());
        }

        Err(anyhow!(
            "Cannot reset implementation while active {} session(s) exist for task {task_id}. Stop the active session(s) first.",
            evidence.active_session_roles.join("/")
        ))
    }

    fn collect_active_task_work_evidence(
        &self,
        repo_path: &str,
        task_id: &str,
        sessions: &[AgentSessionDocument],
    ) -> Result<TaskActiveWorkEvidence> {
        let normalized_repo = normalize_path_for_comparison(repo_path);
        let candidate_runs = self
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
            .collect::<Vec<_>>();
        let mut runtime_statuses_by_directory = HashMap::<String, OpencodeSessionStatusMap>::new();
        let mut runtime_routes_by_worktree = HashMap::new();
        let mut has_active_run = false;
        for run_candidate in &candidate_runs {
            runtime_routes_by_worktree.insert(
                normalize_path_key(run_candidate.worktree_path.as_str()),
                run_candidate.runtime_route.clone(),
            );

            if !is_live_build_run_for_task(
                run_candidate,
                sessions,
                &mut runtime_statuses_by_directory,
            )? {
                continue;
            }

            has_active_run = true;
            break;
        }
        let repo_runtime_routes_by_kind = self.collect_repo_runtime_routes_by_kind(repo_path)?;

        let mut active_roles = HashSet::new();
        for session in sessions
            .iter()
            .filter(|session| matches!(session.role.as_str(), "build" | "qa"))
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
            if !runtime_statuses_by_directory.contains_key(worktree_key.as_str()) {
                let mut statuses =
                    load_session_statuses(runtime_route, session.working_directory.as_str())?;

                if statuses.is_empty() {
                    if let (Some(primary_route), Some(fallback_route)) =
                        (worktree_runtime_route, repo_runtime_route)
                    {
                        let primary_endpoint = runtime_route_endpoint(primary_route);
                        let fallback_endpoint = runtime_route_endpoint(fallback_route);
                        if primary_endpoint != fallback_endpoint {
                            let fallback_statuses = load_session_statuses(
                                fallback_route,
                                session.working_directory.as_str(),
                            )?;
                            if !fallback_statuses.is_empty() {
                                statuses = fallback_statuses;
                            }
                        }
                    }
                }

                if !statuses.is_empty() {
                    runtime_statuses_by_directory.insert(worktree_key.clone(), statuses);
                }
            }

            if runtime_statuses_by_directory
                .get(worktree_key.as_str())
                .is_some_and(|statuses| {
                    has_live_opencode_session_status(statuses, external_session_id)
                })
            {
                active_roles.insert(session.role.as_str());
            }
        }
        let mut active_session_roles = active_roles
            .into_iter()
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        active_session_roles.sort_unstable();

        Ok(TaskActiveWorkEvidence {
            has_active_run,
            active_session_roles,
        })
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

fn load_session_statuses(
    route: &RuntimeRoute,
    working_directory: &str,
) -> Result<OpencodeSessionStatusMap> {
    load_opencode_session_statuses(route, working_directory).or_else(|error| {
        if is_unreachable_opencode_session_status_error(&error) {
            Ok(OpencodeSessionStatusMap::new())
        } else {
            Err(error)
        }
    })
}

fn is_live_build_run_for_task(
    run_summary: &RunProbeCandidate,
    sessions: &[AgentSessionDocument],
    runtime_statuses_by_directory: &mut HashMap<String, OpencodeSessionStatusMap>,
) -> Result<bool> {
    let normalized_worktree = normalize_path_for_comparison(run_summary.worktree_path.as_str());
    let external_session_ids = sessions
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
        .collect::<Vec<_>>();

    if external_session_ids.is_empty() {
        return Ok(true);
    }

    let directory_key = normalize_path_key(run_summary.worktree_path.as_str());
    if !runtime_statuses_by_directory.contains_key(directory_key.as_str()) {
        let statuses = load_session_statuses(
            &run_summary.runtime_route,
            run_summary.worktree_path.as_str(),
        )?;
        if statuses.is_empty() {
            return Ok(false);
        }
        runtime_statuses_by_directory.insert(directory_key.clone(), statuses);
    }

    let statuses = runtime_statuses_by_directory
        .get(directory_key.as_str())
        .ok_or_else(|| {
            anyhow!(
                "Missing cached OpenCode session statuses for {}",
                run_summary.worktree_path
            )
        })?;
    Ok(external_session_ids
        .iter()
        .any(|external_session_id| has_live_opencode_session_status(statuses, external_session_id)))
}

#[derive(Clone)]
struct RunProbeCandidate {
    runtime_kind: AgentRuntimeKind,
    runtime_route: RuntimeRoute,
    worktree_path: String,
}
