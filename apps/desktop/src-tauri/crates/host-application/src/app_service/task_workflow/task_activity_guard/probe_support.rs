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
        for runtime_definition in service.runtime_definitions_list()? {
            for runtime in
                service.runtime_list(runtime_definition.kind.as_str(), Some(repo_path))?
            {
                if normalize_path_for_comparison(runtime.repo_path.as_str()) != normalized_repo {
                    continue;
                }

                if runtime.role != RuntimeRole::Workspace || runtime.task_id.is_some() {
                    continue;
                }

                if routes_by_kind
                    .insert(runtime.kind.clone(), runtime.runtime_route.clone())
                    .is_some()
                {
                    return Err(anyhow!(
                        "Multiple live {} repo runtimes found for repo '{}'; cannot resolve session probe route",
                        runtime.kind.as_str(),
                        repo_path
                    ));
                }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_service::test_support::{
        build_service_with_git_state, builtin_opencode_runtime_descriptor,
        builtin_opencode_runtime_route, spawn_opencode_session_status_server, unique_temp_path,
    };
    use crate::app_service::AgentRuntimeProcess;
    use host_domain::{AgentRuntimeKind, GitCurrentBranch, RuntimeInstanceSummary, RuntimeRole};

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

    fn insert_workspace_runtime_for_kind(
        service: &AppService,
        runtime_kind: AgentRuntimeKind,
        runtime_id: &str,
        repo_path: &str,
        descriptor: host_domain::RuntimeDescriptor,
        runtime_route: host_domain::RuntimeRoute,
    ) {
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

    #[test]
    fn collect_prunes_stale_workspace_runtime_routes_before_indexing() -> Result<()> {
        let repo_path = unique_temp_path("activity-guard-runtime-prune");
        let repo_path_string = repo_path.to_string_lossy().to_string();
        let service = build_service();
        let (port, server_handle) =
            spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"busy"}}"#)?;

        let mut stale_child = std::process::Command::new("/bin/sh")
            .arg("-lc")
            .arg("exit 0")
            .spawn()
            .expect("spawn stale runtime child");
        let _ = stale_child.wait();
        let stale_summary = RuntimeInstanceSummary {
            kind: AgentRuntimeKind::opencode(),
            runtime_id: "runtime-opencode-stale".to_string(),
            repo_path: repo_path_string.clone(),
            task_id: None,
            role: RuntimeRole::Workspace,
            working_directory: repo_path_string.clone(),
            runtime_route: host_domain::RuntimeRoute::LocalHttp {
                endpoint: "http://127.0.0.1:65530".to_string(),
            },
            started_at: "2026-03-17T11:00:00Z".to_string(),
            descriptor: builtin_opencode_runtime_descriptor(),
        };
        service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .insert(
                stale_summary.runtime_id.clone(),
                AgentRuntimeProcess {
                    summary: stale_summary,
                    child: Some(stale_child),
                    _runtime_process_guard: None,
                    cleanup_target: None,
                },
            );
        insert_workspace_runtime_for_kind(
            &service,
            AgentRuntimeKind::opencode(),
            "runtime-opencode-live",
            repo_path_string.as_str(),
            builtin_opencode_runtime_descriptor(),
            builtin_opencode_runtime_route(port),
        );

        let sessions = vec![AgentSessionDocument {
            external_session_id: "external-build-session".to_string(),
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: repo_path_string.clone(),
            selected_model: None,
        }];

        let runtime_route_index =
            TaskRuntimeRouteIndex::collect(&service, repo_path_string.as_str())?;
        let (runtime_kind, runtime_route) = runtime_route_index
            .route_for_session(&service, &sessions[0])?
            .expect("live runtime route should resolve");
        assert_eq!(runtime_kind, AgentRuntimeKind::opencode());
        assert_eq!(runtime_route, builtin_opencode_runtime_route(port));

        let evidence = TaskActiveWorkEvidence {
            active_session_roles: vec!["build".to_string()],
        };
        assert!(evidence.has_any_activity());

        let guard = TaskActivityGuard::new(&service);
        let collected = guard.collect_active_task_work_evidence(
            repo_path_string.as_str(),
            &sessions,
            &["build"],
        )?;
        assert_eq!(collected.active_session_roles, vec!["build".to_string()]);
        let runtimes = service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned");
        assert!(!runtimes.contains_key("runtime-opencode-stale"));
        assert!(runtimes.contains_key("runtime-opencode-live"));
        server_handle
            .join()
            .expect("status server thread should finish");
        Ok(())
    }
}
