use super::*;
use host_domain::{AgentRuntimeKind, RuntimeRole, RuntimeRoute};

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

pub(super) struct TaskRuntimeRouteIndex {
    task_routes: HashMap<SessionRuntimeLookupKey, RuntimeRoute>,
    shared_routes: HashMap<SharedRuntimeLookupKey, RuntimeRoute>,
}

impl TaskRuntimeRouteIndex {
    pub(super) fn collect(service: &AppService, repo_path: &str, task_id: &str) -> Result<Self> {
        let normalized_repo = normalize_path_for_comparison(repo_path);
        let mut task_routes = HashMap::new();
        let mut shared_routes = HashMap::new();
        let runtimes = service
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;

        for runtime in runtimes.values() {
            if normalize_path_for_comparison(runtime.summary.repo_path.as_str()) != normalized_repo
            {
                continue;
            }

            if runtime.summary.role == RuntimeRole::Workspace {
                if runtime.summary.task_id.is_none() {
                    shared_routes.insert(
                        SharedRuntimeLookupKey::new(
                            runtime.summary.kind.clone(),
                            runtime.summary.working_directory.as_str(),
                        ),
                        runtime.summary.runtime_route.clone(),
                    );
                }
                continue;
            }

            if runtime.summary.task_id.as_deref() != Some(task_id) {
                continue;
            }

            let key = SessionRuntimeLookupKey::new(
                runtime.summary.kind.clone(),
                runtime.summary.role,
                runtime.summary.working_directory.as_str(),
            );

            task_routes.insert(key, runtime.summary.runtime_route.clone());
        }

        Ok(Self {
            task_routes,
            shared_routes,
        })
    }

    fn route_for_session(
        &self,
        service: &AppService,
        session: &AgentSessionDocument,
    ) -> Result<Option<(AgentRuntimeKind, RuntimeRoute)>> {
        let runtime_kind = parse_runtime_kind_from_session(service, session)?;
        let Some(runtime_role) = parse_runtime_role(session.role.as_str()) else {
            return Ok(None);
        };
        let Some(runtime_route) = self.route_for_role(
            &runtime_kind,
            runtime_role,
            session.working_directory.as_str(),
        ) else {
            return Ok(None);
        };
        Ok(Some((runtime_kind, runtime_route)))
    }

    fn route_for_role(
        &self,
        runtime_kind: &AgentRuntimeKind,
        runtime_role: RuntimeRole,
        working_directory: &str,
    ) -> Option<RuntimeRoute> {
        self.task_routes
            .get(&SessionRuntimeLookupKey::new(
                runtime_kind.clone(),
                runtime_role,
                working_directory,
            ))
            .cloned()
            .or_else(|| {
                self.shared_routes
                    .get(&SharedRuntimeLookupKey::new(
                        runtime_kind.clone(),
                        working_directory,
                    ))
                    .cloned()
            })
    }

    pub(super) fn probe_target_resolution_for_session(
        &self,
        service: &AppService,
        session: &AgentSessionDocument,
    ) -> Result<Option<RuntimeSessionStatusProbeTargetResolution>> {
        let Some((runtime_kind, runtime_route)) = self.route_for_session(service, session)? else {
            return Ok(None);
        };

        Ok(Some(
            service
                .runtime_registry
                .runtime(&runtime_kind)?
                .session_status_probe_target(&runtime_route, session.working_directory.as_str())?,
        ))
    }

    pub(super) fn probe_target_resolution_for_run(
        &self,
        service: &AppService,
        run_candidate: &RunProbeCandidate,
        runtime_role: RuntimeRole,
    ) -> Result<RuntimeSessionStatusProbeTargetResolution> {
        let runtime_route = self
            .route_for_role(
                &run_candidate.runtime_kind,
                runtime_role,
                run_candidate.worktree_path.as_str(),
            )
            .unwrap_or_else(|| run_candidate.runtime_route.clone());

        service
            .runtime_registry
            .runtime(&run_candidate.runtime_kind)?
            .session_status_probe_target(&runtime_route, run_candidate.worktree_path.as_str())
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct SharedRuntimeLookupKey {
    runtime_kind: AgentRuntimeKind,
    working_directory_key: String,
}

impl SharedRuntimeLookupKey {
    fn new(runtime_kind: AgentRuntimeKind, working_directory: &str) -> Self {
        Self {
            runtime_kind,
            working_directory_key: normalize_path_key(working_directory),
        }
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub(super) struct SessionRuntimeLookupKey {
    runtime_kind: AgentRuntimeKind,
    role: RuntimeRole,
    working_directory_key: String,
}

impl SessionRuntimeLookupKey {
    pub(super) fn new(
        runtime_kind: AgentRuntimeKind,
        role: RuntimeRole,
        working_directory: &str,
    ) -> Self {
        Self {
            runtime_kind,
            role,
            working_directory_key: normalize_path_key(working_directory),
        }
    }
}

pub(super) fn build_run_probe_plans(
    service: &AppService,
    candidate_runs: &[RunProbeCandidate],
    sessions: &[AgentSessionDocument],
    runtime_route_index: &TaskRuntimeRouteIndex,
    probe_targets: &mut Vec<RuntimeSessionStatusProbeTarget>,
) -> Result<Vec<RunProbePlan>> {
    let mut run_plans = Vec::with_capacity(candidate_runs.len());
    for run_candidate in candidate_runs {
        let external_session_ids = collect_build_external_session_ids(run_candidate, sessions);
        let probe_target_resolution = if external_session_ids.is_empty() {
            None
        } else {
            let resolution = runtime_route_index.probe_target_resolution_for_run(
                service,
                run_candidate,
                RuntimeRole::Build,
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
    runtime_route_index: &TaskRuntimeRouteIndex,
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
        let probe_target_resolution =
            runtime_route_index.probe_target_resolution_for_session(service, session)?;
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

fn parse_runtime_kind_from_session(
    service: &AppService,
    session: &AgentSessionDocument,
) -> Result<AgentRuntimeKind> {
    let runtime_kind = session.runtime_kind.trim();
    if runtime_kind.is_empty() {
        return Err(anyhow!(
            "Persisted {} session '{}' is missing runtime kind metadata",
            session.role.trim(),
            session.session_id
        ));
    }

    let runtime_kind = AgentRuntimeKind::from(runtime_kind);
    service
        .runtime_registry
        .runtime(&runtime_kind)
        .with_context(|| {
            format!(
                "Persisted {} session '{}' references unsupported runtime kind '{}'",
                session.role.trim(),
                session.session_id,
                session.runtime_kind.trim()
            )
        })?;

    Ok(runtime_kind)
}

pub(super) fn parse_runtime_role(value: &str) -> Option<RuntimeRole> {
    match value.trim() {
        "spec" => Some(RuntimeRole::Spec),
        "planner" => Some(RuntimeRole::Planner),
        "build" => Some(RuntimeRole::Build),
        "qa" => Some(RuntimeRole::Qa),
        _ => None,
    }
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
