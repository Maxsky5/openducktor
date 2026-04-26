use super::support::*;

#[derive(Clone)]
struct HostManagedStdioRuntimeAdapter;

impl AppRuntime for HostManagedStdioRuntimeAdapter {
    fn definition(&self) -> RuntimeDefinition {
        test_runtime_definition("test-runtime", "Test Runtime")
    }

    fn startup_policy(&self, _service: &AppService) -> Result<OpencodeStartupReadinessPolicy> {
        Ok(OpencodeStartupReadinessPolicy::default())
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
        RuntimeHealth {
            kind: "test-runtime".to_string(),
            ok: true,
            version: None,
            error: None,
        }
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
            Arc::new(TestRuntimeAdapter {
                definition: builtin_opencode_runtime_definition(),
                health: RuntimeHealth {
                    kind: "opencode".to_string(),
                    ok: true,
                    version: None,
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::Default,
            }),
            Arc::new(TestRuntimeAdapter {
                definition: test_runtime_definition_with_provisioning(
                    "test-runtime",
                    "Test Runtime",
                    RuntimeProvisioningMode::External,
                ),
                health: RuntimeHealth {
                    kind: "test-runtime".to_string(),
                    ok: true,
                    version: None,
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::Default,
            }),
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
            Arc::new(TestRuntimeAdapter {
                definition: builtin_opencode_runtime_definition(),
                health: RuntimeHealth {
                    kind: "opencode".to_string(),
                    ok: true,
                    version: None,
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::Default,
            }),
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
        host_domain::RuntimeRoute::Stdio {
            identity: runtime.runtime_id.clone()
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
            Arc::new(TestRuntimeAdapter {
                definition: builtin_opencode_runtime_definition(),
                health: RuntimeHealth {
                    kind: "opencode".to_string(),
                    ok: true,
                    version: Some("1.0.0".to_string()),
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::Default,
            }),
            Arc::new(TestRuntimeAdapter {
                definition: test_runtime_definition("test-runtime", "Test Runtime"),
                health: RuntimeHealth {
                    kind: "test-runtime".to_string(),
                    ok: true,
                    version: Some("0.1.0".to_string()),
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::Default,
            }),
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
            Arc::new(TestRuntimeAdapter {
                definition: builtin_opencode_runtime_definition(),
                health: RuntimeHealth {
                    kind: "opencode".to_string(),
                    ok: true,
                    version: None,
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::Default,
            }),
            Arc::new(TestRuntimeAdapter {
                definition: test_runtime_definition("test-runtime", "Test Runtime"),
                health: RuntimeHealth {
                    kind: "test-runtime".to_string(),
                    ok: true,
                    version: None,
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::Default,
            }),
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
            Arc::new(TestRuntimeAdapter {
                definition: builtin_opencode_runtime_definition(),
                health: RuntimeHealth {
                    kind: "opencode".to_string(),
                    ok: true,
                    version: None,
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::Default,
            }),
            Arc::new(TestRuntimeAdapter {
                definition: test_runtime_definition("test-runtime", "Test Runtime"),
                health: RuntimeHealth {
                    kind: "test-runtime".to_string(),
                    ok: true,
                    version: None,
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::Default,
            }),
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
fn runs_list_consults_registered_runtime_delegate_for_stdio_probe_paths() -> Result<()> {
    let runtime_registry = AppRuntimeRegistry::new(
        vec![
            Arc::new(TestRuntimeAdapter {
                definition: builtin_opencode_runtime_definition(),
                health: RuntimeHealth {
                    kind: "opencode".to_string(),
                    ok: true,
                    version: None,
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::Default,
            }),
            Arc::new(TestRuntimeAdapter {
                definition: test_runtime_definition("test-runtime", "Test Runtime"),
                health: RuntimeHealth {
                    kind: "test-runtime".to_string(),
                    ok: true,
                    version: None,
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::ReturnError(
                    "custom runtime probe hook invoked",
                ),
            }),
        ],
        AgentRuntimeKind::opencode(),
    )?;
    let (service, task_state, _git_state) = build_service_with_runtime_registry(
        vec![make_task("task-1", "task", TaskStatus::InProgress)],
        runtime_registry,
    );
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "test-runtime".to_string(),
        working_directory: "/tmp/repo/worktree".to_string(),
        selected_model: None,
    }];
    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-1".to_string(),
            crate::app_service::RunProcess {
                summary: host_domain::RunSummary {
                    run_id: "run-1".to_string(),
                    runtime_kind: AgentRuntimeKind::from("test-runtime"),
                    runtime_route: host_domain::RuntimeRoute::stdio("run-stdio")?,
                    repo_path: "/tmp/repo".to_string(),
                    task_id: "task-1".to_string(),
                    branch: "odt/task-1".to_string(),
                    worktree_path: "/tmp/repo/worktree".to_string(),
                    port: None,
                    state: host_domain::RunState::Running,
                    last_message: None,
                    started_at: "2026-03-17T11:00:00Z".to_string(),
                },
                child: None,
                _runtime_process_guard: None,
                repo_path: "/tmp/repo".to_string(),
                task_id: "task-1".to_string(),
                worktree_path: "/tmp/repo/worktree".to_string(),
                repo_config: host_infra_system::RepoConfig::default(),
            },
        );

    let error = service
        .runs_list(Some("/tmp/repo"))
        .expect_err("custom runtime probe hook should be consulted for stdio runs");
    assert!(error
        .to_string()
        .contains("custom runtime probe hook invoked"));

    Ok(())
}

#[test]
fn task_delete_blocks_custom_runtime_sessions_via_service_runtime_registry() -> Result<()> {
    let repo_path = unique_temp_path("task-delete-custom-runtime-session");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let runtime_registry = AppRuntimeRegistry::new(
        vec![
            Arc::new(TestRuntimeAdapter {
                definition: builtin_opencode_runtime_definition(),
                health: RuntimeHealth {
                    kind: "opencode".to_string(),
                    ok: true,
                    version: None,
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::Default,
            }),
            Arc::new(TestRuntimeAdapter {
                definition: test_runtime_definition("test-runtime", "Test Runtime"),
                health: RuntimeHealth {
                    kind: "test-runtime".to_string(),
                    ok: true,
                    version: None,
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::ReturnUnsupported,
            }),
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
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "test-runtime".to_string(),
        working_directory: repo_path_string.clone(),
        selected_model: None,
    }];
    insert_task_runtime_for_kind_role(
        &service,
        AgentRuntimeKind::from("test-runtime"),
        "task-1",
        RuntimeRole::Build,
        repo_path_string.as_str(),
        repo_path_string.as_str(),
        host_domain::RuntimeRoute::stdio("task-runtime-build-block")?,
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
fn task_delete_uses_task_runtime_route_for_matching_runtime_kind_and_worktree() -> Result<()> {
    let repo_path = unique_temp_path("task-delete-mixed-runtime-route-selection");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let runtime_registry = AppRuntimeRegistry::new(
        vec![
            Arc::new(TestRuntimeAdapter {
                definition: builtin_opencode_runtime_definition(),
                health: RuntimeHealth {
                    kind: "opencode".to_string(),
                    ok: true,
                    version: None,
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::Default,
            }),
            Arc::new(TestRuntimeAdapter {
                definition: test_runtime_definition("test-runtime", "Test Runtime"),
                health: RuntimeHealth {
                    kind: "test-runtime".to_string(),
                    ok: true,
                    version: None,
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::Default,
            }),
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
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "test-runtime".to_string(),
        working_directory: repo_path_string.clone(),
        selected_model: None,
    }];
    insert_workspace_runtime(&service, repo_path_string.as_str(), 43123)?;
    insert_task_runtime_for_kind_role(
        &service,
        AgentRuntimeKind::from("test-runtime"),
        "task-1",
        RuntimeRole::Build,
        repo_path_string.as_str(),
        repo_path_string.as_str(),
        host_domain::RuntimeRoute::stdio("task-runtime-build-match")?,
    )?;

    let error = service
        .task_delete(repo_path_string.as_str(), "task-1", false)
        .expect_err("matching task runtime should block delete conservatively");
    assert!(error
        .to_string()
        .contains("Cannot delete tasks with active builder work in progress"));

    Ok(())
}

#[test]
fn task_delete_uses_task_runtime_route_for_non_build_roles_sharing_a_worktree() -> Result<()> {
    let repo_path = unique_temp_path("task-delete-mixed-runtime-qa-route-selection");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let runtime_registry = AppRuntimeRegistry::new(
        vec![
            Arc::new(TestRuntimeAdapter {
                definition: builtin_opencode_runtime_definition(),
                health: RuntimeHealth {
                    kind: "opencode".to_string(),
                    ok: true,
                    version: None,
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::Default,
            }),
            Arc::new(TestRuntimeAdapter {
                definition: test_runtime_definition("test-runtime", "Test Runtime"),
                health: RuntimeHealth {
                    kind: "test-runtime".to_string(),
                    ok: true,
                    version: None,
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::Default,
            }),
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
        session_id: "qa-session".to_string(),
        external_session_id: Some("external-qa-session".to_string()),
        role: "qa".to_string(),
        scenario: "qa_review".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "test-runtime".to_string(),
        working_directory: repo_path_string.clone(),
        selected_model: None,
    }];
    insert_workspace_runtime(&service, repo_path_string.as_str(), 43123)?;
    insert_task_runtime_for_kind_role(
        &service,
        AgentRuntimeKind::from("test-runtime"),
        "task-1",
        RuntimeRole::Qa,
        repo_path_string.as_str(),
        repo_path_string.as_str(),
        host_domain::RuntimeRoute::stdio("task-runtime-qa-match")?,
    )?;

    let error = service
        .task_delete(repo_path_string.as_str(), "task-1", false)
        .expect_err("matching task runtime should block QA delete conservatively");
    assert!(error
        .to_string()
        .contains("Cannot delete tasks with active QA work in progress"));

    Ok(())
}

#[test]
fn runs_list_hides_runs_when_runtime_probe_returns_actionable_failure() -> Result<()> {
    let runtime_registry = AppRuntimeRegistry::new(
        vec![
            Arc::new(TestRuntimeAdapter {
                definition: builtin_opencode_runtime_definition(),
                health: RuntimeHealth {
                    kind: "opencode".to_string(),
                    ok: true,
                    version: None,
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::Default,
            }),
            Arc::new(TestRuntimeAdapter {
                definition: test_runtime_definition("test-runtime", "Test Runtime"),
                health: RuntimeHealth {
                    kind: "test-runtime".to_string(),
                    ok: true,
                    version: None,
                    error: None,
                },
                session_probe_behavior: SessionProbeBehavior::ProbeFailure(
                    "probe failed for test runtime",
                ),
            }),
        ],
        AgentRuntimeKind::opencode(),
    )?;
    let (service, task_state, _git_state) = build_service_with_runtime_registry(
        vec![make_task("task-1", "task", TaskStatus::InProgress)],
        runtime_registry,
    );
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "test-runtime".to_string(),
        working_directory: "/tmp/repo/worktree".to_string(),
        selected_model: None,
    }];
    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-1".to_string(),
            crate::app_service::RunProcess {
                summary: host_domain::RunSummary {
                    run_id: "run-1".to_string(),
                    runtime_kind: AgentRuntimeKind::from("test-runtime"),
                    runtime_route: host_domain::RuntimeRoute::LocalHttp {
                        endpoint: "http://127.0.0.1:43123".to_string(),
                    },
                    repo_path: "/tmp/repo".to_string(),
                    task_id: "task-1".to_string(),
                    branch: "odt/task-1".to_string(),
                    worktree_path: "/tmp/repo/worktree".to_string(),
                    port: Some(43_123),
                    state: host_domain::RunState::Running,
                    last_message: None,
                    started_at: "2026-03-17T11:00:00Z".to_string(),
                },
                child: None,
                _runtime_process_guard: None,
                repo_path: "/tmp/repo".to_string(),
                task_id: "task-1".to_string(),
                worktree_path: "/tmp/repo/worktree".to_string(),
                repo_config: host_infra_system::RepoConfig::default(),
            },
        );

    let runs = service.runs_list(Some("/tmp/repo"))?;

    assert!(runs.is_empty());
    Ok(())
}
