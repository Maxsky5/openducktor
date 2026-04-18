use super::*;
use host_domain::AgentRuntimeKind;

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
    pub(super) probe_targets: Vec<RuntimeSessionStatusProbeTarget>,
}

pub(super) fn build_run_probe_plans(
    service: &AppService,
    candidate_runs: &[RunProbeCandidate],
    sessions: &[AgentSessionDocument],
    probe_targets: &mut Vec<RuntimeSessionStatusProbeTarget>,
) -> Result<Vec<RunProbePlan>> {
    let mut run_plans = Vec::with_capacity(candidate_runs.len());
    for run_candidate in candidate_runs {
        let external_session_ids = collect_build_external_session_ids(run_candidate, sessions);
        let probe_target_resolution = if external_session_ids.is_empty() {
            None
        } else {
            let resolution = service
                .runtime_registry
                .runtime(&run_candidate.runtime_kind)?
                .session_status_probe_target(
                    &run_candidate.runtime_route,
                    run_candidate.worktree_path.as_str(),
                )?;
            if let RuntimeSessionStatusProbeTargetResolution::Target(target) = &resolution {
                probe_targets.push(target.clone());
            }
            Some(resolution)
        };
        run_plans.push(RunProbePlan {
            worktree_path: run_candidate.worktree_path.clone(),
            external_session_ids,
            probe_target_resolution,
        });
    }
    Ok(run_plans)
}

pub(super) fn build_session_probe_plans(
    service: &AppService,
    sessions: &[AgentSessionDocument],
    session_roles: &[&str],
    runtime_routes_by_worktree: &HashMap<String, RuntimeRoute>,
    probe_targets: &mut Vec<RuntimeSessionStatusProbeTarget>,
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
        let probe_target_resolution = match (
            parse_runtime_kind(service, session.runtime_kind.as_str()),
            runtime_routes_by_worktree.get(worktree_key.as_str()),
        ) {
            (Some(runtime_kind), Some(runtime_route)) => Some(
                service
                    .runtime_registry
                    .runtime(&runtime_kind)?
                    .session_status_probe_target(
                        runtime_route,
                        session.working_directory.as_str(),
                    )?,
            ),
            _ => None,
        };
        if let Some(RuntimeSessionStatusProbeTargetResolution::Target(target)) =
            &probe_target_resolution
        {
            probe_targets.push(target.clone());
        }

        session_plans.push(SessionProbePlan {
            worktree_key,
            role: session.role.trim().to_string(),
            external_session_id: external_session_id.to_string(),
            probe_target_resolution,
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
    pub(super) probe_target_resolution: Option<RuntimeSessionStatusProbeTargetResolution>,
}

pub(super) struct SessionProbePlan {
    pub(super) worktree_key: String,
    pub(super) role: String,
    pub(super) external_session_id: String,
    pub(super) probe_target_resolution: Option<RuntimeSessionStatusProbeTargetResolution>,
}
