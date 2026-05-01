use super::support::*;

#[derive(Clone)]
struct HostManagedStdioRuntimeAdapter;

impl AppRuntime for HostManagedStdioRuntimeAdapter {
    fn definition(&self) -> RuntimeDefinition {
        test_runtime_definition("test-runtime", "Test Runtime")
    }

    fn kind(&self) -> AgentRuntimeKind {
        AgentRuntimeKind::from("test-runtime")
    }

    fn start_host_managed(
        &self,
        _service: &AppService,
        _input: &crate::app_service::runtime_orchestrator::RuntimeStartInput<'_>,
        runtime_id: &str,
        _startup_policy: crate::app_service::RuntimeStartupReadinessPolicy,
    ) -> Result<HostManagedRuntimeStart> {
        Ok(HostManagedRuntimeStart {
            child: spawn_sleep_process(30),
            runtime_process_guard: RuntimeProcessGuard::new(()),
            runtime_route: host_domain::RuntimeRoute::stdio(runtime_id)?,
            startup_report: crate::app_service::RuntimeStartupWaitReport::zero(),
        })
    }

    fn runtime_health(&self) -> RuntimeHealth {
        runtime_health_ok("test-runtime")
    }

    fn stop_session(
        &self,
        _runtime_route: &host_domain::RuntimeRoute,
        _external_session_id: &str,
        _working_directory: &str,
    ) -> Result<()> {
        Err(anyhow::anyhow!(
            "stop_session should not be used in this test"
        ))
    }
}

#[test]
fn runtime_ensure_registers_external_runtimes_without_local_child_processes() -> Result<()> {
    let repo_path = unique_temp_path("external-runtime");
    fs::create_dir_all(repo_path.join(".git"))?;
    let runtime_registry = AppRuntimeRegistry::new(
        vec![
            Arc::new(TestRuntimeAdapter::opencode()),
            Arc::new(TestRuntimeAdapter::for_kind_with_provisioning(
                "test-runtime",
                "Test Runtime",
                RuntimeProvisioningMode::External,
            )),
        ],
        AgentRuntimeKind::opencode(),
    )?;
    let (service, _task_state, _git_state) =
        build_service_with_runtime_registry(vec![], runtime_registry);
    service.workspace_add(repo_path.to_string_lossy().as_ref())?;

    let runtime = service.runtime_ensure("test-runtime", repo_path.to_string_lossy().as_ref())?;

    assert_eq!(runtime.kind, AgentRuntimeKind::from("test-runtime"));
    assert_eq!(
        runtime.runtime_route,
        host_domain::RuntimeRoute::LocalHttp {
            endpoint: "http://127.0.0.1:43123".to_string(),
        }
    );
    assert_eq!(
        service
            .runtime_list("test-runtime", Some(repo_path.to_string_lossy().as_ref()))?
            .len(),
        1
    );
    let runtimes = service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned");
    let registered = runtimes
        .get(runtime.runtime_id.as_str())
        .expect("external runtime should be registered");
    assert!(registered.child.is_none());

    Ok(())
}

#[test]
fn runtime_ensure_registers_host_managed_stdio_routes_without_reconstructing_ports() -> Result<()> {
    let repo_path = unique_temp_path("host-managed-stdio-runtime");
    fs::create_dir_all(repo_path.join(".git"))?;

    let runtime_registry = AppRuntimeRegistry::new(
        vec![
            Arc::new(TestRuntimeAdapter::opencode()),
            Arc::new(HostManagedStdioRuntimeAdapter),
        ],
        AgentRuntimeKind::opencode(),
    )?;
    let (service, _task_state, _git_state) =
        build_service_with_runtime_registry(vec![], runtime_registry);
    service.workspace_add(repo_path.to_string_lossy().as_ref())?;

    let runtime = service.runtime_ensure("test-runtime", repo_path.to_string_lossy().as_ref())?;

    assert_eq!(runtime.kind, AgentRuntimeKind::from("test-runtime"));
    assert_eq!(
        runtime.runtime_route,
        host_domain::RuntimeRoute::stdio(runtime.runtime_id.clone())?
    );
    assert_eq!(
        service
            .runtime_list("test-runtime", Some(repo_path.to_string_lossy().as_ref()))?
            .len(),
        1
    );

    let runtimes = service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned");
    let registered = runtimes
        .get(runtime.runtime_id.as_str())
        .expect("host-managed runtime should be registered");
    assert_eq!(registered.summary.runtime_route, runtime.runtime_route);
    assert!(registered.child.is_some());
    drop(runtimes);

    assert!(service.runtime_stop(runtime.runtime_id.as_str())?);

    Ok(())
}

#[test]
fn runtime_check_lists_all_registered_runtimes_from_the_registry() -> Result<()> {
    let runtime_registry = AppRuntimeRegistry::new(
        vec![
            Arc::new(TestRuntimeAdapter::opencode().with_health_version("1.0.0")),
            Arc::new(
                TestRuntimeAdapter::for_kind("test-runtime", "Test Runtime")
                    .with_health_version("0.1.0"),
            ),
        ],
        AgentRuntimeKind::opencode(),
    )?;
    let (service, _task_state, _git_state) =
        build_service_with_runtime_registry(vec![], runtime_registry);

    let runtime_check = service.runtime_check()?;
    let runtime_kinds = runtime_check
        .runtimes
        .iter()
        .map(|entry| entry.kind.as_str())
        .collect::<Vec<_>>();

    assert_eq!(runtime_kinds, vec!["opencode", "test-runtime"]);
    assert!(runtime_check.errors.is_empty());

    Ok(())
}

#[test]
fn runtime_definitions_list_uses_registered_runtime_definitions() -> Result<()> {
    let runtime_registry = AppRuntimeRegistry::new(
        vec![
            Arc::new(TestRuntimeAdapter::opencode()),
            Arc::new(TestRuntimeAdapter::for_kind("test-runtime", "Test Runtime")),
        ],
        AgentRuntimeKind::opencode(),
    )?;
    let (service, _task_state, _git_state) =
        build_service_with_runtime_registry(vec![], runtime_registry);

    let definitions = service.runtime_definitions_list()?;
    let runtime_kinds = definitions
        .iter()
        .map(|definition| definition.kind.as_str())
        .collect::<Vec<_>>();

    assert_eq!(runtime_kinds, vec!["opencode", "test-runtime"]);
    Ok(())
}

#[test]
fn injected_runtime_registry_drives_runtime_config_defaults() -> Result<()> {
    let runtime_registry = AppRuntimeRegistry::new(
        vec![
            Arc::new(TestRuntimeAdapter::opencode()),
            Arc::new(TestRuntimeAdapter::for_kind("test-runtime", "Test Runtime")),
        ],
        AgentRuntimeKind::opencode(),
    )?;
    let (service, _task_state, _git_state) =
        build_service_with_runtime_registry(vec![], runtime_registry);

    let runtime_config = service.runtime_config_store.load()?;

    assert!(runtime_config.runtimes.contains_key("opencode"));
    assert!(runtime_config.runtimes.contains_key("test-runtime"));
    Ok(())
}

#[test]
fn runtime_apis_fail_fast_for_unsupported_runtime_kinds() {
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    for error in [
        service.runtime_list("missing-runtime", None).unwrap_err(),
        service
            .runtime_ensure("missing-runtime", "/tmp/repo")
            .unwrap_err(),
        service
            .runtime_startup_status("missing-runtime", "/tmp/repo")
            .unwrap_err(),
        service
            .repo_runtime_health("missing-runtime", "/tmp/repo")
            .unwrap_err(),
    ] {
        assert_eq!(
            error.to_string(),
            "Unsupported agent runtime kind: missing-runtime"
        );
    }
}

#[test]
fn task_delete_blocks_custom_runtime_sessions_via_service_runtime_registry() -> Result<()> {
    let repo_path = unique_temp_path("task-delete-custom-runtime-session");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let runtime_registry = AppRuntimeRegistry::new(
        vec![
            Arc::new(TestRuntimeAdapter::opencode()),
            Arc::new(
                TestRuntimeAdapter::for_kind("test-runtime", "Test Runtime")
                    .with_session_probe_behavior(SessionProbeBehavior::ReturnUnsupported),
            ),
        ],
        AgentRuntimeKind::opencode(),
    )?;
    let (service, task_state, _git_state) = build_service_with_runtime_registry(
        vec![make_task("task-1", "task", TaskStatus::InProgress)],
        runtime_registry,
    );
    let repo_path_string = repo_path.to_string_lossy().to_string();
    let workspace = service.workspace_add(repo_path_string.as_str())?;
    service.workspace_update_repo_config(
        workspace.workspace_id.as_str(),
        repo_config_for_workspace(
            &workspace,
            host_infra_system::RepoConfig {
                branch_prefix: "odt".to_string(),
                default_runtime_kind: "test-runtime".to_string(),
                ..Default::default()
            },
        ),
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        external_session_id: "external-build-session".to_string(),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "test-runtime".to_string(),
        working_directory: repo_path_string.clone(),
        selected_model: None,
    }];
    insert_workspace_runtime_for_kind(
        &service,
        AgentRuntimeKind::from("test-runtime"),
        repo_path_string.as_str(),
        test_runtime_definition("test-runtime", "Test Runtime")
            .descriptor()
            .clone(),
        host_domain::RuntimeRoute::stdio("workspace-runtime-build-block")?,
    )?;

    let error = service
        .task_delete(repo_path_string.as_str(), "task-1", false)
        .expect_err("custom runtime session should block delete");
    assert!(error
        .to_string()
        .contains("Cannot delete tasks with active builder work in progress"));

    Ok(())
}

#[test]
fn task_delete_resolves_custom_runtime_by_repo_and_kind_for_task_worktree_session_cwd() -> Result<()>
{
    let repo_path = unique_temp_path("task-delete-mixed-runtime-route-selection");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let task_worktree = repo_path.join("worktrees").join("task-1");
    fs::create_dir_all(&task_worktree)?;

    let runtime_registry = AppRuntimeRegistry::new(
        vec![
            Arc::new(TestRuntimeAdapter::opencode()),
            Arc::new(TestRuntimeAdapter::for_kind("test-runtime", "Test Runtime")),
        ],
        AgentRuntimeKind::opencode(),
    )?;
    let (service, task_state, _git_state) = build_service_with_runtime_registry(
        vec![make_task("task-1", "task", TaskStatus::InProgress)],
        runtime_registry,
    );
    let repo_path_string = repo_path.to_string_lossy().to_string();
    let task_worktree_string = task_worktree.to_string_lossy().to_string();
    let workspace = service.workspace_add(repo_path_string.as_str())?;
    service.workspace_update_repo_config(
        workspace.workspace_id.as_str(),
        repo_config_for_workspace(
            &workspace,
            host_infra_system::RepoConfig {
                branch_prefix: "odt".to_string(),
                default_runtime_kind: "test-runtime".to_string(),
                ..Default::default()
            },
        ),
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        external_session_id: "external-build-session".to_string(),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "test-runtime".to_string(),
        working_directory: task_worktree_string.clone(),
        selected_model: None,
    }];
    insert_workspace_runtime(&service, repo_path_string.as_str(), 43123)?;
    insert_workspace_runtime_for_kind(
        &service,
        AgentRuntimeKind::from("test-runtime"),
        repo_path_string.as_str(),
        test_runtime_definition("test-runtime", "Test Runtime")
            .descriptor()
            .clone(),
        host_domain::RuntimeRoute::stdio("workspace-runtime-build-match")?,
    )?;

    let error = service
        .task_delete(repo_path_string.as_str(), "task-1", false)
        .expect_err("matching workspace runtime should block delete conservatively");
    assert!(error
        .to_string()
        .contains("Cannot delete tasks with active builder work in progress"));
    let runtimes = service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned");
    let matching_runtimes = runtimes
        .values()
        .filter(|runtime| runtime.summary.kind == AgentRuntimeKind::from("test-runtime"))
        .collect::<Vec<_>>();
    assert_eq!(
        matching_runtimes.len(),
        1,
        "expected exactly one repo-scoped test-runtime instance"
    );
    let custom_runtime = matching_runtimes[0];
    assert_eq!(custom_runtime.summary.task_id, None);
    assert_eq!(custom_runtime.summary.role, RuntimeRole::Workspace);
    assert_eq!(custom_runtime.summary.working_directory, repo_path_string);
    assert_ne!(
        custom_runtime.summary.working_directory,
        task_worktree_string
    );

    Ok(())
}

#[test]
fn task_delete_resolves_custom_runtime_by_repo_and_kind_for_qa_worktree_session_cwd() -> Result<()>
{
    let repo_path = unique_temp_path("task-delete-mixed-runtime-qa-route-selection");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let qa_worktree = repo_path.join("worktrees").join("task-1-qa");
    fs::create_dir_all(&qa_worktree)?;

    let runtime_registry = AppRuntimeRegistry::new(
        vec![
            Arc::new(TestRuntimeAdapter::opencode()),
            Arc::new(TestRuntimeAdapter::for_kind("test-runtime", "Test Runtime")),
        ],
        AgentRuntimeKind::opencode(),
    )?;
    let (service, task_state, _git_state) = build_service_with_runtime_registry(
        vec![make_task("task-1", "task", TaskStatus::InProgress)],
        runtime_registry,
    );
    let repo_path_string = repo_path.to_string_lossy().to_string();
    let qa_worktree_string = qa_worktree.to_string_lossy().to_string();
    let workspace = service.workspace_add(repo_path_string.as_str())?;
    service.workspace_update_repo_config(
        workspace.workspace_id.as_str(),
        repo_config_for_workspace(
            &workspace,
            host_infra_system::RepoConfig {
                branch_prefix: "odt".to_string(),
                default_runtime_kind: "test-runtime".to_string(),
                ..Default::default()
            },
        ),
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        external_session_id: "external-qa-session".to_string(),
        role: "qa".to_string(),
        scenario: "qa_review".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "test-runtime".to_string(),
        working_directory: qa_worktree_string.clone(),
        selected_model: None,
    }];
    insert_workspace_runtime(&service, repo_path_string.as_str(), 43123)?;
    insert_workspace_runtime_for_kind(
        &service,
        AgentRuntimeKind::from("test-runtime"),
        repo_path_string.as_str(),
        test_runtime_definition("test-runtime", "Test Runtime")
            .descriptor()
            .clone(),
        host_domain::RuntimeRoute::stdio("workspace-runtime-qa-match")?,
    )?;

    let error = service
        .task_delete(repo_path_string.as_str(), "task-1", false)
        .expect_err("matching workspace runtime should block QA delete conservatively");
    assert!(error
        .to_string()
        .contains("Cannot delete tasks with active QA work in progress"));
    let runtimes = service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned");
    let matching_runtimes = runtimes
        .values()
        .filter(|runtime| runtime.summary.kind == AgentRuntimeKind::from("test-runtime"))
        .collect::<Vec<_>>();
    assert_eq!(
        matching_runtimes.len(),
        1,
        "expected exactly one repo-scoped test-runtime instance"
    );
    let custom_runtime = matching_runtimes[0];
    assert_eq!(custom_runtime.summary.task_id, None);
    assert_eq!(custom_runtime.summary.role, RuntimeRole::Workspace);
    assert_eq!(custom_runtime.summary.working_directory, repo_path_string);
    assert_ne!(custom_runtime.summary.working_directory, qa_worktree_string);

    Ok(())
}
