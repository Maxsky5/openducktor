use super::*;
use crate::app_service::dedupe_runtime_session_probe_targets;

#[derive(Default)]
pub(super) struct TaskActiveWorkEvidence {
    pub(super) has_active_run: bool,
    pub(super) active_session_roles: Vec<String>,
}

impl TaskActiveWorkEvidence {
    pub(super) fn has_any_activity(&self) -> bool {
        self.has_active_run || !self.active_session_roles.is_empty()
    }

    pub(super) fn delete_blocker_summary(&self) -> String {
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

pub(super) struct TaskActivityProbePlan {
    pub(super) run_plans: Vec<RunProbePlan>,
    pub(super) session_plans: Vec<SessionProbePlan>,
    pub(super) primary_probe_targets: Vec<RuntimeSessionStatusProbeTarget>,
}

impl TaskActivityProbePlan {
    pub(super) fn fallback_probe_targets(
        &self,
        primary_statuses_by_target: &HashMap<
            RuntimeSessionStatusProbeTarget,
            RuntimeSessionStatusMap,
        >,
    ) -> Vec<RuntimeSessionStatusProbeTarget> {
        dedupe_probe_targets(
            self.session_plans
                .iter()
                .filter_map(|session_probe_plan| {
                    let primary_target = session_probe_plan.primary_target.as_ref()?;
                    let primary_statuses = primary_statuses_by_target.get(primary_target)?;
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

pub(super) fn build_run_probe_plans(
    service: &AppService,
    candidate_runs: &[RunProbeCandidate],
    sessions: &[AgentSessionDocument],
    primary_probe_targets: &mut Vec<RuntimeSessionStatusProbeTarget>,
) -> Result<Vec<RunProbePlan>> {
    let mut run_plans = Vec::with_capacity(candidate_runs.len());
    for run_candidate in candidate_runs {
        let external_session_ids = collect_build_external_session_ids(run_candidate, sessions);
        let primary_target = if external_session_ids.is_empty() {
            None
        } else {
            let target = service
                .runtime_registry
                .runtime(&run_candidate.runtime_kind)?
                .session_status_probe_target(
                    &run_candidate.runtime_route,
                    run_candidate.worktree_path.as_str(),
                )?;
            if let Some(target) = target {
                primary_probe_targets.push(target.clone());
                Some(target)
            } else {
                None
            }
        };
        run_plans.push(RunProbePlan {
            worktree_path: run_candidate.worktree_path.clone(),
            external_session_ids,
            primary_target,
        });
    }
    Ok(run_plans)
}

pub(super) fn build_session_probe_plans(
    service: &AppService,
    sessions: &[AgentSessionDocument],
    session_roles: &[&str],
    runtime_routes_by_worktree: &HashMap<String, RuntimeRoute>,
    repo_runtime_routes_by_kind: &HashMap<AgentRuntimeKind, RuntimeRoute>,
    primary_probe_targets: &mut Vec<RuntimeSessionStatusProbeTarget>,
) -> Result<Vec<SessionProbePlan>> {
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
        let fallback_runtime_kind = parse_runtime_kind(service, session.runtime_kind.as_str());
        let worktree_runtime_route = runtime_routes_by_worktree.get(worktree_key.as_str());
        let repo_runtime_route = fallback_runtime_kind
            .as_ref()
            .and_then(|kind| repo_runtime_routes_by_kind.get(kind));
        let runtime_kind = worktree_runtime_route
            .and_then(|_| parse_runtime_kind(service, session.runtime_kind.as_str()))
            .or(fallback_runtime_kind);
        let runtime_route = worktree_runtime_route.or(repo_runtime_route);
        let Some(runtime_route) = runtime_route else {
            continue;
        };

        let primary_target = runtime_kind
            .as_ref()
            .map(|kind| {
                service
                    .runtime_registry
                    .runtime(kind)?
                    .session_status_probe_target(runtime_route, session.working_directory.as_str())
            })
            .transpose()?
            .flatten();
        if let Some(target) = primary_target.as_ref() {
            primary_probe_targets.push(target.clone());
        }
        let fallback_target = select_fallback_probe_target(
            service,
            runtime_kind,
            worktree_runtime_route,
            repo_runtime_route,
            session.working_directory.as_str(),
        )?;

        session_plans.push(SessionProbePlan {
            worktree_key,
            role: session.role.trim().to_string(),
            external_session_id: external_session_id.to_string(),
            primary_target,
            fallback_target,
        });
    }
    Ok(session_plans)
}

pub(super) fn collect_runtime_routes_by_worktree(
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

pub(super) fn resolve_session_statuses<'a>(
    session_probe_plan: &SessionProbePlan,
    primary_statuses_by_target: &'a HashMap<
        RuntimeSessionStatusProbeTarget,
        RuntimeSessionStatusMap,
    >,
    fallback_statuses_by_target: &'a HashMap<
        RuntimeSessionStatusProbeTarget,
        RuntimeSessionStatusMap,
    >,
) -> Result<Option<&'a RuntimeSessionStatusMap>> {
    let Some(primary_target) = session_probe_plan.primary_target.as_ref() else {
        return Ok(None);
    };
    let primary_statuses = primary_statuses_by_target
        .get(primary_target)
        .ok_or_else(|| {
            anyhow!(
                "Missing cached runtime session statuses for {}",
                session_probe_plan.worktree_key
            )
        })?;
    if !primary_statuses.is_empty() {
        return Ok(Some(primary_statuses));
    }

    let Some(fallback_target) = session_probe_plan.fallback_target.as_ref() else {
        return Ok(Some(primary_statuses));
    };
    let fallback_statuses = fallback_statuses_by_target
        .get(fallback_target)
        .ok_or_else(|| {
            anyhow!(
                "Missing cached runtime session fallback statuses for {}",
                session_probe_plan.worktree_key
            )
        })?;
    if fallback_statuses.is_empty() {
        Ok(Some(primary_statuses))
    } else {
        Ok(Some(fallback_statuses))
    }
}

pub(super) fn select_fallback_probe_target(
    service: &AppService,
    runtime_kind: Option<AgentRuntimeKind>,
    worktree_runtime_route: Option<&RuntimeRoute>,
    repo_runtime_route: Option<&RuntimeRoute>,
    working_directory: &str,
) -> Result<Option<RuntimeSessionStatusProbeTarget>> {
    let Some(runtime_kind) = runtime_kind.as_ref() else {
        return Ok(None);
    };
    let (Some(primary_route), Some(fallback_route)) = (worktree_runtime_route, repo_runtime_route)
    else {
        return Ok(None);
    };
    if primary_route == fallback_route {
        return Ok(None);
    }

    service
        .runtime_registry
        .runtime(runtime_kind)?
        .session_status_probe_target(fallback_route, working_directory)
}

pub(super) fn dedupe_probe_targets(
    targets: Vec<RuntimeSessionStatusProbeTarget>,
) -> Vec<RuntimeSessionStatusProbeTarget> {
    dedupe_runtime_session_probe_targets(targets)
}

pub(super) fn parse_runtime_kind(service: &AppService, value: &str) -> Option<AgentRuntimeKind> {
    service.runtime_registry.resolve_kind(value).ok()
}

pub(super) fn collect_build_external_session_ids(
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
pub(super) struct RunProbeCandidate {
    pub(super) runtime_kind: AgentRuntimeKind,
    pub(super) runtime_route: RuntimeRoute,
    pub(super) worktree_path: String,
}

pub(super) struct RunProbePlan {
    pub(super) worktree_path: String,
    pub(super) external_session_ids: Vec<String>,
    pub(super) primary_target: Option<RuntimeSessionStatusProbeTarget>,
}

pub(super) struct SessionProbePlan {
    pub(super) worktree_key: String,
    pub(super) role: String,
    pub(super) external_session_id: String,
    pub(super) primary_target: Option<RuntimeSessionStatusProbeTarget>,
    pub(super) fallback_target: Option<RuntimeSessionStatusProbeTarget>,
}
