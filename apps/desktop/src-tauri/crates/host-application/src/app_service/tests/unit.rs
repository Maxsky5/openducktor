use anyhow::{Context, Result};
use host_domain::{
    AgentRuntimeKind, AgentSessionDocument, CreateTaskInput, GitBranch, IssueType,
    PlanSubtaskInput, PullRequestRecord, QaWorkflowVerdict, RuntimeInstanceSummary, RuntimeRole,
    SystemOpenInToolId, SystemOpenInToolInfo, TaskAction, TaskCard, TaskStatus, TaskStore,
    UpdateTaskPatch,
};
use host_infra_system::{
    AppConfigStore, OpencodeStartupReadinessConfig, RuntimeConfig, RuntimeConfigStore,
};
use serde_json::json;
use std::collections::BTreeMap;
use std::fs;
use std::net::{TcpListener, TcpStream};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::app_service::runtime_registry::{AppRuntime, AppRuntimeRegistry, ExternalRuntimeStart};
use crate::app_service::test_support::{
    build_service_with_git_state, build_service_with_runtime_registry,
    builtin_opencode_runtime_definition, builtin_opencode_runtime_descriptor,
    builtin_opencode_runtime_route, make_task, spawn_opencode_session_status_server,
    spawn_sleep_process, spawn_sleep_process_group, unique_temp_path, wait_for_process_exit,
    write_private_file, FakeTaskStore, TaskStoreState,
};
use crate::app_service::{
    allows_transition, build_opencode_startup_event_payload, can_set_plan,
    can_set_spec_from_status, derive_available_actions, normalize_required_markdown,
    normalize_subtask_plan_inputs, terminate_child_process,
    validate_parent_relationships_for_create, validate_parent_relationships_for_update,
    validate_plan_subtask_rules, validate_transition, wait_for_local_server,
    wait_for_local_server_with_process, AgentRuntimeProcess, AppService, DevServerGroupRuntime,
    OpencodeStartupMetricsSnapshot, OpencodeStartupReadinessPolicy, OpencodeStartupWaitReport,
    RuntimeSessionStatusProbeTarget, StartupEventContext, StartupEventCorrelation,
    StartupEventPayload,
};
use host_domain::{DevServerGroupState, DevServerScriptState, DevServerScriptStatus};
use host_domain::{
    RuntimeCapabilities, RuntimeDefinition, RuntimeDescriptor, RuntimeHealth,
    RuntimeProvisioningMode, RuntimeStartupReadinessConfig, RuntimeSupportedScope,
};

fn init_git_repo(path: &std::path::Path) -> Result<()> {
    let status = Command::new("git")
        .args(["init", "--quiet"])
        .arg(path)
        .status()?;
    if status.success() {
        return Ok(());
    }

    Err(anyhow::anyhow!(
        "failed to initialize git repo for test at {}",
        path.display()
    ))
}

fn insert_workspace_runtime(service: &AppService, repo_path: &str, port: u16) -> Result<()> {
    let summary = RuntimeInstanceSummary {
        kind: AgentRuntimeKind::opencode(),
        runtime_id: "runtime-workspace".to_string(),
        repo_path: repo_path.to_string(),
        task_id: None,
        role: RuntimeRole::Workspace,
        working_directory: repo_path.to_string(),
        runtime_route: builtin_opencode_runtime_route(port),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        descriptor: builtin_opencode_runtime_descriptor(),
    };
    service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .insert(
            "runtime-workspace".to_string(),
            AgentRuntimeProcess {
                summary,
                child: Some(spawn_sleep_process(30)),
                _runtime_process_guard: None,
                cleanup_target: None,
            },
        );
    Ok(())
}

fn insert_workspace_runtime_for_kind(
    service: &AppService,
    runtime_kind: AgentRuntimeKind,
    repo_path: &str,
    runtime_route: host_domain::RuntimeRoute,
) -> Result<()> {
    let descriptor = service
        .runtime_registry
        .definition(&runtime_kind)?
        .descriptor()
        .clone();
    let summary = RuntimeInstanceSummary {
        kind: runtime_kind,
        runtime_id: "runtime-workspace-custom".to_string(),
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
            "runtime-workspace-custom".to_string(),
            AgentRuntimeProcess {
                summary,
                child: Some(spawn_sleep_process(30)),
                _runtime_process_guard: None,
                cleanup_target: None,
            },
        );
    Ok(())
}

#[derive(Clone)]
enum SessionProbeBehavior {
    Default,
    ReturnNone,
    ReturnError(&'static str),
}

#[derive(Clone)]
struct TestRuntimeAdapter {
    definition: RuntimeDefinition,
    health: RuntimeHealth,
    session_probe_behavior: SessionProbeBehavior,
}

impl AppRuntime for TestRuntimeAdapter {
    fn definition(&self) -> RuntimeDefinition {
        self.definition.clone()
    }

    fn startup_policy(&self, _service: &AppService) -> Result<OpencodeStartupReadinessPolicy> {
        Ok(OpencodeStartupReadinessPolicy::default())
    }

    fn start_external(
        &self,
        _service: &AppService,
        _input: &crate::app_service::runtime_orchestrator::RuntimeStartInput<'_>,
        _runtime_id: &str,
    ) -> Result<ExternalRuntimeStart> {
        Ok(ExternalRuntimeStart {
            runtime_route: self.definition.route_for_port(43_123),
            startup_report: crate::app_service::RuntimeStartupWaitReport::zero(),
        })
    }

    fn spawn_server(
        &self,
        _service: &AppService,
        _working_directory: &std::path::Path,
        _repo_path_for_mcp: &std::path::Path,
        _port: u16,
    ) -> Result<std::process::Child> {
        Err(anyhow::anyhow!("spawn should not be used in this test"))
    }

    fn wait_until_ready(
        &self,
        _service: &AppService,
        _input: &crate::app_service::runtime_orchestrator::RuntimeStartInput<'_>,
        _child: &mut std::process::Child,
        _port: u16,
        _runtime_id: &str,
        _startup_policy: crate::app_service::RuntimeStartupReadinessPolicy,
    ) -> Result<crate::app_service::RuntimeStartupWaitReport> {
        Err(anyhow::anyhow!("wait should not be used in this test"))
    }

    fn runtime_health(&self) -> RuntimeHealth {
        self.health.clone()
    }

    fn abort_build_session(
        &self,
        _runtime_route: &host_domain::RuntimeRoute,
        _external_session_id: &str,
        _working_directory: &str,
    ) -> Result<()> {
        Err(anyhow::anyhow!("abort should not be used in this test"))
    }

    fn session_status_probe_target(
        &self,
        runtime_route: &host_domain::RuntimeRoute,
        working_directory: &str,
    ) -> Result<Option<RuntimeSessionStatusProbeTarget>> {
        match self.session_probe_behavior {
            SessionProbeBehavior::Default => match runtime_route {
                host_domain::RuntimeRoute::LocalHttp { .. } => {
                    Ok(Some(RuntimeSessionStatusProbeTarget::for_runtime_route(
                        runtime_route,
                        working_directory,
                    )?))
                }
                host_domain::RuntimeRoute::Stdio => Ok(None),
            },
            SessionProbeBehavior::ReturnNone => Ok(None),
            SessionProbeBehavior::ReturnError(message) => Err(anyhow::anyhow!(message)),
        }
    }
}

fn test_runtime_definition(kind: &str, label: &str) -> RuntimeDefinition {
    test_runtime_definition_with_provisioning(kind, label, RuntimeProvisioningMode::HostManaged)
}

fn test_runtime_definition_with_provisioning(
    kind: &str,
    label: &str,
    provisioning_mode: RuntimeProvisioningMode,
) -> RuntimeDefinition {
    RuntimeDefinition::new(
        RuntimeDescriptor {
            kind: AgentRuntimeKind::from(kind),
            label: label.to_string(),
            description: format!("{label} runtime"),
            read_only_role_blocked_tools: vec!["apply_patch".to_string()],
            workflow_tool_aliases_by_canonical: Default::default(),
            capabilities: RuntimeCapabilities {
                supports_profiles: true,
                supports_variants: true,
                supports_slash_commands: true,
                supports_file_search: true,
                supports_odt_workflow_tools: true,
                supports_session_fork: true,
                supports_queued_user_messages: true,
                supports_permission_requests: true,
                supports_question_requests: true,
                supports_todos: true,
                supports_diff: true,
                supports_file_status: true,
                supports_mcp_status: true,
                supported_scopes: vec![
                    RuntimeSupportedScope::Workspace,
                    RuntimeSupportedScope::Task,
                    RuntimeSupportedScope::Build,
                ],
                provisioning_mode,
            },
        },
        RuntimeStartupReadinessConfig::default(),
        |port| host_domain::RuntimeRoute::LocalHttp {
            endpoint: format!("http://127.0.0.1:{port}"),
        },
    )
}

#[test]
fn runtime_ensure_registers_external_runtimes_without_local_child_processes() -> Result<()> {
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

    let runtime = service.runtime_ensure("test-runtime", "/tmp/external-runtime")?;

    assert_eq!(runtime.kind, AgentRuntimeKind::from("test-runtime"));
    assert_eq!(
        runtime.runtime_route,
        host_domain::RuntimeRoute::LocalHttp {
            endpoint: "http://127.0.0.1:43123".to_string(),
        }
    );
    assert_eq!(
        service
            .runtime_list("test-runtime", Some("/tmp/external-runtime"))?
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
                    runtime_route: host_domain::RuntimeRoute::Stdio,
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
                session_probe_behavior: SessionProbeBehavior::ReturnNone,
            }),
        ],
        AgentRuntimeKind::opencode(),
    )?;
    let (service, task_state, _git_state) = build_service_with_runtime_registry(
        vec![make_task("task-1", "task", TaskStatus::InProgress)],
        runtime_registry,
    );
    let repo_path_string = repo_path.to_string_lossy().to_string();
    let _ = service.workspace_add(repo_path_string.as_str())?;
    service.workspace_update_repo_config(
        repo_path_string.as_str(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            default_runtime_kind: "test-runtime".to_string(),
            ..Default::default()
        },
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
    insert_workspace_runtime_for_kind(
        &service,
        AgentRuntimeKind::from("test-runtime"),
        repo_path_string.as_str(),
        host_domain::RuntimeRoute::Stdio,
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
fn app_service_new_constructor_is_callable() -> Result<()> {
    let config_store = AppConfigStore::from_path(unique_temp_path("new-constructor"));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: Arc::new(Mutex::new(TaskStoreState {
            diagnose_calls: Vec::new(),
            diagnose_error: None,
            diagnose_health: None,
            ensure_calls: Vec::new(),
            ensure_error: None,
            tasks: Vec::new(),
            list_calls: Vec::new(),
            list_pull_request_sync_candidate_calls: Vec::new(),
            get_task_calls: Vec::new(),
            get_task_error: None,
            list_error: None,
            delete_calls: Vec::new(),
            delete_error: None,
            created_inputs: Vec::new(),
            updated_patches: Vec::new(),
            spec_get_calls: Vec::new(),
            spec_set_calls: Vec::new(),
            plan_get_calls: Vec::new(),
            plan_set_calls: Vec::new(),
            metadata_get_calls: Vec::new(),
            metadata_spec: None,
            metadata_plan: None,
            metadata_target_branch: None,
            qa_append_calls: Vec::new(),
            qa_outcome_calls: Vec::new(),
            latest_qa_report: None,
            agent_sessions: Vec::new(),
            upserted_sessions: Vec::new(),
            cleared_session_roles: Vec::new(),
            clear_agent_sessions_error: None,
            cleared_workflow_documents: Vec::new(),
            cleared_qa_reports: Vec::new(),
            set_delivery_metadata_error: None,
            pull_requests: std::collections::HashMap::new(),
            direct_merge_records: std::collections::HashMap::new(),
        })),
    });

    let service = AppService::new(task_store, config_store);
    let _ = service.runtime_check()?;
    Ok(())
}

#[test]
fn open_in_tool_discovery_uses_cached_results_without_rerunning_discovery() -> Result<()> {
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let discovery_calls = Arc::new(AtomicU64::new(0));

    let first_result = {
        let discovery_calls = discovery_calls.clone();
        service.list_open_in_tools_with_discovery(false, move || {
            discovery_calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec![
                SystemOpenInToolInfo {
                    tool_id: SystemOpenInToolId::Finder,
                    icon_data_url: None,
                },
                SystemOpenInToolInfo {
                    tool_id: SystemOpenInToolId::Ghostty,
                    icon_data_url: Some("data:image/png;base64,ghostty".to_string()),
                },
            ])
        })?
    };
    let second_result = {
        let discovery_calls = discovery_calls.clone();
        service.list_open_in_tools_with_discovery(false, move || {
            discovery_calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec![SystemOpenInToolInfo {
                tool_id: SystemOpenInToolId::Finder,
                icon_data_url: None,
            }])
        })?
    };

    assert_eq!(discovery_calls.load(Ordering::SeqCst), 1);
    assert_eq!(first_result, second_result);
    Ok(())
}

#[test]
fn open_in_tool_discovery_force_refresh_bypasses_cached_results() -> Result<()> {
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let discovery_calls = Arc::new(AtomicU64::new(0));

    let _ = {
        let discovery_calls = discovery_calls.clone();
        service.list_open_in_tools_with_discovery(false, move || {
            discovery_calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec![SystemOpenInToolInfo {
                tool_id: SystemOpenInToolId::Finder,
                icon_data_url: None,
            }])
        })?
    };
    let refreshed_result = {
        let discovery_calls = discovery_calls.clone();
        service.list_open_in_tools_with_discovery(true, move || {
            discovery_calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec![SystemOpenInToolInfo {
                tool_id: SystemOpenInToolId::Zed,
                icon_data_url: Some("data:image/png;base64,zed".to_string()),
            }])
        })?
    };

    assert_eq!(discovery_calls.load(Ordering::SeqCst), 2);
    assert_eq!(refreshed_result[0].tool_id, SystemOpenInToolId::Zed);
    Ok(())
}

#[test]
fn open_directory_in_tool_rejects_missing_directory_paths_before_launch() {
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let missing_path = unique_temp_path("open-in-missing-directory");

    let error = service
        .open_directory_in_tool(
            missing_path.to_string_lossy().as_ref(),
            SystemOpenInToolId::Finder,
        )
        .expect_err("missing directory should fail before launch");

    assert!(error.to_string().contains("Directory does not exist"));
}

#[test]
fn open_directory_in_tool_rejects_non_directory_paths_before_launch() {
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let file_path = unique_temp_path("open-in-file-path");
    fs::write(&file_path, "not a directory").expect("test file should be created");

    let error = service
        .open_directory_in_tool(
            file_path.to_string_lossy().as_ref(),
            SystemOpenInToolId::Finder,
        )
        .expect_err("file path should fail before launch");

    assert!(error.to_string().contains("Path is not a directory"));
    let _ = fs::remove_file(file_path);
}

#[test]
fn open_directory_in_tool_passes_validated_directory_and_tool_to_launcher() -> Result<()> {
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let directory_path = unique_temp_path("open-in-valid-directory");
    fs::create_dir_all(&directory_path).context("test directory should be created")?;
    let launched = Arc::new(Mutex::new(None::<(std::path::PathBuf, SystemOpenInToolId)>));

    service.open_directory_in_tool_with_launcher(
        directory_path.to_string_lossy().as_ref(),
        SystemOpenInToolId::Ghostty,
        {
            let launched = launched.clone();
            move |directory, tool_id| {
                *launched
                    .lock()
                    .expect("launcher capture lock should not be poisoned") =
                    Some((directory.to_path_buf(), tool_id));
                Ok(())
            }
        },
    )?;

    assert_eq!(
        *launched
            .lock()
            .expect("launcher capture lock should not be poisoned"),
        Some((directory_path.clone(), SystemOpenInToolId::Ghostty))
    );
    fs::remove_dir_all(&directory_path).context("test directory should be removed")?;
    Ok(())
}

#[test]
fn open_directory_in_tool_preserves_significant_spaces_in_directory_path() -> Result<()> {
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let parent_directory = unique_temp_path("open-in-space-parent");
    let padded_directory = parent_directory.join(" repo-with-space ");
    fs::create_dir_all(&padded_directory).context("padded test directory should be created")?;
    let launched = Arc::new(Mutex::new(None::<std::path::PathBuf>));

    service.open_directory_in_tool_with_launcher(
        padded_directory.to_string_lossy().as_ref(),
        SystemOpenInToolId::Finder,
        {
            let launched = launched.clone();
            move |directory, _tool_id| {
                *launched
                    .lock()
                    .expect("launcher capture lock should not be poisoned") =
                    Some(directory.to_path_buf());
                Ok(())
            }
        },
    )?;

    assert_eq!(
        *launched
            .lock()
            .expect("launcher capture lock should not be poisoned"),
        Some(padded_directory.clone())
    );
    fs::remove_dir_all(&parent_directory).context("padded test directories should be removed")?;
    Ok(())
}

#[test]
fn bug_can_skip_spec_and_go_in_progress_from_open() {
    let bug = make_task("bug-1", "bug", TaskStatus::Open);
    assert!(allows_transition(
        &bug,
        &TaskStatus::Open,
        &TaskStatus::InProgress
    ));
}

#[test]
fn feature_cannot_skip_to_in_progress_from_open() {
    let feature = make_task("feature-1", "feature", TaskStatus::Open);
    assert!(!allows_transition(
        &feature,
        &TaskStatus::Open,
        &TaskStatus::InProgress
    ));
}

#[test]
fn human_review_is_in_progress_state_not_closed() {
    let task = make_task("task-1", "task", TaskStatus::HumanReview);
    assert!(allows_transition(
        &task,
        &TaskStatus::HumanReview,
        &TaskStatus::InProgress
    ));
    assert!(allows_transition(
        &task,
        &TaskStatus::HumanReview,
        &TaskStatus::Closed
    ));
}

#[test]
fn epic_close_ignores_deferred_subtasks_for_completion_guard() {
    let epic = make_task("epic-1", "epic", TaskStatus::HumanReview);
    let mut deferred_child = make_task("task-1", "task", TaskStatus::Deferred);
    deferred_child.parent_id = Some(epic.id.clone());

    let tasks = vec![epic.clone(), deferred_child];
    let result = validate_transition(&epic, &tasks, &TaskStatus::HumanReview, &TaskStatus::Closed);
    assert!(
        result.is_ok(),
        "deferred subtasks should not block epic completion"
    );
}

#[test]
fn epic_close_is_blocked_by_open_direct_subtask() {
    let epic = make_task("epic-1", "epic", TaskStatus::HumanReview);
    let mut active_child = make_task("task-1", "task", TaskStatus::Open);
    active_child.parent_id = Some(epic.id.clone());

    let tasks = vec![epic.clone(), active_child];
    let result = validate_transition(&epic, &tasks, &TaskStatus::HumanReview, &TaskStatus::Closed);
    assert!(
        result.is_err(),
        "open direct subtasks must block epic completion"
    );
}

#[test]
fn only_epics_can_have_subtasks_and_depth_is_one_level() {
    let epic = make_task("epic-1", "epic", TaskStatus::Open);
    let mut non_epic_parent = make_task("task-parent", "task", TaskStatus::Open);
    let mut level_two_parent = make_task("epic-child", "epic", TaskStatus::Open);
    level_two_parent.parent_id = Some(epic.id.clone());

    let tasks = vec![
        epic.clone(),
        non_epic_parent.clone(),
        level_two_parent.clone(),
    ];

    let invalid_non_epic_parent = CreateTaskInput {
        title: "child".to_string(),
        issue_type: IssueType::Task,
        priority: 2,
        description: None,
        labels: None,
        ai_review_enabled: Some(true),
        parent_id: Some(non_epic_parent.id.clone()),
    };
    assert!(validate_parent_relationships_for_create(&tasks, &invalid_non_epic_parent).is_err());

    let invalid_depth_two = CreateTaskInput {
        title: "child".to_string(),
        issue_type: IssueType::Task,
        priority: 2,
        description: None,
        labels: None,
        ai_review_enabled: Some(true),
        parent_id: Some(level_two_parent.id.clone()),
    };
    assert!(validate_parent_relationships_for_create(&tasks, &invalid_depth_two).is_err());

    non_epic_parent.parent_id = Some(epic.id.clone());
    let patch = UpdateTaskPatch {
        title: None,
        description: None,
        notes: None,
        status: Some(TaskStatus::Deferred),
        priority: None,
        issue_type: None,
        ai_review_enabled: None,
        labels: None,
        assignee: None,
        parent_id: Some(epic.id.clone()),
        target_branch: None,
    };
    assert!(validate_parent_relationships_for_update(&tasks, &non_epic_parent, &patch).is_ok());
}

#[test]
fn markdown_documents_require_non_empty_content() {
    assert!(normalize_required_markdown("   ", "spec").is_err());
    assert_eq!(
        normalize_required_markdown("  # Valid  ", "spec").expect("valid markdown"),
        "# Valid"
    );
}

#[test]
fn subtask_plan_inputs_are_normalized_and_validated() {
    let normalized = normalize_subtask_plan_inputs(vec![PlanSubtaskInput {
        title: "  Build API  ".to_string(),
        issue_type: Some(IssueType::Feature),
        priority: Some(99),
        description: Some("  add endpoint ".to_string()),
    }])
    .expect("normalized");

    assert_eq!(normalized.len(), 1);
    let first = &normalized[0];
    assert_eq!(first.title, "Build API");
    assert_eq!(first.issue_type, IssueType::Feature);
    assert_eq!(first.priority, 4);
    assert_eq!(first.description.as_deref(), Some("add endpoint"));
}

#[test]
fn subtask_plan_inputs_reject_epic_issue_type() {
    let result = normalize_subtask_plan_inputs(vec![PlanSubtaskInput {
        title: "Do work".to_string(),
        issue_type: Some(IssueType::Epic),
        priority: Some(2),
        description: None,
    }]);
    assert!(result.is_err());
}

#[test]
fn spec_and_plan_write_status_guards_follow_matrix() {
    assert!(can_set_spec_from_status(&TaskStatus::Open));
    assert!(can_set_spec_from_status(&TaskStatus::SpecReady));
    assert!(can_set_spec_from_status(&TaskStatus::ReadyForDev));
    assert!(!can_set_spec_from_status(&TaskStatus::InProgress));

    let epic_open = make_task("epic-open", "epic", TaskStatus::Open);
    let epic_spec_ready = make_task("epic-spec", "epic", TaskStatus::SpecReady);
    let epic_ready_for_dev = make_task("epic-ready", "epic", TaskStatus::ReadyForDev);
    let feature_open = make_task("feature-open", "feature", TaskStatus::Open);
    let feature_ready_for_dev = make_task("feature-ready", "feature", TaskStatus::ReadyForDev);
    let task_open = make_task("task-open", "task", TaskStatus::Open);
    let task_ready_for_dev = make_task("task-ready", "task", TaskStatus::ReadyForDev);
    let bug_open = make_task("bug-open", "bug", TaskStatus::Open);
    let bug_ready_for_dev = make_task("bug-ready", "bug", TaskStatus::ReadyForDev);
    let feature_in_progress = make_task("feature-progress", "feature", TaskStatus::InProgress);

    assert!(!can_set_plan(&epic_open));
    assert!(can_set_plan(&epic_spec_ready));
    assert!(can_set_plan(&epic_ready_for_dev));
    assert!(!can_set_plan(&feature_open));
    assert!(can_set_plan(&feature_ready_for_dev));
    assert!(can_set_plan(&task_open));
    assert!(can_set_plan(&task_ready_for_dev));
    assert!(can_set_plan(&bug_open));
    assert!(can_set_plan(&bug_ready_for_dev));
    assert!(!can_set_plan(&feature_in_progress));
}

#[test]
fn epic_plan_requires_existing_or_proposed_direct_subtasks() {
    let epic = make_task("epic-1", "epic", TaskStatus::SpecReady);
    let tasks = vec![epic.clone()];
    let result = validate_plan_subtask_rules(&epic, &tasks, &[]);
    assert!(result.is_err());

    let proposals = vec![CreateTaskInput {
        title: "Subtask".to_string(),
        issue_type: IssueType::Task,
        priority: 2,
        description: None,
        labels: None,
        ai_review_enabled: Some(true),
        parent_id: None,
    }];
    assert!(validate_plan_subtask_rules(&epic, &tasks, &proposals).is_ok());
}

#[test]
fn non_epic_plan_cannot_accept_subtask_proposals() {
    let task = make_task("task-1", "task", TaskStatus::Open);
    let proposals = vec![CreateTaskInput {
        title: "Child".to_string(),
        issue_type: IssueType::Bug,
        priority: 2,
        description: None,
        labels: None,
        ai_review_enabled: Some(true),
        parent_id: None,
    }];

    let result = validate_plan_subtask_rules(&task, std::slice::from_ref(&task), &proposals);
    assert!(result.is_err());
}

#[test]
fn feature_in_open_exposes_spec_only() {
    let feature = make_task("feature-1", "feature", TaskStatus::Open);
    let actions = derive_available_actions(&feature, std::slice::from_ref(&feature));

    assert!(actions.contains(&TaskAction::SetSpec));
    assert!(!actions.contains(&TaskAction::SetPlan));
    assert!(!actions.contains(&TaskAction::BuildStart));
}

#[test]
fn epic_in_open_exposes_spec_only() {
    let epic = make_task("epic-1", "epic", TaskStatus::Open);
    let actions = derive_available_actions(&epic, std::slice::from_ref(&epic));

    assert!(actions.contains(&TaskAction::SetSpec));
    assert!(!actions.contains(&TaskAction::SetPlan));
    assert!(!actions.contains(&TaskAction::BuildStart));
}

#[test]
fn bug_in_open_can_start_build_directly() {
    let bug = make_task("bug-1", "bug", TaskStatus::Open);
    let actions = derive_available_actions(&bug, std::slice::from_ref(&bug));
    assert!(actions.contains(&TaskAction::BuildStart));
}

#[test]
fn in_progress_tasks_expose_builder_action_and_no_plan_actions() {
    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let actions = derive_available_actions(&task, std::slice::from_ref(&task));
    assert!(actions.contains(&TaskAction::OpenBuilder));
    assert!(actions.contains(&TaskAction::ResetImplementation));
    assert!(!actions.contains(&TaskAction::BuildStart));
    assert!(!actions.contains(&TaskAction::OpenQa));
    assert!(!actions.contains(&TaskAction::SetSpec));
    assert!(!actions.contains(&TaskAction::SetPlan));
}

#[test]
fn qa_rejected_in_progress_tasks_expose_rework_and_open_qa_actions() {
    let mut task = make_task("task-1", "task", TaskStatus::InProgress);
    task.document_summary.qa_report.has = true;
    task.document_summary.qa_report.verdict = QaWorkflowVerdict::Rejected;

    let actions = derive_available_actions(&task, std::slice::from_ref(&task));

    assert!(actions.contains(&TaskAction::BuildStart));
    assert!(actions.contains(&TaskAction::OpenBuilder));
    assert!(actions.contains(&TaskAction::OpenQa));
}

#[test]
fn ai_review_tasks_expose_qa_start_request_changes_approve_and_hide_build_start() {
    let task = make_task("task-1", "task", TaskStatus::AiReview);
    let actions = derive_available_actions(&task, std::slice::from_ref(&task));
    assert!(actions.contains(&TaskAction::QaStart));
    assert!(actions.contains(&TaskAction::ResetImplementation));
    assert!(actions.contains(&TaskAction::HumanRequestChanges));
    assert!(actions.contains(&TaskAction::HumanApprove));
    assert!(!actions.contains(&TaskAction::BuildStart));
    assert!(actions.contains(&TaskAction::OpenBuilder));
}

#[test]
fn human_review_tasks_expose_qa_start_and_request_changes() {
    let task = make_task("task-1", "task", TaskStatus::HumanReview);
    let actions = derive_available_actions(&task, std::slice::from_ref(&task));
    assert!(actions.contains(&TaskAction::QaStart));
    assert!(actions.contains(&TaskAction::ResetImplementation));
    assert!(actions.contains(&TaskAction::HumanRequestChanges));
    assert!(actions.contains(&TaskAction::HumanApprove));
}

#[test]
fn blocked_tasks_expose_builder_and_reset_implementation_actions() {
    let task = make_task("task-1", "task", TaskStatus::Blocked);
    let actions = derive_available_actions(&task, std::slice::from_ref(&task));
    assert!(actions.contains(&TaskAction::OpenBuilder));
    assert!(actions.contains(&TaskAction::ResetImplementation));
    assert!(!actions.contains(&TaskAction::BuildStart));
}

#[test]
fn task_reset_implementation_discards_builder_state_and_rolls_back_to_ready_for_dev_from_ai_review(
) -> Result<()> {
    assert_task_reset_implementation_discards_builder_state_and_rolls_back_to_ready_for_dev(
        TaskStatus::AiReview,
    )
}

#[test]
fn task_reset_implementation_discards_builder_state_and_rolls_back_to_ready_for_dev_from_blocked(
) -> Result<()> {
    assert_task_reset_implementation_discards_builder_state_and_rolls_back_to_ready_for_dev(
        TaskStatus::Blocked,
    )
}

fn assert_task_reset_implementation_discards_builder_state_and_rolls_back_to_ready_for_dev(
    status: TaskStatus,
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let build_worktree = worktree_base.join("task-1");
    let qa_worktree = worktree_base.join("task-1-qa");
    fs::create_dir_all(&worktree_base)?;
    fs::create_dir_all(&build_worktree)?;
    fs::create_dir_all(&qa_worktree)?;

    let mut task = make_task("task-1", "task", status);
    task.document_summary.spec.has = true;
    task.document_summary.plan.has = true;
    task.document_summary.qa_report.has = true;
    task.document_summary.qa_report.verdict = QaWorkflowVerdict::Rejected;
    task.pull_request = Some(PullRequestRecord {
        provider_id: "github".to_string(),
        number: 42,
        url: "https://example.com/pr/42".to_string(),
        state: "open".to_string(),
        created_at: "2026-03-17T12:00:00Z".to_string(),
        updated_at: "2026-03-17T12:00:00Z".to_string(),
        last_synced_at: None,
        merged_at: None,
        closed_at: None,
    });

    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![
            GitBranch {
                name: "odt/task-1".to_string(),
                is_current: false,
                is_remote: false,
            },
            GitBranch {
                name: "odt/task-1-follow-up".to_string(),
                is_current: false,
                is_remote: false,
            },
        ],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let workspace = service.workspace_add(&repo_path.to_string_lossy())?;
    let canonical_repo_path = workspace.path.clone();
    let repo_config = host_infra_system::RepoConfig {
        branch_prefix: "odt".to_string(),
        worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
        ..Default::default()
    };
    service.workspace_update_repo_config(canonical_repo_path.as_str(), repo_config)?;
    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.current_branches_by_path.insert(
            build_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
        state.current_branches_by_path.insert(
            qa_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1-follow-up".to_string()),
                detached: false,
                revision: None,
            },
        );
    }
    {
        let mut state = task_state.lock().expect("task store lock poisoned");
        state.agent_sessions = vec![
            AgentSessionDocument {
                session_id: "spec-session".to_string(),
                external_session_id: None,
                role: "spec".to_string(),
                scenario: "spec_initial".to_string(),
                started_at: "2026-03-17T10:00:00Z".to_string(),
                runtime_kind: "opencode".to_string(),
                working_directory: repo_path.to_string_lossy().to_string(),
                selected_model: None,
            },
            AgentSessionDocument {
                session_id: "build-session".to_string(),
                external_session_id: None,
                role: "build".to_string(),
                scenario: "build_implementation_start".to_string(),
                started_at: "2026-03-17T11:00:00Z".to_string(),
                runtime_kind: "opencode".to_string(),
                working_directory: build_worktree.to_string_lossy().to_string(),
                selected_model: None,
            },
            AgentSessionDocument {
                session_id: "qa-session".to_string(),
                external_session_id: None,
                role: "qa".to_string(),
                scenario: "qa_review".to_string(),
                started_at: "2026-03-17T12:00:00Z".to_string(),
                runtime_kind: "opencode".to_string(),
                working_directory: qa_worktree.to_string_lossy().to_string(),
                selected_model: None,
            },
        ];
        state.pull_requests.insert(
            "task-1".to_string(),
            PullRequestRecord {
                provider_id: "github".to_string(),
                number: 42,
                url: "https://example.com/pr/42".to_string(),
                state: "open".to_string(),
                created_at: "2026-03-17T12:00:00Z".to_string(),
                updated_at: "2026-03-17T12:00:00Z".to_string(),
                last_synced_at: None,
                merged_at: None,
                closed_at: None,
            },
        );
    }

    #[cfg(unix)]
    let (mut dev_server_child, dev_server_pid) = {
        let child = spawn_sleep_process_group(20);
        let pid = child.id();
        service
            .dev_server_groups
            .lock()
            .expect("dev server lock poisoned")
            .insert(
                format!("{}::task-1", canonical_repo_path),
                DevServerGroupRuntime {
                    state: DevServerGroupState {
                        repo_path: canonical_repo_path.clone(),
                        task_id: "task-1".to_string(),
                        worktree_path: Some(build_worktree.to_string_lossy().to_string()),
                        scripts: vec![DevServerScriptState {
                            script_id: "server-1".to_string(),
                            name: "Server".to_string(),
                            command: "sleep 20".to_string(),
                            status: DevServerScriptStatus::Running,
                            pid: Some(pid),
                            started_at: Some("2026-03-19T12:00:00Z".to_string()),
                            exit_code: None,
                            last_error: None,
                            buffered_terminal_chunks: Vec::new(),
                            next_terminal_sequence: 0,
                        }],
                        updated_at: "2026-03-19T12:00:00Z".to_string(),
                    },
                    emitter: None,
                },
            );
        (child, pid)
    };

    let reset_result = service.task_reset_implementation(canonical_repo_path.as_str(), "task-1");

    #[cfg(unix)]
    {
        let unix_cleanup_result = (|| -> Result<()> {
            let deadline = Instant::now() + Duration::from_secs(2);
            let exited = loop {
                if dev_server_child
                    .try_wait()
                    .context("failed checking dev server child status")?
                    .is_some()
                {
                    break true;
                }
                if Instant::now() >= deadline {
                    break false;
                }
                std::thread::sleep(Duration::from_millis(50));
            };
            if !exited {
                terminate_child_process(&mut dev_server_child);
            } else {
                let _ = dev_server_child
                    .wait()
                    .context("failed waiting dev server child")?;
            }

            assert!(wait_for_process_exit(
                dev_server_pid as i32,
                Duration::from_secs(2)
            ));

            let groups = service
                .dev_server_groups
                .lock()
                .expect("dev server lock poisoned");
            let group = groups
                .get(&format!("{}::task-1", canonical_repo_path))
                .expect("dev server group retained");
            assert!(group.state.scripts.is_empty());
            Ok(())
        })();
        unix_cleanup_result?;
    }

    let updated = reset_result?;
    assert_eq!(updated.status, TaskStatus::ReadyForDev);
    assert!(updated.pull_request.is_none());
    assert!(!updated.document_summary.qa_report.has);

    let state = task_state.lock().expect("task store lock poisoned");
    assert_eq!(
        state.cleared_session_roles,
        vec![(
            "task-1".to_string(),
            vec!["build".to_string(), "qa".to_string()]
        )]
    );
    assert_eq!(state.cleared_qa_reports, vec!["task-1".to_string()]);
    assert_eq!(state.agent_sessions.len(), 1);
    assert_eq!(state.agent_sessions[0].role, "spec");
    assert!(!state.pull_requests.contains_key("task-1"));
    drop(state);

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &build_worktree.to_string_lossy() && *force
    )));
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &qa_worktree.to_string_lossy() && *force
    )));
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::DeleteLocalBranch { branch, force, .. }
            if branch == "odt/task-1" && *force
    )));

    Ok(())
}

#[test]
fn task_reset_implementation_uses_document_presence_for_rollback_target() -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-status-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let mut ready_for_dev = make_task("task-ready", "task", TaskStatus::Blocked);
    ready_for_dev.document_summary.spec.has = true;
    ready_for_dev.document_summary.plan.has = true;

    let mut spec_ready = make_task("task-spec", "task", TaskStatus::Blocked);
    spec_ready.document_summary.spec.has = true;

    let open = make_task("task-open", "task", TaskStatus::Blocked);

    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![ready_for_dev, spec_ready, open],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    let repo_config = host_infra_system::RepoConfig {
        branch_prefix: "odt".to_string(),
        ..Default::default()
    };
    service.workspace_update_repo_config(&repo_path.to_string_lossy(), repo_config)?;

    let ready_for_dev_result =
        service.task_reset_implementation(&repo_path.to_string_lossy(), "task-ready")?;
    let spec_ready_result =
        service.task_reset_implementation(&repo_path.to_string_lossy(), "task-spec")?;
    let open_result =
        service.task_reset_implementation(&repo_path.to_string_lossy(), "task-open")?;

    assert_eq!(ready_for_dev_result.status, TaskStatus::ReadyForDev);
    assert_eq!(spec_ready_result.status, TaskStatus::SpecReady);
    assert_eq!(open_result.status, TaskStatus::Open);
    Ok(())
}

#[test]
fn task_reset_implementation_ignores_stale_persisted_build_session_without_live_runtime(
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-active-session-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    let repo_config = host_infra_system::RepoConfig {
        branch_prefix: "odt".to_string(),
        ..Default::default()
    };
    service.workspace_update_repo_config(&repo_path.to_string_lossy(), repo_config)?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let reset = service.task_reset_implementation(&repo_path.to_string_lossy(), "task-1")?;
    assert_eq!(reset.status, TaskStatus::Open);
    Ok(())
}

#[test]
fn task_reset_implementation_ignores_stale_qa_sessions_with_persisted_external_ids() -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-stale-qa-session-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    let repo_config = host_infra_system::RepoConfig {
        branch_prefix: "odt".to_string(),
        ..Default::default()
    };
    service.workspace_update_repo_config(&repo_path.to_string_lossy(), repo_config)?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "qa-session".to_string(),
        external_session_id: Some("external-qa-session".to_string()),
        role: "qa".to_string(),
        scenario: "qa_review".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let reset = service.task_reset_implementation(&repo_path.to_string_lossy(), "task-1")?;

    assert_eq!(reset.status, TaskStatus::Open);
    Ok(())
}

#[test]
fn task_reset_clears_workflow_artifacts_and_sets_status_to_open() -> Result<()> {
    let repo_path = unique_temp_path("reset-task-clears-workflow-artifacts-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let mut task = make_task("task-1", "task", TaskStatus::HumanReview);
    task.document_summary.spec.has = true;
    task.document_summary.plan.has = true;
    task.document_summary.qa_report.has = true;
    task.document_summary.qa_report.verdict = QaWorkflowVerdict::Approved;
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![
        AgentSessionDocument {
            session_id: "spec-session".to_string(),
            external_session_id: Some("external-spec-session".to_string()),
            role: "spec".to_string(),
            scenario: "spec_authoring".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: repo_path.to_string_lossy().to_string(),
            selected_model: None,
        },
        AgentSessionDocument {
            session_id: "planner-session".to_string(),
            external_session_id: Some("external-planner-session".to_string()),
            role: "planner".to_string(),
            scenario: "plan_authoring".to_string(),
            started_at: "2026-03-17T11:00:01Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: repo_path.to_string_lossy().to_string(),
            selected_model: None,
        },
        AgentSessionDocument {
            session_id: "build-session".to_string(),
            external_session_id: Some("external-build-session".to_string()),
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T11:00:02Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: repo_path.to_string_lossy().to_string(),
            selected_model: None,
        },
        AgentSessionDocument {
            session_id: "qa-session".to_string(),
            external_session_id: Some("external-qa-session".to_string()),
            role: "qa".to_string(),
            scenario: "qa_review".to_string(),
            started_at: "2026-03-17T11:00:03Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: repo_path.to_string_lossy().to_string(),
            selected_model: None,
        },
    ];
    {
        let mut state = task_state.lock().expect("task store lock poisoned");
        state.pull_requests.insert(
            "task-1".to_string(),
            PullRequestRecord {
                provider_id: "github".to_string(),
                number: 42,
                url: "https://example.com/pr/42".to_string(),
                state: "open".to_string(),
                created_at: "2026-03-17T11:00:00Z".to_string(),
                updated_at: "2026-03-17T11:05:00Z".to_string(),
                last_synced_at: None,
                merged_at: None,
                closed_at: None,
            },
        );
        state.direct_merge_records.insert(
            "task-1".to_string(),
            host_domain::DirectMergeRecord {
                method: host_domain::GitMergeMethod::Squash,
                source_branch: "odt/task-1".to_string(),
                target_branch: host_domain::GitTargetBranch {
                    remote: Some("origin".to_string()),
                    branch: "main".to_string(),
                },
                merged_at: "2026-03-17T11:10:00Z".to_string(),
            },
        );
    }
    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-1".to_string(),
            crate::app_service::RunProcess {
                summary: serde_json::from_value(json!({
                    "runId": "run-1",
                    "runtimeKind": "opencode",
                    "runtimeRoute": {
                        "type": "local_http",
                        "endpoint": "http://127.0.0.1:3001",
                    },
                    "repoPath": repo_path.to_string_lossy().to_string(),
                    "taskId": "task-1",
                    "branch": "odt/task-1",
                    "worktreePath": repo_path.to_string_lossy().to_string(),
                    "port": 3001,
                    "state": "completed",
                    "lastMessage": null,
                    "startedAt": "2026-03-17T11:00:00Z",
                }))?,
                child: None,
                _runtime_process_guard: None,
                repo_path: repo_path.to_string_lossy().to_string(),
                task_id: "task-1".to_string(),
                worktree_path: repo_path.to_string_lossy().to_string(),
                repo_config: host_infra_system::RepoConfig {
                    branch_prefix: "odt".to_string(),
                    ..Default::default()
                },
            },
        );

    let reset = service.task_reset(&repo_path.to_string_lossy(), "task-1")?;

    assert_eq!(reset.status, TaskStatus::Open);
    let state = task_state.lock().expect("task store lock poisoned");
    assert_eq!(state.cleared_workflow_documents, vec!["task-1".to_string()]);
    assert!(state.metadata_spec.is_none());
    assert!(state.metadata_plan.is_none());
    assert_eq!(
        state.cleared_session_roles,
        vec![(
            "task-1".to_string(),
            vec![
                "spec".to_string(),
                "planner".to_string(),
                "build".to_string(),
                "qa".to_string(),
            ],
        )]
    );
    assert!(!state.pull_requests.contains_key("task-1"));
    assert!(!state.direct_merge_records.contains_key("task-1"));
    assert!(state.agent_sessions.is_empty());
    drop(state);
    assert!(service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .is_empty());
    Ok(())
}

#[test]
fn task_reset_rejects_live_spec_session_status_with_repo_runtime_without_run() -> Result<()> {
    assert_task_reset_rejects_live_session_status(
        TaskStatus::SpecReady,
        "spec",
        "spec_authoring",
        "Cannot reset task while active spec session(s) exist",
    )
}

#[test]
fn task_reset_rejects_live_planner_session_status_with_repo_runtime_without_run() -> Result<()> {
    assert_task_reset_rejects_live_session_status(
        TaskStatus::ReadyForDev,
        "planner",
        "plan_authoring",
        "Cannot reset task while active planner session(s) exist",
    )
}

#[test]
fn task_reset_rejects_live_build_session_status_with_repo_runtime_without_run() -> Result<()> {
    assert_task_reset_rejects_live_session_status(
        TaskStatus::InProgress,
        "build",
        "build_implementation_start",
        "Cannot reset task while active build session(s) exist",
    )
}

#[test]
fn task_reset_rejects_live_qa_session_status_with_repo_runtime_without_run() -> Result<()> {
    assert_task_reset_rejects_live_session_status(
        TaskStatus::AiReview,
        "qa",
        "qa_review",
        "Cannot reset task while active qa session(s) exist",
    )
}

fn assert_task_reset_rejects_live_session_status(
    status: TaskStatus,
    role: &str,
    scenario: &str,
    expected_message: &str,
) -> Result<()> {
    let repo_path = unique_temp_path("reset-task-live-spec-shared-runtime-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", status);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: format!("{role}-session"),
        external_session_id: Some(format!("external-{role}-session")),
        role: role.to_string(),
        scenario: scenario.to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let status_payload = format!(r#"{{"external-{role}-session":{{"type":"busy"}}}}"#);
    let status_payload = Box::leak(status_payload.into_boxed_str());
    let (port, server_handle) = spawn_opencode_session_status_server(status_payload)?;
    insert_workspace_runtime(&service, &repo_path.to_string_lossy(), port)?;

    let error = service
        .task_reset(&repo_path.to_string_lossy(), "task-1")
        .expect_err("live session should block full reset");
    assert!(error.to_string().contains(expected_message));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_reset_only_mutates_the_selected_task() -> Result<()> {
    let repo_path = unique_temp_path("reset-task-selected-task-only-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let parent = make_task("task-parent", "epic", TaskStatus::HumanReview);
    let mut child = make_task("task-child", "task", TaskStatus::InProgress);
    child.parent_id = Some("task-parent".to_string());
    child.document_summary.spec.has = true;
    child.document_summary.plan.has = true;
    child.document_summary.qa_report.has = true;
    child.document_summary.qa_report.verdict = QaWorkflowVerdict::Rejected;

    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![
            TaskCard {
                subtask_ids: vec!["task-child".to_string()],
                ..parent
            },
            child,
        ],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;

    let reset = service.task_reset(&repo_path.to_string_lossy(), "task-parent")?;

    assert_eq!(reset.status, TaskStatus::Open);
    let state = task_state.lock().expect("task store lock poisoned");
    assert_eq!(
        state.cleared_workflow_documents,
        vec!["task-parent".to_string()]
    );
    assert_eq!(
        state.cleared_session_roles,
        vec![(
            "task-parent".to_string(),
            vec![
                "spec".to_string(),
                "planner".to_string(),
                "build".to_string(),
                "qa".to_string(),
            ],
        )]
    );
    let child = state
        .tasks
        .iter()
        .find(|task| task.id == "task-child")
        .expect("child task should remain present");
    assert_eq!(child.status, TaskStatus::InProgress);
    assert!(child.document_summary.spec.has);
    assert!(child.document_summary.plan.has);
    assert!(child.document_summary.qa_report.has);
    assert_eq!(
        child.document_summary.qa_report.verdict,
        QaWorkflowVerdict::Rejected
    );
    Ok(())
}

#[test]
fn task_reset_removes_task_managed_worktrees_for_spec_and_planner_sessions() -> Result<()> {
    let repo_path = unique_temp_path("reset-task-owned-planning-worktrees-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let spec_worktree = worktree_base.join("task-1-spec");
    let planner_worktree = worktree_base.join("task-1-plan");
    let unrelated_worktree = worktree_base.join("scratch");
    fs::create_dir_all(&spec_worktree)?;
    fs::create_dir_all(&planner_worktree)?;
    fs::create_dir_all(&unrelated_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::ReadyForDev);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let workspace = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        workspace.path.as_str(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.current_branches_by_path.insert(
            spec_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
        state.current_branches_by_path.insert(
            planner_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
        state.current_branches_by_path.insert(
            unrelated_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("user/scratch".to_string()),
                detached: false,
                revision: None,
            },
        );
    }
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![
        AgentSessionDocument {
            session_id: "spec-session".to_string(),
            external_session_id: None,
            role: "spec".to_string(),
            scenario: "spec_authoring".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: spec_worktree.to_string_lossy().to_string(),
            selected_model: None,
        },
        AgentSessionDocument {
            session_id: "planner-session".to_string(),
            external_session_id: None,
            role: "planner".to_string(),
            scenario: "plan_authoring".to_string(),
            started_at: "2026-03-17T12:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: planner_worktree.to_string_lossy().to_string(),
            selected_model: None,
        },
        AgentSessionDocument {
            session_id: "build-session".to_string(),
            external_session_id: None,
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T13:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: unrelated_worktree.to_string_lossy().to_string(),
            selected_model: None,
        },
    ];

    let _ = service.task_reset(workspace.path.as_str(), "task-1")?;

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &spec_worktree.to_string_lossy() && *force
    )));
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &planner_worktree.to_string_lossy() && *force
    )));
    assert!(!git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, .. }
            if worktree_path == &unrelated_worktree.to_string_lossy()
    )));

    Ok(())
}

#[test]
fn task_reset_removes_stranded_task_managed_worktrees_when_branch_inspection_fails() -> Result<()> {
    let repo_path = unique_temp_path("reset-task-stranded-managed-worktrees-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let spec_worktree = worktree_base.join("task-1-spec");
    let planner_worktree = worktree_base.join("task-1-plan");
    fs::create_dir_all(&spec_worktree)?;
    fs::create_dir_all(&planner_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::ReadyForDev);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let workspace = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        workspace.path.as_str(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.current_branch_error_by_path.insert(
            spec_worktree.to_string_lossy().to_string(),
            "not a git worktree".to_string(),
        );
        state.current_branch_error_by_path.insert(
            planner_worktree.to_string_lossy().to_string(),
            "not a git worktree".to_string(),
        );
    }
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![
        AgentSessionDocument {
            session_id: "spec-session".to_string(),
            external_session_id: None,
            role: "spec".to_string(),
            scenario: "spec_authoring".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: spec_worktree.to_string_lossy().to_string(),
            selected_model: None,
        },
        AgentSessionDocument {
            session_id: "planner-session".to_string(),
            external_session_id: None,
            role: "planner".to_string(),
            scenario: "plan_authoring".to_string(),
            started_at: "2026-03-17T12:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: planner_worktree.to_string_lossy().to_string(),
            selected_model: None,
        },
    ];

    let _ = service.task_reset(workspace.path.as_str(), "task-1")?;

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &spec_worktree.to_string_lossy() && *force
    )));
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &planner_worktree.to_string_lossy() && *force
    )));

    Ok(())
}

#[test]
fn task_reset_propagates_non_worktree_branch_errors_for_task_managed_worktrees() -> Result<()> {
    let repo_path = unique_temp_path("reset-task-non-worktree-branch-error-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let spec_worktree = worktree_base.join("task-1-spec");
    fs::create_dir_all(&spec_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::ReadyForDev);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let workspace = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        workspace.path.as_str(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    git_state
        .lock()
        .expect("git state lock poisoned")
        .current_branch_error_by_path
        .insert(
            spec_worktree.to_string_lossy().to_string(),
            "permission denied".to_string(),
        );
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "spec-session".to_string(),
        external_session_id: None,
        role: "spec".to_string(),
        scenario: "spec_authoring".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: spec_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let error = service
        .task_reset(workspace.path.as_str(), "task-1")
        .expect_err("non-worktree branch errors should propagate");
    assert!(format!("{error:#}").contains("Failed to inspect implementation worktree branch"));

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(!git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { .. }
    )));

    Ok(())
}

#[test]
fn task_delete_reports_qa_specific_message_when_session_role_has_trailing_whitespace() -> Result<()>
{
    let repo_path = unique_temp_path("task-delete-live-qa-trimmed-role-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::Open);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "qa-session".to_string(),
        external_session_id: Some("external-qa-session".to_string()),
        role: "qa ".to_string(),
        scenario: "qa_review".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-qa-session":{"type":"busy"}}"#)?;
    insert_workspace_runtime(&service, &repo_path.to_string_lossy(), port)?;

    let error = service
        .task_delete(&repo_path.to_string_lossy(), "task-1", false)
        .expect_err("trimmed QA session should still block delete as QA work");
    let error_text = error.to_string();
    assert!(error_text.contains("Cannot delete tasks with active QA work in progress"));
    assert!(error_text.contains("task-1 (qa session)"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_reset_reports_completed_cleanup_steps_when_later_cleanup_fails() -> Result<()> {
    let repo_path = unique_temp_path("reset-task-partial-cleanup-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let mut task = make_task("task-1", "task", TaskStatus::ReadyForDev);
    task.document_summary.spec.has = true;
    task.document_summary.plan.has = true;
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .set_delivery_metadata_error = Some("delivery cleanup failed".to_string());

    let error = service
        .task_reset(&repo_path.to_string_lossy(), "task-1")
        .expect_err("delivery cleanup failure should bubble with progress details");
    let error_text = format!("{error:#}");

    assert!(error_text.contains("Failed to clear delivery metadata for task-1"));
    assert!(error_text.contains(
        "Reset cleanup already completed: cleared workflow documents, cleared linked agent sessions."
    ));
    assert!(error_text.contains("Retry reset to finish cleanup safely."));
    assert_eq!(
        task_state.lock().expect("task store lock poisoned").tasks[0].status,
        TaskStatus::ReadyForDev
    );
    Ok(())
}

#[test]
fn task_reset_implementation_rejects_live_qa_session_status_with_repo_runtime_without_run(
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-live-qa-shared-runtime-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
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
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-qa-session":{"type":"busy"}}"#)?;
    insert_workspace_runtime(&service, &repo_path.to_string_lossy(), port)?;

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("live QA session should block reset");
    assert!(error
        .to_string()
        .contains("Cannot reset implementation while active qa session(s) exist"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_delete_ignores_stale_persisted_build_session_without_live_runtime() -> Result<()> {
    let repo_path = unique_temp_path("delete-task-stale-build-session-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    let repo_config = host_infra_system::RepoConfig {
        branch_prefix: "odt".to_string(),
        ..Default::default()
    };
    service.workspace_update_repo_config(&repo_path.to_string_lossy(), repo_config)?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];

    service.task_delete(&repo_path.to_string_lossy(), "task-1", false)?;
    Ok(())
}

#[test]
fn task_delete_rejects_live_build_session_status() -> Result<()> {
    let repo_path = unique_temp_path("delete-task-live-runtime-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
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
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"busy"}}"#)?;
    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-1".to_string(),
            crate::app_service::RunProcess {
                summary: serde_json::from_value(json!({
                    "runId": "run-1",
                    "runtimeKind": "opencode",
                    "runtimeRoute": {
                        "type": "local_http",
                        "endpoint": format!("http://127.0.0.1:{port}"),
                    },
                    "repoPath": repo_path.to_string_lossy().to_string(),
                    "taskId": "task-1",
                    "branch": "odt/task-1",
                    "worktreePath": repo_path.to_string_lossy().to_string(),
                    "port": port,
                    "state": "running",
                    "lastMessage": null,
                    "startedAt": "2026-03-17T11:00:00Z",
                }))?,
                child: None,
                _runtime_process_guard: None,
                repo_path: repo_path.to_string_lossy().to_string(),
                task_id: "task-1".to_string(),
                worktree_path: repo_path.to_string_lossy().to_string(),
                repo_config: host_infra_system::RepoConfig {
                    branch_prefix: "odt".to_string(),
                    ..Default::default()
                },
            },
        );

    let error = service
        .task_delete(&repo_path.to_string_lossy(), "task-1", false)
        .expect_err("live runtime should block delete");
    assert!(error
        .to_string()
        .contains("Cannot delete tasks with active builder work in progress"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_delete_rejects_live_build_session_status_with_repo_runtime_without_run() -> Result<()> {
    let repo_path = unique_temp_path("delete-task-live-shared-runtime-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
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
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"busy"}}"#)?;
    insert_workspace_runtime(&service, &repo_path.to_string_lossy(), port)?;

    let error = service
        .task_delete(&repo_path.to_string_lossy(), "task-1", false)
        .expect_err("live shared-runtime session should block delete");
    assert!(error
        .to_string()
        .contains("Cannot delete tasks with active builder work in progress"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_delete_rejects_live_qa_session_status_with_qa_specific_message() -> Result<()> {
    let repo_path = unique_temp_path("task-delete-live-qa-shared-runtime-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::Open);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
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
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-qa-session":{"type":"busy"}}"#)?;
    insert_workspace_runtime(&service, &repo_path.to_string_lossy(), port)?;

    let error = service
        .task_delete(&repo_path.to_string_lossy(), "task-1", false)
        .expect_err("live QA session should block delete");
    let error_text = error.to_string();
    assert!(error_text.contains("Cannot delete tasks with active QA work in progress"));
    assert!(error_text.contains("task-1 (qa session)"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_delete_rejects_live_build_session_status_with_stale_run_route_and_repo_runtime_fallback(
) -> Result<()> {
    let repo_path = unique_temp_path("delete-task-live-shared-runtime-fallback-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
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
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let stale_route_port = {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        listener.local_addr()?.port()
    };
    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-stale".to_string(),
            crate::app_service::RunProcess {
                summary: serde_json::from_value(json!({
                    "runId": "run-stale",
                    "runtimeKind": "opencode",
                    "runtimeRoute": {
                        "type": "local_http",
                        "endpoint": format!("http://127.0.0.1:{stale_route_port}"),
                    },
                    "repoPath": repo_path.to_string_lossy().to_string(),
                    "taskId": "task-1",
                    "branch": "odt/task-1",
                    "worktreePath": repo_path.to_string_lossy().to_string(),
                    "port": stale_route_port,
                    "state": "running",
                    "lastMessage": null,
                    "startedAt": "2026-03-17T11:00:00Z",
                }))?,
                child: None,
                _runtime_process_guard: None,
                repo_path: repo_path.to_string_lossy().to_string(),
                task_id: "task-1".to_string(),
                worktree_path: repo_path.to_string_lossy().to_string(),
                repo_config: host_infra_system::RepoConfig {
                    branch_prefix: "odt".to_string(),
                    ..Default::default()
                },
            },
        );

    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"busy"}}"#)?;
    insert_workspace_runtime(&service, &repo_path.to_string_lossy(), port)?;

    let error = service
        .task_delete(&repo_path.to_string_lossy(), "task-1", false)
        .expect_err("live shared-runtime session should block delete");
    assert!(error
        .to_string()
        .contains("Cannot delete tasks with active builder work in progress"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_delete_clears_stale_runs_after_successful_delete() -> Result<()> {
    let repo_path = unique_temp_path("delete-task-clears-stale-runs-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
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
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"idle"}}"#)?;
    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-1".to_string(),
            crate::app_service::RunProcess {
                summary: serde_json::from_value(json!({
                    "runId": "run-1",
                    "runtimeKind": "opencode",
                    "runtimeRoute": {
                        "type": "local_http",
                        "endpoint": format!("http://127.0.0.1:{port}"),
                    },
                    "repoPath": repo_path.to_string_lossy().to_string(),
                    "taskId": "task-1",
                    "branch": "odt/task-1",
                    "worktreePath": repo_path.to_string_lossy().to_string(),
                    "port": port,
                    "state": "running",
                    "lastMessage": null,
                    "startedAt": "2026-03-17T11:00:00Z",
                }))?,
                child: None,
                _runtime_process_guard: None,
                repo_path: repo_path.to_string_lossy().to_string(),
                task_id: "task-1".to_string(),
                worktree_path: repo_path.to_string_lossy().to_string(),
                repo_config: host_infra_system::RepoConfig {
                    branch_prefix: "odt".to_string(),
                    ..Default::default()
                },
            },
        );

    service.task_delete(&repo_path.to_string_lossy(), "task-1", false)?;
    server_handle
        .join()
        .expect("status server thread should finish");
    assert!(service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .is_empty());
    Ok(())
}

#[test]
fn task_reset_implementation_rejects_live_build_session_status_for_in_progress() -> Result<()> {
    assert_task_reset_implementation_rejects_live_build_session_status(TaskStatus::InProgress)
}

#[test]
fn task_reset_implementation_rejects_live_build_session_status_for_blocked() -> Result<()> {
    assert_task_reset_implementation_rejects_live_build_session_status(TaskStatus::Blocked)
}

fn assert_task_reset_implementation_rejects_live_build_session_status(
    status: TaskStatus,
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-live-runtime-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", status);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
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
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"busy"}}"#)?;
    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-1".to_string(),
            crate::app_service::RunProcess {
                summary: serde_json::from_value(json!({
                    "runId": "run-1",
                    "runtimeKind": "opencode",
                    "runtimeRoute": {
                        "type": "local_http",
                        "endpoint": format!("http://127.0.0.1:{port}"),
                    },
                    "repoPath": repo_path.to_string_lossy().to_string(),
                    "taskId": "task-1",
                    "branch": "odt/task-1",
                    "worktreePath": repo_path.to_string_lossy().to_string(),
                    "port": port,
                    "state": "running",
                    "lastMessage": null,
                    "startedAt": "2026-03-17T11:00:00Z",
                }))?,
                child: None,
                _runtime_process_guard: None,
                repo_path: repo_path.to_string_lossy().to_string(),
                task_id: "task-1".to_string(),
                worktree_path: repo_path.to_string_lossy().to_string(),
                repo_config: host_infra_system::RepoConfig {
                    branch_prefix: "odt".to_string(),
                    ..Default::default()
                },
            },
        );

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("live runtime should block reset");
    assert!(error
        .to_string()
        .contains("Cannot reset implementation while"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_reset_implementation_rejects_live_build_session_status_with_stale_run_route_and_repo_runtime_fallback(
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-live-shared-runtime-fallback-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
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
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let stale_route_port = {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        listener.local_addr()?.port()
    };
    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-stale".to_string(),
            crate::app_service::RunProcess {
                summary: serde_json::from_value(json!({
                    "runId": "run-stale",
                    "runtimeKind": "opencode",
                    "runtimeRoute": {
                        "type": "local_http",
                        "endpoint": format!("http://127.0.0.1:{stale_route_port}"),
                    },
                    "repoPath": repo_path.to_string_lossy().to_string(),
                    "taskId": "task-1",
                    "branch": "odt/task-1",
                    "worktreePath": repo_path.to_string_lossy().to_string(),
                    "port": stale_route_port,
                    "state": "running",
                    "lastMessage": null,
                    "startedAt": "2026-03-17T11:00:00Z",
                }))?,
                child: None,
                _runtime_process_guard: None,
                repo_path: repo_path.to_string_lossy().to_string(),
                task_id: "task-1".to_string(),
                worktree_path: repo_path.to_string_lossy().to_string(),
                repo_config: host_infra_system::RepoConfig {
                    branch_prefix: "odt".to_string(),
                    ..Default::default()
                },
            },
        );

    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"busy"}}"#)?;
    insert_workspace_runtime(&service, &repo_path.to_string_lossy(), port)?;

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("live shared-runtime session should block reset");
    assert!(error
        .to_string()
        .contains("Cannot reset implementation while active build session(s) exist"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_reset_implementation_ignores_stale_build_run_when_runtime_session_is_idle() -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-stale-build-run-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let build_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&worktree_base)?;
    fs::create_dir_all(&build_worktree)?;

    let mut task = make_task("task-1", "task", TaskStatus::HumanReview);
    task.document_summary.spec.has = true;
    task.document_summary.plan.has = true;

    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let workspace = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        workspace.path.as_str(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    git_state
        .lock()
        .expect("git state lock poisoned")
        .current_branches_by_path
        .insert(
            build_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
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
        runtime_kind: "opencode".to_string(),
        working_directory: build_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"idle"}}"#)?;
    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-1".to_string(),
            crate::app_service::RunProcess {
                summary: serde_json::from_value(json!({
                    "runId": "run-1",
                    "runtimeKind": "opencode",
                    "runtimeRoute": {
                        "type": "local_http",
                        "endpoint": format!("http://127.0.0.1:{port}"),
                    },
                    "repoPath": workspace.path.clone(),
                    "taskId": "task-1",
                    "branch": "odt/task-1",
                    "worktreePath": build_worktree.to_string_lossy().to_string(),
                    "port": port,
                    "state": "running",
                    "lastMessage": null,
                    "startedAt": "2026-03-17T11:00:00Z",
                }))?,
                child: None,
                _runtime_process_guard: None,
                repo_path: workspace.path.clone(),
                task_id: "task-1".to_string(),
                worktree_path: build_worktree.to_string_lossy().to_string(),
                repo_config: host_infra_system::RepoConfig {
                    branch_prefix: "odt".to_string(),
                    worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                    ..Default::default()
                },
            },
        );

    let updated = service.task_reset_implementation(workspace.path.as_str(), "task-1")?;
    server_handle
        .join()
        .expect("status server thread should finish");

    assert_eq!(updated.status, TaskStatus::ReadyForDev);
    assert!(service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .is_empty());
    Ok(())
}

#[test]
fn task_reset_implementation_ignores_stale_build_run_when_status_endpoint_is_unreachable(
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-stale-build-run-unreachable-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let build_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&worktree_base)?;
    fs::create_dir_all(&build_worktree)?;

    let mut task = make_task("task-1", "task", TaskStatus::HumanReview);
    task.document_summary.spec.has = true;
    task.document_summary.plan.has = true;

    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let workspace = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        workspace.path.as_str(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    git_state
        .lock()
        .expect("git state lock poisoned")
        .current_branches_by_path
        .insert(
            build_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
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
        runtime_kind: "opencode".to_string(),
        working_directory: build_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);

    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-1".to_string(),
            crate::app_service::RunProcess {
                summary: serde_json::from_value(json!({
                    "runId": "run-1",
                    "runtimeKind": "opencode",
                    "runtimeRoute": {
                        "type": "local_http",
                        "endpoint": format!("http://127.0.0.1:{port}"),
                    },
                    "repoPath": workspace.path.clone(),
                    "taskId": "task-1",
                    "branch": "odt/task-1",
                    "worktreePath": build_worktree.to_string_lossy().to_string(),
                    "port": port,
                    "state": "running",
                    "lastMessage": null,
                    "startedAt": "2026-03-17T11:00:00Z",
                }))?,
                child: None,
                _runtime_process_guard: None,
                repo_path: workspace.path.clone(),
                task_id: "task-1".to_string(),
                worktree_path: build_worktree.to_string_lossy().to_string(),
                repo_config: host_infra_system::RepoConfig {
                    branch_prefix: "odt".to_string(),
                    worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                    ..Default::default()
                },
            },
        );

    let updated = service.task_reset_implementation(workspace.path.as_str(), "task-1")?;

    assert_eq!(updated.status, TaskStatus::ReadyForDev);
    assert!(service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .is_empty());
    Ok(())
}

#[test]
fn task_reset_implementation_only_removes_task_managed_worktrees() -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-owned-worktrees-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let managed_worktree = worktree_base.join("task-1");
    let unrelated_worktree = worktree_base.join("user-scratch");
    fs::create_dir_all(&managed_worktree)?;
    fs::create_dir_all(&unrelated_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::AiReview);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![
            GitBranch {
                name: "odt/task-1".to_string(),
                is_current: false,
                is_remote: false,
            },
            GitBranch {
                name: "user/scratch".to_string(),
                is_current: false,
                is_remote: false,
            },
        ],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.current_branches_by_path.insert(
            managed_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
        state.current_branches_by_path.insert(
            unrelated_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("user/scratch".to_string()),
                detached: false,
                revision: None,
            },
        );
    }
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![
        AgentSessionDocument {
            session_id: "build-session".to_string(),
            external_session_id: None,
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: managed_worktree.to_string_lossy().to_string(),
            selected_model: None,
        },
        AgentSessionDocument {
            session_id: "qa-session".to_string(),
            external_session_id: None,
            role: "qa".to_string(),
            scenario: "qa_review".to_string(),
            started_at: "2026-03-17T12:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: unrelated_worktree.to_string_lossy().to_string(),
            selected_model: None,
        },
    ];

    let _ = service.task_reset_implementation(&repo_path.to_string_lossy(), "task-1")?;

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &managed_worktree.to_string_lossy() && *force
    )));
    assert!(!git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, .. }
            if worktree_path == &unrelated_worktree.to_string_lossy()
    )));

    Ok(())
}

#[test]
fn task_reset_implementation_removes_stranded_managed_worktree_when_branch_inspection_fails(
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-stranded-worktree-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let managed_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&managed_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::AiReview);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    git_state
        .lock()
        .expect("git state lock poisoned")
        .current_branch_error_by_path
        .insert(
            managed_worktree.to_string_lossy().to_string(),
            "not a git worktree".to_string(),
        );
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: None,
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: managed_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let _ = service.task_reset_implementation(&repo_path.to_string_lossy(), "task-1")?;

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &managed_worktree.to_string_lossy() && *force
    )));

    Ok(())
}

#[test]
fn task_reset_implementation_propagates_non_worktree_branch_errors_for_managed_worktrees(
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-non-worktree-branch-error-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let managed_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&managed_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::AiReview);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    git_state
        .lock()
        .expect("git state lock poisoned")
        .current_branch_error_by_path
        .insert(
            managed_worktree.to_string_lossy().to_string(),
            "permission denied".to_string(),
        );
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: None,
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: managed_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("non-worktree branch errors should propagate");
    assert!(format!("{error:#}").contains("Failed to inspect implementation worktree branch"));

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(!git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { .. }
    )));

    Ok(())
}

#[test]
fn task_reset_implementation_fails_when_branch_remains_checked_out_in_repo_worktree() -> Result<()>
{
    let repo_path = unique_temp_path("reset-implementation-checked-out-branch-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let build_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&build_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::AiReview);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: true,
            is_remote: false,
        }],
        host_domain::GitCurrentBranch {
            name: Some("odt/task-1".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    git_state
        .lock()
        .expect("git state lock poisoned")
        .current_branches_by_path
        .insert(
            build_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.worktrees = vec![host_domain::GitWorktreeSummary {
            branch: "odt/task-1".to_string(),
            worktree_path: repo_path.to_string_lossy().to_string(),
        }];
    }
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: None,
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: build_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("checked-out task branch should block reset");
    let error_text = format!("{error:#}");
    assert!(error_text.contains("Cannot delete implementation branch"));
    assert!(error_text.contains("still checked out"));
    assert!(error_text.contains("odt/task-1"));
    assert!(error_text.contains(repo_path.to_string_lossy().as_ref()));

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &build_worktree.to_string_lossy() && *force
    )));
    assert!(!git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::DeleteLocalBranch { .. }
    )));

    Ok(())
}

#[test]
fn task_reset_implementation_reports_partial_cleanup_progress_when_branch_delete_fails(
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-branch-failure-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let build_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&build_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::AiReview);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.current_branches_by_path.insert(
            build_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
        state.delete_local_branch_error = Some("branch blocked".to_string());
    }
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: None,
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: build_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("branch deletion failure should report cleanup progress");
    let error_text = format!("{error:#}");
    assert!(error_text.contains("branch blocked"));
    assert!(error_text.contains(build_worktree.to_string_lossy().as_ref()));
    assert!(error_text.contains("Retry reset to finish cleanup safely."));
    let state = task_state.lock().expect("task store lock poisoned");
    assert!(state.cleared_session_roles.is_empty());

    Ok(())
}

#[test]
fn task_reset_implementation_reports_partial_cleanup_progress_when_store_cleanup_fails(
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-store-failure-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let build_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&build_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::AiReview);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    git_state
        .lock()
        .expect("git state lock poisoned")
        .current_branches_by_path
        .insert(
            build_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
    {
        let mut state = task_state.lock().expect("task store lock poisoned");
        state.clear_agent_sessions_error = Some("clear sessions failed".to_string());
        state.agent_sessions = vec![AgentSessionDocument {
            session_id: "build-session".to_string(),
            external_session_id: None,
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: build_worktree.to_string_lossy().to_string(),
            selected_model: None,
        }];
    }

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("store cleanup failure should report cleanup progress");
    let error_text = format!("{error:#}");
    assert!(error_text.contains("clear sessions failed"));
    assert!(error_text.contains(build_worktree.to_string_lossy().as_ref()));
    assert!(error_text.contains("odt/task-1"));
    assert!(error_text.contains("Retry reset to finish cleanup safely."));

    Ok(())
}

#[test]
fn task_reset_implementation_rejects_branch_still_checked_out_in_remaining_worktree() -> Result<()>
{
    let repo_path = unique_temp_path("reset-implementation-checked-out-branch-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let build_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&build_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::AiReview);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.current_branches_by_path.insert(
            build_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
        state.worktrees = vec![host_domain::GitWorktreeSummary {
            branch: "odt/task-1".to_string(),
            worktree_path: repo_path.to_string_lossy().to_string(),
        }];
    }
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: None,
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: build_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("reset should fail when branch stays checked out in another worktree");
    let error_text = format!("{error:#}");
    assert!(
        error_text.contains("Cannot delete implementation branch while it is still checked out")
    );
    assert!(error_text.contains(repo_path.to_string_lossy().as_ref()));
    assert!(error_text.contains("odt/task-1"));

    let state = task_state.lock().expect("task store lock poisoned");
    assert!(state.cleared_session_roles.is_empty());
    drop(state);

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &build_worktree.to_string_lossy() && *force
    )));
    assert!(!git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::DeleteLocalBranch { branch, .. }
            if branch == "odt/task-1"
    )));

    Ok(())
}

#[test]
fn deferred_parent_task_exposes_resume_and_hides_defer() {
    let deferred = make_task("task-1", "task", TaskStatus::Deferred);
    let actions = derive_available_actions(&deferred, std::slice::from_ref(&deferred));
    assert!(actions.contains(&TaskAction::ResumeDeferred));
    assert!(!actions.contains(&TaskAction::DeferIssue));
}

#[test]
fn wait_for_local_server_returns_ok_when_port_is_open() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
    let port = listener.local_addr().expect("addr").port();
    let result = wait_for_local_server(port, Duration::from_millis(500));
    assert!(result.is_ok());
}

fn find_closed_low_port() -> u16 {
    for port in 1..1024 {
        if TcpStream::connect(("127.0.0.1", port)).is_err() {
            return port;
        }
    }
    panic!("expected at least one closed privileged localhost port");
}

#[test]
fn wait_for_local_server_times_out_when_port_is_closed() {
    let port = find_closed_low_port();
    let result = wait_for_local_server(port, Duration::from_millis(250));
    assert!(result.is_err());
}

fn test_startup_policy(timeout: Duration) -> OpencodeStartupReadinessPolicy {
    OpencodeStartupReadinessPolicy {
        timeout,
        connect_timeout: Duration::from_millis(50),
        initial_retry_delay: Duration::from_millis(10),
        max_retry_delay: Duration::from_millis(50),
        child_state_check_interval: Duration::from_millis(25),
    }
}

#[test]
fn opencode_startup_event_payload_contract_includes_correlation_and_metrics() {
    let policy = test_startup_policy(Duration::from_millis(8_000));
    let report = OpencodeStartupWaitReport::from_parts(7, Duration::from_millis(321));
    let mut metrics = OpencodeStartupMetricsSnapshot {
        total: 4,
        ready: 3,
        failed: 1,
        ..OpencodeStartupMetricsSnapshot::default()
    };
    metrics.failed_by_reason.insert("timeout".to_string(), 1);
    if let Some(bucket) = metrics.startup_ms_histogram.get_mut("<=500") {
        *bucket = 4;
    }
    if let Some(bucket) = metrics.attempts_histogram.get_mut("<=10") {
        *bucket = 4;
    }

    let event = StartupEventPayload::ready(
        StartupEventContext::new(
            "agent_runtime",
            "/tmp/repo",
            Some("task-42"),
            "qa",
            4242,
            Some(StartupEventCorrelation::new("runtime_id", "runtime-abc")),
            Some(policy),
        ),
        report,
    );
    let payload = build_opencode_startup_event_payload(
        &event,
        Some(metrics),
        vec!["startup_duration_high:321".to_string()],
    );
    let payload_json = serde_json::to_value(payload).expect("payload should serialize");

    assert_eq!(payload_json["event"], "startup_ready");
    assert_eq!(payload_json["scope"], "agent_runtime");
    assert_eq!(payload_json["repoPath"], "/tmp/repo");
    assert_eq!(payload_json["taskId"], "task-42");
    assert_eq!(payload_json["role"], "qa");
    assert_eq!(payload_json["port"], 4242);
    assert_eq!(payload_json["correlationType"], "runtime_id");
    assert_eq!(payload_json["correlationId"], "runtime-abc");
    assert_eq!(payload_json["policy"]["timeoutMs"], 8_000);
    assert_eq!(payload_json["report"]["startupMs"], 321);
    assert_eq!(payload_json["report"]["attempts"], 7);
    assert_eq!(payload_json["metrics"]["total"], 4);
    assert_eq!(payload_json["metrics"]["ready"], 3);
    assert_eq!(payload_json["metrics"]["failed"], 1);
    assert_eq!(payload_json["alerts"][0], "startup_duration_high:321");
}

#[test]
fn opencode_startup_readiness_policy_uses_config_overrides() -> Result<()> {
    let root = unique_temp_path("startup-policy-config");
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let runtime_config_store = RuntimeConfigStore::from_user_settings_store(&config_store);
    let config = RuntimeConfig {
        runtimes: BTreeMap::from([(
            "opencode".to_string(),
            OpencodeStartupReadinessConfig {
                timeout_ms: 15_345,
                connect_timeout_ms: 456,
                initial_retry_delay_ms: 33,
                max_retry_delay_ms: 99,
                child_check_interval_ms: 77,
            },
        )]),
        ..RuntimeConfig::default()
    };
    runtime_config_store.save(&config)?;

    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: Arc::new(Mutex::new(TaskStoreState::default())),
    });
    let service = AppService::new(task_store, config_store);
    let policy = service.opencode_startup_readiness_policy()?;
    assert_eq!(policy.timeout, Duration::from_millis(15_345));
    assert_eq!(policy.connect_timeout, Duration::from_millis(456));
    assert_eq!(policy.initial_retry_delay, Duration::from_millis(33));
    assert_eq!(policy.max_retry_delay, Duration::from_millis(99));
    assert_eq!(policy.child_state_check_interval, Duration::from_millis(77));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_startup_readiness_policy_returns_actionable_error_on_invalid_config() -> Result<()> {
    let root = unique_temp_path("startup-policy-invalid-config");
    let config_path = root.join("runtime-config.json");
    fs::create_dir_all(&root)?;
    write_private_file(&config_path, "{ invalid json")?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: Arc::new(Mutex::new(TaskStoreState::default())),
    });
    let service = AppService::new(task_store, config_store);
    let error = service
        .opencode_startup_readiness_policy()
        .expect_err("invalid config should fail startup readiness policy load");
    let message = format!("{error:#}");
    assert!(
        message.contains(&format!(
            "Failed loading OpenCode startup readiness config from {}",
            config_path.display()
        )),
        "error should include startup context and config path: {message}"
    );
    assert!(
        message.contains(
            "Fix invalid JSON in this file or delete it so OpenDucktor can recreate defaults"
        ),
        "error should include recovery instruction: {message}"
    );
    assert!(
        message.contains("Failed parsing config file"),
        "error should preserve parse failure context: {message}"
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn resolve_build_startup_policy_emits_config_failure_metrics() -> Result<()> {
    let root = unique_temp_path("build-startup-policy-invalid-config");
    let config_path = root.join("runtime-config.json");
    fs::create_dir_all(&root)?;
    write_private_file(&config_path, "{ invalid json")?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: Arc::new(Mutex::new(TaskStoreState::default())),
    });
    let service = AppService::new(task_store, config_store);
    let error = service
        .resolve_build_startup_policy(
            &AgentRuntimeKind::opencode(),
            "/tmp/repo",
            "task-42",
            "run-abc",
        )
        .expect_err("invalid config should fail build startup policy resolution");
    let message = format!("{error:#}");
    assert!(message.contains("OpenCode build runtime failed before worktree preparation"));
    assert!(message.contains("Failed loading OpenCode startup readiness config"));

    let metrics = service.startup_metrics_snapshot()?;
    assert_eq!(
        metrics.failed_by_reason.get("startup_config_invalid"),
        Some(&1)
    );
    Ok(())
}

#[test]
fn resolve_runtime_startup_policy_emits_config_failure_metrics() -> Result<()> {
    let root = unique_temp_path("runtime-startup-policy-invalid-config");
    let config_path = root.join("runtime-config.json");
    fs::create_dir_all(&root)?;
    write_private_file(&config_path, "{ invalid json")?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: Arc::new(Mutex::new(TaskStoreState::default())),
    });
    let service = AppService::new(task_store, config_store);
    let error = service
        .resolve_runtime_startup_policy(
            &AgentRuntimeKind::opencode(),
            "agent_runtime",
            "/tmp/repo",
            "task-42",
            RuntimeRole::Qa,
            "opencode runtime failed to start for task task-42",
        )
        .expect_err("invalid config should fail runtime startup policy resolution");
    let message = format!("{error:#}");
    assert!(message.contains("opencode runtime failed to start for task task-42"));
    assert!(message.contains("Failed loading OpenCode startup readiness config"));

    let metrics = service.startup_metrics_snapshot()?;
    assert_eq!(
        metrics.failed_by_reason.get("startup_config_invalid"),
        Some(&1)
    );
    Ok(())
}

#[test]
fn terminate_child_process_stops_background_process() {
    let mut child = Command::new("/bin/sh")
        .arg("-lc")
        .arg("sleep 5")
        .spawn()
        .expect("spawn sleep");
    terminate_child_process(&mut child);
    let status = child.try_wait().expect("try_wait should succeed");
    assert!(status.is_some(), "child process should be terminated");
}

#[test]
fn wait_for_local_server_with_process_returns_early_when_child_exits() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
    let port = listener.local_addr().expect("addr").port();
    drop(listener);

    let mut child = Command::new("/bin/sh")
        .arg("-lc")
        .arg("echo startup failed >&2; exit 42")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn failing process");
    let cancel_epoch = Arc::new(AtomicU64::new(0));
    let error = wait_for_local_server_with_process(
        &mut child,
        port,
        test_startup_policy(Duration::from_secs(2)),
        &cancel_epoch,
        0,
        |_| {},
    )
    .expect_err("should report early process exit");
    assert!(error.to_string().contains("startup failed"));
    assert_eq!(error.reason, "child_exited");
}

#[test]
fn wait_for_local_server_with_process_times_out_when_child_stays_alive() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
    let port = listener.local_addr().expect("addr").port();
    drop(listener);

    let mut child = Command::new("/bin/sh")
        .arg("-lc")
        .arg("sleep 5")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn sleeping process");
    let cancel_epoch = Arc::new(AtomicU64::new(0));
    let error = wait_for_local_server_with_process(
        &mut child,
        port,
        test_startup_policy(Duration::from_millis(250)),
        &cancel_epoch,
        0,
        |_| {},
    )
    .expect_err("should time out when child remains alive and port stays closed");
    terminate_child_process(&mut child);
    assert_eq!(error.reason, "timeout");
}

#[test]
fn wait_for_local_server_with_process_honors_total_timeout_budget_when_connect_timeout_is_large() {
    const MAX_PORT_RETRY_ATTEMPTS: usize = 5;

    for attempt in 0..MAX_PORT_RETRY_ATTEMPTS {
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
        let port = listener.local_addr().expect("addr").port();
        drop(listener);

        let mut child = Command::new("/bin/sh")
            .arg("-lc")
            .arg("sleep 5")
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("spawn sleeping process");
        let cancel_epoch = Arc::new(AtomicU64::new(0));
        let started_at = Instant::now();
        let result = wait_for_local_server_with_process(
            &mut child,
            port,
            OpencodeStartupReadinessPolicy {
                timeout: Duration::from_millis(250),
                connect_timeout: Duration::from_secs(10),
                initial_retry_delay: Duration::from_millis(10),
                max_retry_delay: Duration::from_millis(50),
                child_state_check_interval: Duration::from_millis(25),
            },
            &cancel_epoch,
            0,
            |_| {},
        );
        let elapsed = started_at.elapsed();
        terminate_child_process(&mut child);

        match result {
            Err(error) => {
                assert_eq!(error.reason, "timeout");
                assert!(
                    elapsed < Duration::from_secs(2),
                    "startup wait should not exceed total budget window, elapsed={elapsed:?}"
                );
                return;
            }
            Ok(report) if attempt + 1 < MAX_PORT_RETRY_ATTEMPTS => {
                // Some CI hosts can immediately rebind a recently released ephemeral port.
                // Retry with a fresh closed port so the timeout-budget assertion remains deterministic.
                eprintln!(
                    "retrying flaky closed-port probe on reused port {port}, report={report:?}"
                );
            }
            Ok(report) => panic!(
                "total timeout budget should cap each connect attempt; port {port} became reachable in all retries, last report={report:?}"
            ),
        }
    }
}

#[test]
fn wait_for_local_server_with_process_honors_cancellation_epoch() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
    let port = listener.local_addr().expect("addr").port();
    drop(listener);

    let mut child = Command::new("/bin/sh")
        .arg("-lc")
        .arg("sleep 5")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn sleeping process");
    let cancel_epoch = Arc::new(AtomicU64::new(1));
    let snapshot = cancel_epoch.load(Ordering::SeqCst);
    cancel_epoch.fetch_add(1, Ordering::SeqCst);
    let error = wait_for_local_server_with_process(
        &mut child,
        port,
        test_startup_policy(Duration::from_secs(2)),
        &cancel_epoch,
        snapshot,
        |_| {},
    )
    .expect_err("should stop waiting when cancellation epoch changes");
    terminate_child_process(&mut child);
    assert_eq!(error.reason, "cancelled");
}
