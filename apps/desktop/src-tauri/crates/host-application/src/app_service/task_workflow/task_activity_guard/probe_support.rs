use super::*;
use host_domain::{AgentRuntimeKind, RuntimeRole, RuntimeRoute};

#[derive(Default)]
pub(super) struct TaskActiveWorkEvidence {
    pub(super) active_session_roles: Vec<String>,
}

impl TaskActiveWorkEvidence {
    pub(super) fn has_any_activity(&self) -> bool {
        !self.active_session_roles.is_empty()
    }

    pub(super) fn delete_blocker_summary(&self) -> String {
        self.active_session_roles
            .iter()
            .map(|role| format!("{role} session"))
            .collect::<Vec<_>>()
            .join(", ")
    }
}

pub(super) struct TaskActivityProbePlan {
    pub(super) session_plans: Vec<SessionProbePlan>,
    pub(super) probe_targets: Vec<RuntimeSessionStatusProbeTarget>,
}

pub(super) struct TaskRuntimeRouteIndex {
    routes_by_kind: HashMap<AgentRuntimeKind, RuntimeRoute>,
}

impl TaskRuntimeRouteIndex {
    pub(super) fn collect(service: &AppService, repo_path: &str) -> Result<Self> {
        let normalized_repo = normalize_path_for_comparison(repo_path);
        let mut routes_by_kind = HashMap::new();
        let runtimes = service
            .agent_runtimes
            .lock()
            .map_err(|_| anyhow!("Agent runtime state lock poisoned"))?;

        for runtime in runtimes.values() {
            if normalize_path_for_comparison(runtime.summary.repo_path.as_str()) != normalized_repo
            {
                continue;
            }

            if runtime.summary.role != RuntimeRole::Workspace || runtime.summary.task_id.is_some() {
                continue;
            }

            if routes_by_kind
                .insert(
                    runtime.summary.kind.clone(),
                    runtime.summary.runtime_route.clone(),
                )
                .is_some()
            {
                return Err(anyhow!(
                    "Multiple live {} repo runtimes found for repo '{}'; cannot resolve session probe route",
                    runtime.summary.kind.as_str(),
                    repo_path
                ));
            }
        }

        Ok(Self { routes_by_kind })
    }

    fn route_for_session(
        &self,
        service: &AppService,
        session: &AgentSessionDocument,
    ) -> Result<Option<(AgentRuntimeKind, RuntimeRoute)>> {
        let runtime_kind = parse_runtime_kind_from_session(service, session)?;
        let Some(runtime_route) = self.routes_by_kind.get(&runtime_kind) else {
            return Ok(None);
        };

        Ok(Some((runtime_kind, runtime_route.clone())))
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
        let external_session_id = session.external_session_id.trim();
        if external_session_id.is_empty() {
            continue;
        }

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
            session.external_session_id
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
                session.external_session_id,
                session.runtime_kind.trim()
            )
        })?;

    Ok(runtime_kind)
}

pub(super) struct SessionProbePlan {
    pub(super) worktree_key: String,
    pub(super) role: String,
    pub(super) external_session_id: String,
    pub(super) probe_target_resolution: Option<RuntimeSessionStatusProbeTargetResolution>,
}
