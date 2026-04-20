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
            if normalize_path_for_comparison(runtime.summary.repo_path.as_str()) != normalized_repo {
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
    service.runtime_registry.runtime(&runtime_kind).with_context(|| {
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

pub(super) struct SessionProbePlan {
    pub(super) worktree_key: String,
    pub(super) role: String,
    pub(super) external_session_id: String,
    pub(super) probe_target_resolution: Option<RuntimeSessionStatusProbeTargetResolution>,
}
