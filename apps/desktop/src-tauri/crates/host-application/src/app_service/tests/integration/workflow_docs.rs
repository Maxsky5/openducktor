#![allow(unused_imports)]

use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentRuntimeKind, AgentSessionDocument, CreateTaskInput, GitBranch, GitCurrentBranch, GitPort,
    IssueType, PlanSubtaskInput, QaReportDocument, QaVerdict, QaWorkflowVerdict, RunEvent,
    RunState, RunSummary, RuntimeInstanceSummary, TaskAction, TaskStatus, TaskStore,
    UpdateTaskPatch,
};
use host_infra_system::{AppConfigStore, GlobalConfig, HookSet, RepoConfig};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::app_service::build_orchestrator::{BuildResponseAction, CleanupMode};
use crate::app_service::opencode_runtime::test_support::{
    read_opencode_process_registry, with_locked_opencode_process_registry,
    OpencodeProcessRegistryInstance, TrackedOpencodeProcessGuard,
    OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH,
};
use crate::app_service::test_support::{
    build_service_with_git_state, build_service_with_store, builtin_opencode_runtime_route,
    create_failing_opencode, create_fake_bd, create_fake_opencode, create_orphanable_opencode,
    empty_patch, init_git_repo, lock_env, make_emitter, make_session, make_task, prepend_path,
    process_is_alive, remove_env_var, set_env_var, spawn_opencode_session_status_server,
    spawn_sleep_process, unique_temp_path, wait_for_orphaned_opencode_process,
    wait_for_path_exists, wait_for_process_exit, workspace_update_repo_config_by_repo_path,
    write_executable_script, FakeTaskStore, GitCall, TaskStoreState,
};
use crate::app_service::{
    build_opencode_config_content, can_set_plan, default_mcp_workspace_root,
    parse_mcp_command_json, read_opencode_version, resolve_mcp_command,
    resolve_opencode_binary_path, terminate_child_process, terminate_process_by_pid,
    validate_parent_relationships_for_update, AgentRuntimeProcess, RunProcess,
};

#[test]
fn task_update_rejects_direct_status_changes() {
    let repo_path = "/tmp/odt-repo-task-update";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let error = service
        .task_update(
            repo_path,
            "task-1",
            UpdateTaskPatch {
                title: None,
                description: None,
                notes: None,
                status: Some(TaskStatus::Closed),
                priority: None,
                issue_type: None,
                ai_review_enabled: None,
                labels: None,
                assignee: None,
                parent_id: None,
                target_branch: None,
            },
        )
        .expect_err("direct status updates should fail");
    assert!(error
        .to_string()
        .contains("Status cannot be updated directly"));
}

#[test]
fn validate_parent_relationships_for_update_enforces_hierarchy_constraints() {
    let epic = make_task("epic-1", "epic", TaskStatus::Open);
    let current = make_task("task-1", "task", TaskStatus::Open);
    let mut direct_subtask = make_task("sub-1", "task", TaskStatus::Open);
    direct_subtask.parent_id = Some("task-1".to_string());
    let feature_parent = make_task("feature-1", "feature", TaskStatus::Open);
    let mut nested_parent = make_task("nested-parent", "epic", TaskStatus::Open);
    nested_parent.parent_id = Some("epic-1".to_string());

    let tasks = vec![
        epic.clone(),
        current.clone(),
        direct_subtask.clone(),
        feature_parent.clone(),
        nested_parent.clone(),
    ];

    let mut epic_parent_patch = empty_patch();
    epic_parent_patch.parent_id = Some("task-1".to_string());
    let epic_error = validate_parent_relationships_for_update(&tasks, &epic, &epic_parent_patch)
        .expect_err("epic should not become subtask");
    assert!(epic_error
        .to_string()
        .contains("Epics cannot be converted to subtasks."));

    let mut become_subtask_patch = empty_patch();
    become_subtask_patch.parent_id = Some("epic-1".to_string());
    let parent_error =
        validate_parent_relationships_for_update(&tasks, &current, &become_subtask_patch)
            .expect_err("task with direct subtasks cannot become subtask");
    assert!(parent_error
        .to_string()
        .contains("Tasks with subtasks cannot become subtasks."));

    let mut non_epic_patch = empty_patch();
    non_epic_patch.issue_type = Some(IssueType::Feature);
    let type_error = validate_parent_relationships_for_update(&tasks, &current, &non_epic_patch)
        .expect_err("task with direct subtasks must remain epic");
    assert!(type_error
        .to_string()
        .contains("Only epics can have subtasks."));

    let standalone = make_task("standalone", "task", TaskStatus::Open);
    let tasks_for_parent_checks = vec![
        epic.clone(),
        standalone.clone(),
        feature_parent.clone(),
        nested_parent.clone(),
    ];

    let mut bad_parent_patch = empty_patch();
    bad_parent_patch.parent_id = Some("feature-1".to_string());
    let bad_parent_error = validate_parent_relationships_for_update(
        &tasks_for_parent_checks,
        &standalone,
        &bad_parent_patch,
    )
    .expect_err("non-epic parent should be rejected");
    assert!(bad_parent_error
        .to_string()
        .contains("Only epics can be selected as parents."));

    let mut nested_parent_patch = empty_patch();
    nested_parent_patch.parent_id = Some("nested-parent".to_string());
    let nested_parent_error = validate_parent_relationships_for_update(
        &tasks_for_parent_checks,
        &standalone,
        &nested_parent_patch,
    )
    .expect_err("nested parent should be rejected");
    assert!(nested_parent_error
        .to_string()
        .contains("Subtask depth is limited to one level."));

    let mut clear_parent_patch = empty_patch();
    clear_parent_patch.parent_id = Some("   ".to_string());
    let mut current_with_parent = standalone.clone();
    current_with_parent.parent_id = Some("epic-1".to_string());
    assert!(validate_parent_relationships_for_update(
        &tasks_for_parent_checks,
        &current_with_parent,
        &clear_parent_patch,
    )
    .is_ok());
}

#[test]
fn task_delete_blocks_when_subtasks_exist_without_confirmation() {
    let repo_path = "/tmp/odt-repo-task-delete";
    let parent = make_task("parent-1", "epic", TaskStatus::Open);
    let mut child = make_task("child-1", "task", TaskStatus::Open);
    child.parent_id = Some("parent-1".to_string());
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![parent, child],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let error = service
        .task_delete(repo_path, "parent-1", false)
        .expect_err("delete must require subtask confirmation");
    assert!(error.to_string().contains("Confirm subtask deletion"));

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state.delete_calls.is_empty());
}

#[test]
fn task_delete_allows_cascade_and_forwards_delete_flag() -> Result<()> {
    let repo_path = "/tmp/odt-repo-task-delete-cascade";
    fs::create_dir_all(repo_path)?;
    init_git_repo(Path::new(repo_path))?;
    let parent = make_task("parent-1", "epic", TaskStatus::Open);
    let mut child = make_task("child-1", "task", TaskStatus::Open);
    child.parent_id = Some("parent-1".to_string());
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![parent, child],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    service.workspace_add(repo_path)?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path,
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some("/tmp".to_string()),
            branch_prefix: "obp".to_string(),
            default_target_branch: host_infra_system::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "main".to_string(),
            },
            git: Default::default(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            dev_servers: Vec::new(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
            ..Default::default()
        },
    )?;

    service.task_delete(repo_path, "parent-1", true)?;

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.delete_calls,
        vec![("parent-1".to_string(), true)]
    );
    Ok(())
}

#[test]
fn task_delete_removes_managed_worktrees_and_related_branches() -> Result<()> {
    let repo_path = "/tmp/odt-repo-task-delete-cleanup";
    let worktree_path = "/tmp/odt-repo-task-delete-cleanup-worktree";
    fs::create_dir_all(repo_path)?;
    fs::create_dir_all(worktree_path)?;
    init_git_repo(Path::new(repo_path))?;
    let parent = make_task("parent-1", "epic", TaskStatus::Open);
    let mut build_session = make_session("parent-1", "build-session");
    build_session.working_directory = worktree_path.to_string();
    let mut qa_session = make_session("parent-1", "qa-session");
    qa_session.role = "qa".to_string();
    qa_session.scenario = "qa_review".to_string();
    qa_session.working_directory = format!("{worktree_path}/");
    let mut planner_session = make_session("parent-1", "planner-session");
    planner_session.role = "planner".to_string();
    planner_session.scenario = "planner_initial".to_string();
    planner_session.working_directory = repo_path.to_string();
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![parent],
        vec![GitBranch {
            name: "obp/parent-1-cleanup".to_string(),
            is_current: false,
            is_remote: false,
        }],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    service.workspace_add(repo_path)?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path,
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some("/tmp".to_string()),
            branch_prefix: "obp".to_string(),
            default_target_branch: host_infra_system::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "main".to_string(),
            },
            git: Default::default(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            dev_servers: Vec::new(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
            ..Default::default()
        },
    )?;
    git_state
        .lock()
        .expect("git lock poisoned")
        .current_branches_by_path
        .insert(
            worktree_path.to_string(),
            GitCurrentBranch {
                name: Some("obp/parent-1-cleanup".to_string()),
                detached: false,
                revision: None,
            },
        );

    task_state
        .lock()
        .expect("task lock poisoned")
        .agent_sessions = vec![build_session, qa_session, planner_session];

    service.task_delete(repo_path, "parent-1", false)?;

    let git_calls = git_state.lock().expect("git lock poisoned").calls.clone();
    assert!(git_calls
        .iter()
        .any(|call| matches!(call, GitCall::GetBranches { .. })));
    assert!(git_calls
        .iter()
        .any(|call| matches!(call, GitCall::ListWorktrees { .. })));
    assert_eq!(
        git_calls
            .iter()
            .filter(|call| {
                matches!(
                    call,
                    GitCall::RemoveWorktree {
                        repo_path: _,
                        worktree_path: call_worktree_path,
                        force,
                    } if call_worktree_path == worktree_path && *force
                )
            })
            .count(),
        1
    );
    assert_eq!(
        git_calls
            .iter()
            .filter(|call| {
                matches!(
                    call,
                    GitCall::DeleteLocalBranch {
                        repo_path: _,
                        branch,
                        force,
                    } if branch == "obp/parent-1-cleanup" && *force
                )
            })
            .count(),
        1
    );

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.delete_calls,
        vec![("parent-1".to_string(), false)]
    );
    Ok(())
}

#[test]
fn task_delete_rejects_branch_still_checked_out_in_remaining_worktree() -> Result<()> {
    let repo_path = "/tmp/odt-repo-task-delete-checked-out-branch";
    let worktree_path = "/tmp/odt-repo-task-delete-checked-out-branch-worktree";
    fs::create_dir_all(repo_path)?;
    fs::create_dir_all(worktree_path)?;
    init_git_repo(Path::new(repo_path))?;
    let parent = make_task("parent-1", "epic", TaskStatus::Open);
    let mut build_session = make_session("parent-1", "build-session");
    build_session.working_directory = worktree_path.to_string();
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![parent],
        vec![GitBranch {
            name: "obp/parent-1-cleanup".to_string(),
            is_current: false,
            is_remote: false,
        }],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    service.workspace_add(repo_path)?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path,
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some("/tmp".to_string()),
            branch_prefix: "obp".to_string(),
            default_target_branch: host_infra_system::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "main".to_string(),
            },
            git: Default::default(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            dev_servers: Vec::new(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
            ..Default::default()
        },
    )?;
    git_state
        .lock()
        .expect("git lock poisoned")
        .current_branches_by_path
        .insert(
            worktree_path.to_string(),
            GitCurrentBranch {
                name: Some("obp/parent-1-cleanup".to_string()),
                detached: false,
                revision: None,
            },
        );

    task_state
        .lock()
        .expect("task lock poisoned")
        .agent_sessions = vec![build_session];
    git_state.lock().expect("git lock poisoned").worktrees =
        vec![host_domain::GitWorktreeSummary {
            branch: "obp/parent-1-cleanup".to_string(),
            worktree_path: repo_path.to_string(),
        }];

    let error = service
        .task_delete(repo_path, "parent-1", false)
        .expect_err("delete should fail when branch stays checked out in another worktree");
    let error_text = format!("{error:#}");
    assert!(
        error_text.contains("Cannot delete implementation branch while it is still checked out")
    );
    assert!(error_text.contains(repo_path));
    assert!(error_text.contains("obp/parent-1-cleanup"));

    let git_calls = git_state.lock().expect("git lock poisoned").calls.clone();
    assert!(git_calls
        .iter()
        .any(|call| matches!(call, GitCall::RemoveWorktree { worktree_path: call_worktree_path, force, .. } if call_worktree_path == worktree_path && *force)));
    assert!(!git_calls
        .iter()
        .any(|call| matches!(call, GitCall::DeleteLocalBranch { branch, .. } if branch == "obp/parent-1-cleanup")));

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state.delete_calls.is_empty());

    Ok(())
}

#[test]
fn task_delete_cascade_cleans_descendant_worktrees() -> Result<()> {
    let repo_path = "/tmp/odt-repo-task-delete-descendants";
    let child_worktree_path = "/tmp/odt-repo-task-delete-descendants-child";
    fs::create_dir_all(repo_path)?;
    fs::create_dir_all(child_worktree_path)?;
    init_git_repo(Path::new(repo_path))?;
    let parent = make_task("parent-1", "epic", TaskStatus::Open);
    let mut child = make_task("child-1", "task", TaskStatus::Open);
    child.parent_id = Some("parent-1".to_string());
    let mut child_session = make_session("child-1", "child-build-session");
    child_session.working_directory = child_worktree_path.to_string();
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![parent, child],
        vec![GitBranch {
            name: "obp/child-1-cleanup".to_string(),
            is_current: false,
            is_remote: false,
        }],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    service.workspace_add(repo_path)?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path,
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some("/tmp".to_string()),
            branch_prefix: "obp".to_string(),
            default_target_branch: host_infra_system::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "main".to_string(),
            },
            git: Default::default(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            dev_servers: Vec::new(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
            ..Default::default()
        },
    )?;
    git_state
        .lock()
        .expect("git lock poisoned")
        .current_branches_by_path
        .insert(
            child_worktree_path.to_string(),
            GitCurrentBranch {
                name: Some("obp/child-1-cleanup".to_string()),
                detached: false,
                revision: None,
            },
        );

    task_state
        .lock()
        .expect("task lock poisoned")
        .agent_sessions = vec![child_session];

    service.task_delete(repo_path, "parent-1", true)?;

    let git_calls = git_state.lock().expect("git lock poisoned").calls.clone();
    assert!(git_calls.iter().any(|call| {
        matches!(
            call,
            GitCall::RemoveWorktree {
                repo_path: _,
                worktree_path,
                force,
            } if worktree_path == child_worktree_path && *force
        )
    }));
    assert!(git_calls.iter().any(|call| {
        matches!(
            call,
            GitCall::DeleteLocalBranch {
                repo_path: _,
                branch,
                force,
            } if branch == "obp/child-1-cleanup" && *force
        )
    }));
    Ok(())
}

#[test]
fn task_delete_stops_before_store_delete_when_worktree_cleanup_fails() {
    let repo_path = "/tmp/odt-repo-task-delete-worktree-failure";
    let worktree_path = "/tmp/odt-repo-task-delete-worktree-failure-worktree";
    fs::create_dir_all(repo_path).expect("repo directory should be created");
    fs::create_dir_all(worktree_path).expect("worktree directory should be created");
    init_git_repo(Path::new(repo_path)).expect("repo should be initialized");
    let parent = make_task("parent-1", "epic", TaskStatus::Open);
    let mut build_session = make_session("parent-1", "build-session");
    build_session.working_directory = worktree_path.to_string();
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![parent],
        vec![GitBranch {
            name: "obp/parent-1-cleanup".to_string(),
            is_current: false,
            is_remote: false,
        }],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    service
        .workspace_add(repo_path)
        .expect("workspace add should succeed");
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path,
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some("/tmp".to_string()),
            branch_prefix: "obp".to_string(),
            default_target_branch: host_infra_system::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "main".to_string(),
            },
            git: Default::default(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            dev_servers: Vec::new(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
            ..Default::default()
        },
    )
    .expect("repo config update should succeed");
    git_state
        .lock()
        .expect("git lock poisoned")
        .current_branches_by_path
        .insert(
            worktree_path.to_string(),
            GitCurrentBranch {
                name: Some("obp/parent-1-cleanup".to_string()),
                detached: false,
                revision: None,
            },
        );

    task_state
        .lock()
        .expect("task lock poisoned")
        .agent_sessions = vec![build_session];
    let mut git_state = git_state.lock().expect("git lock poisoned");
    git_state.remove_worktree_error = Some("remove failed".to_string());
    drop(git_state);

    let error = service
        .task_delete(repo_path, "parent-1", false)
        .expect_err("task delete should fail when worktree cleanup fails");

    assert!(format!("{error:#}").contains("remove failed"));
    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state.delete_calls.is_empty());
}

#[test]
fn task_delete_rejects_active_builder_runs() {
    let repo_path = "/tmp/odt-repo-task-delete-active-run";
    let worktree_path = "/tmp/odt-repo-task-delete-active-run-worktree";
    fs::create_dir_all(repo_path).expect("repo directory should be created");
    fs::create_dir_all(worktree_path).expect("worktree directory should be created");
    init_git_repo(Path::new(repo_path)).expect("repo should be initialized");
    let parent = make_task("parent-1", "epic", TaskStatus::Open);
    let mut build_session = make_session("parent-1", "build-session");
    build_session.working_directory = worktree_path.to_string();
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![parent],
        vec![GitBranch {
            name: "obp/parent-1-cleanup".to_string(),
            is_current: false,
            is_remote: false,
        }],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    service
        .workspace_add(repo_path)
        .expect("workspace add should succeed");
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path,
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some("/tmp".to_string()),
            branch_prefix: "obp".to_string(),
            default_target_branch: host_infra_system::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "main".to_string(),
            },
            git: Default::default(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            dev_servers: Vec::new(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
            ..Default::default()
        },
    )
    .expect("repo config update should succeed");

    task_state
        .lock()
        .expect("task lock poisoned")
        .agent_sessions = vec![build_session];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"busy"}}"#)
            .expect("status server should start");
    service.runs.lock().expect("run lock poisoned").insert(
        "run-1".to_string(),
        RunProcess {
            summary: RunSummary {
                run_id: "run-1".to_string(),
                runtime_kind: AgentRuntimeKind::opencode(),
                runtime_route: builtin_opencode_runtime_route(port),
                repo_path: repo_path.to_string(),
                task_id: "parent-1".to_string(),
                branch: "obp/parent-1-cleanup".to_string(),
                worktree_path: worktree_path.to_string(),
                port: Some(port),
                state: RunState::Running,
                last_message: None,
                started_at: "2026-02-20T12:00:00Z".to_string(),
            },
            child: Some(spawn_sleep_process(20)),
            _runtime_process_guard: None,
            repo_path: repo_path.to_string(),
            task_id: "parent-1".to_string(),
            worktree_path: worktree_path.to_string(),
            repo_config: RepoConfig {
                default_runtime_kind: "opencode".to_string(),
                worktree_base_path: Some("/tmp".to_string()),
                branch_prefix: "obp".to_string(),
                default_target_branch: host_infra_system::GitTargetBranch {
                    remote: Some("origin".to_string()),
                    branch: "main".to_string(),
                },
                git: Default::default(),
                trusted_hooks: true,
                trusted_hooks_fingerprint: None,
                hooks: HookSet::default(),
                dev_servers: Vec::new(),
                worktree_file_copies: Vec::new(),
                prompt_overrides: Default::default(),
                agent_defaults: Default::default(),
                ..Default::default()
            },
        },
    );

    let error = service
        .task_delete(repo_path, "parent-1", false)
        .expect_err("task delete should fail while a builder run is active");

    assert!(
        format!("{error:#}").contains("Cannot delete tasks with active builder work in progress")
    );
    server_handle
        .join()
        .expect("status server thread should finish");
    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state.delete_calls.is_empty());
    drop(task_state);
    if let Some(mut run) = service
        .runs
        .lock()
        .expect("run lock poisoned")
        .remove("run-1")
    {
        if let Some(child) = run.child.as_mut() {
            terminate_child_process(child);
        }
    }
    let _ = fs::remove_dir_all(worktree_path);
    let _ = fs::remove_dir_all(repo_path);
}

#[test]
fn task_delete_retries_branch_cleanup_after_worktree_was_removed() -> Result<()> {
    let repo_path = "/tmp/odt-repo-task-delete-branch-retry";
    let worktree_path = "/tmp/odt-repo-task-delete-branch-retry-worktree";
    fs::create_dir_all(repo_path)?;
    fs::create_dir_all(worktree_path)?;
    init_git_repo(Path::new(repo_path))?;
    let parent = make_task("parent-1", "epic", TaskStatus::Open);
    let mut build_session = make_session("parent-1", "build-session");
    build_session.working_directory = worktree_path.to_string();
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![parent],
        vec![GitBranch {
            name: "obp/parent-1-cleanup".to_string(),
            is_current: false,
            is_remote: false,
        }],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    service.workspace_add(repo_path)?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path,
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some("/tmp".to_string()),
            branch_prefix: "obp".to_string(),
            default_target_branch: host_infra_system::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "main".to_string(),
            },
            git: Default::default(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            dev_servers: Vec::new(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
            ..Default::default()
        },
    )?;
    git_state
        .lock()
        .expect("git lock poisoned")
        .current_branches_by_path
        .insert(
            worktree_path.to_string(),
            GitCurrentBranch {
                name: Some("obp/parent-1-cleanup".to_string()),
                detached: false,
                revision: None,
            },
        );

    task_state
        .lock()
        .expect("task lock poisoned")
        .agent_sessions = vec![build_session];
    git_state
        .lock()
        .expect("git lock poisoned")
        .delete_local_branch_error = Some("branch blocked".to_string());

    let first_error = service
        .task_delete(repo_path, "parent-1", false)
        .expect_err("first delete should fail on branch cleanup");
    assert!(format!("{first_error:#}").contains("branch blocked"));
    assert!(!Path::new(worktree_path).exists());

    git_state
        .lock()
        .expect("git lock poisoned")
        .delete_local_branch_error = None;

    service.task_delete(repo_path, "parent-1", false)?;

    let git_calls = git_state.lock().expect("git lock poisoned").calls.clone();
    assert_eq!(
        git_calls
            .iter()
            .filter(|call| matches!(call, GitCall::RemoveWorktree { .. }))
            .count(),
        2
    );
    assert_eq!(
        git_calls
            .iter()
            .filter(|call| matches!(call, GitCall::DeleteLocalBranch { .. }))
            .count(),
        2
    );

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.delete_calls,
        vec![("parent-1".to_string(), false)]
    );
    Ok(())
}

#[test]
fn task_delete_only_removes_task_managed_worktrees() -> Result<()> {
    let repo_path = unique_temp_path("task-delete-owned-worktrees-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let managed_worktree = worktree_base.join("task-1");
    let unrelated_worktree = worktree_base.join("user-scratch");
    fs::create_dir_all(&managed_worktree)?;
    fs::create_dir_all(&unrelated_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::Open);
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
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.current_branches_by_path.insert(
            managed_worktree.to_string_lossy().to_string(),
            GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
        state.current_branches_by_path.insert(
            unrelated_worktree.to_string_lossy().to_string(),
            GitCurrentBranch {
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

    service.task_delete(&repo_path.to_string_lossy(), "task-1", false)?;

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(git_calls.iter().any(|call| matches!(
        call,
        GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &managed_worktree.to_string_lossy() && *force
    )));
    assert!(!git_calls.iter().any(|call| matches!(
        call,
        GitCall::RemoveWorktree { worktree_path, .. }
            if worktree_path == &unrelated_worktree.to_string_lossy()
    )));

    Ok(())
}

#[test]
fn task_delete_reports_partial_cleanup_progress_when_store_delete_fails() -> Result<()> {
    let repo_path = unique_temp_path("task-delete-progress-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let managed_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&managed_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::Open);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        RepoConfig {
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
            managed_worktree.to_string_lossy().to_string(),
            GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
    {
        let mut state = task_state.lock().expect("task store lock poisoned");
        state.agent_sessions = vec![AgentSessionDocument {
            session_id: "build-session".to_string(),
            external_session_id: None,
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: managed_worktree.to_string_lossy().to_string(),
            selected_model: None,
        }];
        state.delete_error = Some("store delete failed".to_string());
    }

    let error = service
        .task_delete(&repo_path.to_string_lossy(), "task-1", false)
        .expect_err("task delete should report cleanup progress when store delete fails");

    let error_text = format!("{error:#}");
    assert!(error_text.contains("store delete failed"));
    assert!(error_text.contains("Delete cleanup already removed worktrees"));
    assert!(error_text.contains(managed_worktree.to_string_lossy().as_ref()));
    assert!(error_text.contains("Delete cleanup already deleted branches"));
    assert!(error_text.contains("odt/task-1"));
    assert!(error_text.contains("Retry delete to finish cleanup safely."));

    Ok(())
}

#[test]
fn task_delete_skips_detached_managed_worktree() -> Result<()> {
    let repo_path = unique_temp_path("task-delete-detached-worktree-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let detached_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&detached_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::Open);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        RepoConfig {
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
            detached_worktree.to_string_lossy().to_string(),
            GitCurrentBranch {
                name: None,
                detached: true,
                revision: Some("deadbeef".to_string()),
            },
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
        working_directory: detached_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    service.task_delete(&repo_path.to_string_lossy(), "task-1", false)?;

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(!git_calls.iter().any(|call| matches!(
        call,
        GitCall::RemoveWorktree { worktree_path, .. }
            if worktree_path == &detached_worktree.to_string_lossy()
    )));

    Ok(())
}

#[test]
fn build_blocked_requires_non_empty_reason() {
    let repo_path = "/tmp/odt-repo-build";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::InProgress)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let error = service
        .build_blocked(repo_path, "task-1", Some("   "))
        .expect_err("blank reason should fail");
    assert!(error.to_string().contains("requires a non-empty reason"));
}

#[test]
fn build_resumed_human_actions_and_resume_deferred_paths_work() -> Result<()> {
    let repo_path = "/tmp/odt-repo-human-actions";
    let mut deferred = make_task("task-deferred", "task", TaskStatus::Deferred);
    deferred.parent_id = None;
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![
            make_task("task-blocked", "task", TaskStatus::Blocked),
            make_task("task-human-review", "task", TaskStatus::HumanReview),
            make_task("task-approve", "task", TaskStatus::HumanReview),
            make_task("task-ai-approve", "task", TaskStatus::AiReview),
            deferred,
        ],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let resumed = service.build_resumed(repo_path, "task-blocked")?;
    assert_eq!(resumed.status, TaskStatus::InProgress);

    let requested_changes = service.human_request_changes(repo_path, "task-human-review", None)?;
    assert_eq!(requested_changes.status, TaskStatus::InProgress);

    let approved = service.human_approve(repo_path, "task-approve")?;
    assert_eq!(approved.status, TaskStatus::Closed);

    let ai_review_approved = service.human_approve(repo_path, "task-ai-approve")?;
    assert_eq!(ai_review_approved.status, TaskStatus::Closed);

    let resumed_deferred = service.task_resume_deferred(repo_path, "task-deferred")?;
    assert_eq!(resumed_deferred.status, TaskStatus::Open);
    Ok(())
}

#[test]
fn task_resume_deferred_requires_deferred_state() {
    let repo_path = "/tmp/odt-repo-resume";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let error = service
        .task_resume_deferred(repo_path, "task-1")
        .expect_err("non-deferred task should fail");
    assert!(error.to_string().contains("Task is not deferred"));
}

#[test]
fn tasks_list_enriches_available_actions() -> Result<()> {
    let repo_path = "/tmp/odt-repo-list";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![make_task("feature-1", "feature", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let tasks = service.tasks_list(repo_path)?;
    assert_eq!(tasks.len(), 1);
    assert!(tasks[0].available_actions.contains(&TaskAction::SetSpec));
    assert!(tasks[0]
        .available_actions
        .contains(&TaskAction::ViewDetails));
    Ok(())
}

#[test]
fn task_create_defaults_ai_review_for_typed_issue_type() -> Result<()> {
    let repo_path = "/tmp/odt-repo-create";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let created = service.task_create(
        repo_path,
        CreateTaskInput {
            title: "New task".to_string(),
            issue_type: IssueType::Task,
            priority: 2,
            description: None,
            labels: None,
            ai_review_enabled: None,
            parent_id: None,
        },
    )?;
    assert_eq!(created.issue_type, IssueType::Task);
    assert!(created.ai_review_enabled);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(task_state.created_inputs.len(), 1);
    assert_eq!(task_state.created_inputs[0].issue_type, IssueType::Task);
    assert_eq!(task_state.created_inputs[0].ai_review_enabled, Some(true));
    Ok(())
}

#[test]
fn task_transition_returns_current_task_when_status_is_unchanged() -> Result<()> {
    let repo_path = "/tmp/odt-repo-transition-same";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let task = service.task_transition(repo_path, "task-1", TaskStatus::Open, None)?;
    assert_eq!(task.status, TaskStatus::Open);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state.updated_patches.is_empty());
    Ok(())
}

#[test]
fn task_transition_updates_status_when_valid() -> Result<()> {
    let repo_path = "/tmp/odt-repo-transition-update";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("bug-1", "bug", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let task = service.task_transition(repo_path, "bug-1", TaskStatus::InProgress, None)?;
    assert_eq!(task.status, TaskStatus::InProgress);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(task_state.updated_patches.len(), 1);
    assert_eq!(
        task_state.updated_patches[0].1.status,
        Some(TaskStatus::InProgress)
    );
    Ok(())
}

#[test]
fn build_resumed_uses_targeted_transition_without_listing_tasks() -> Result<()> {
    let repo_path = "/tmp/odt-repo-build-resume-targeted";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-blocked", "task", TaskStatus::Blocked)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    {
        let mut task_state = task_state.lock().expect("task lock poisoned");
        task_state.list_error = Some("targeted transitions should not list tasks".to_string());
    }

    let resumed = service.build_resumed(repo_path, "task-blocked")?;
    assert_eq!(resumed.status, TaskStatus::InProgress);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(task_state.get_task_calls, vec!["task-blocked".to_string()]);
    assert_eq!(task_state.updated_patches.len(), 1);
    assert_eq!(
        task_state.updated_patches[0].1.status,
        Some(TaskStatus::InProgress)
    );
    Ok(())
}

#[test]
fn human_request_changes_uses_targeted_transition_without_listing_tasks() -> Result<()> {
    let repo_path = "/tmp/odt-repo-human-request-changes-targeted";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-review", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    {
        let mut task_state = task_state.lock().expect("task lock poisoned");
        task_state.list_error = Some("targeted transitions should not list tasks".to_string());
    }

    let requested_changes = service.human_request_changes(repo_path, "task-review", None)?;
    assert_eq!(requested_changes.status, TaskStatus::InProgress);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(task_state.get_task_calls, vec!["task-review".to_string()]);
    assert_eq!(task_state.updated_patches.len(), 1);
    assert_eq!(
        task_state.updated_patches[0].1.status,
        Some(TaskStatus::InProgress)
    );
    Ok(())
}

#[test]
fn build_completed_routes_to_ai_review_when_enabled_without_approved_qa() -> Result<()> {
    let repo_path = "/tmp/odt-repo-build-ai";
    let mut task = make_task("task-1", "task", TaskStatus::InProgress);
    task.document_summary.qa_report.has = false;
    task.document_summary.qa_report.verdict = QaWorkflowVerdict::NotReviewed;
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let task = service.build_completed(repo_path, "task-1", Some("done"))?;
    assert_eq!(task.status, TaskStatus::AiReview);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::AiReview)));
    Ok(())
}

#[test]
fn build_completed_routes_to_human_review_when_ai_is_disabled() -> Result<()> {
    let repo_path = "/tmp/odt-repo-build-human";
    let mut task = make_task("task-1", "task", TaskStatus::InProgress);
    task.ai_review_enabled = false;
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let task = service.build_completed(repo_path, "task-1", None)?;
    assert_eq!(task.status, TaskStatus::HumanReview);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::HumanReview)));
    Ok(())
}

#[test]
fn build_completed_routes_to_human_review_when_last_qa_was_approved() -> Result<()> {
    let repo_path = "/tmp/odt-repo-build-human-approved-qa";
    let mut task = make_task("task-1", "task", TaskStatus::InProgress);
    task.ai_review_enabled = true;
    task.document_summary.qa_report.has = true;
    task.document_summary.qa_report.verdict = QaWorkflowVerdict::Approved;
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let task = service.build_completed(repo_path, "task-1", None)?;
    assert_eq!(task.status, TaskStatus::HumanReview);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::HumanReview)));
    Ok(())
}

#[test]
fn task_defer_rejects_subtasks() {
    let repo_path = "/tmp/odt-repo-defer-subtask";
    let mut subtask = make_task("task-1", "task", TaskStatus::Open);
    subtask.parent_id = Some("epic-1".to_string());
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![subtask],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let error = service
        .task_defer(repo_path, "task-1", Some("later"))
        .expect_err("subtasks cannot be deferred");
    assert!(error.to_string().contains("Subtasks cannot be deferred"));
}

#[test]
fn task_defer_transitions_open_parent_task() -> Result<()> {
    let repo_path = "/tmp/odt-repo-defer-parent";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let task = service.task_defer(repo_path, "task-1", Some("later"))?;
    assert_eq!(task.status, TaskStatus::Deferred);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::Deferred)));
    Ok(())
}

#[test]
fn task_defer_rejects_closed_tasks() {
    let repo_path = "/tmp/odt-repo-defer-closed";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::Closed)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let error = service
        .task_defer(repo_path, "task-1", None)
        .expect_err("closed tasks cannot be deferred");
    assert!(error
        .to_string()
        .contains("Only non-closed open-state tasks"));
}

#[test]
fn set_spec_persists_trimmed_markdown_and_transitions_open_task() -> Result<()> {
    let repo_path = "/tmp/odt-repo-spec";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "feature", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let spec = service.set_spec(repo_path, "task-1", "  # Spec  ")?;
    assert_eq!(spec.markdown, "# Spec");

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.spec_set_calls,
        vec![("task-1".to_string(), "# Spec".to_string())]
    );
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::SpecReady)));
    Ok(())
}

#[test]
fn set_spec_allows_ready_for_dev_without_status_transition() -> Result<()> {
    let repo_path = "/tmp/odt-repo-spec-ready";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "feature", TaskStatus::ReadyForDev)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let spec = service.set_spec(repo_path, "task-1", "  # Revised Spec  ")?;
    assert_eq!(spec.markdown, "# Revised Spec");

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.spec_set_calls,
        vec![("task-1".to_string(), "# Revised Spec".to_string())]
    );
    assert!(
        task_state.updated_patches.is_empty(),
        "status update should be skipped when already ready_for_dev"
    );
    Ok(())
}

#[test]
fn set_plan_for_non_epic_transitions_ready_for_dev() -> Result<()> {
    let repo_path = "/tmp/odt-repo-plan-task";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let plan = service.set_plan(repo_path, "task-1", "  # Plan  ", None)?;
    assert_eq!(plan.markdown, "# Plan");

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.plan_set_calls,
        vec![("task-1".to_string(), "# Plan".to_string())]
    );
    assert_eq!(task_state.created_inputs.len(), 0);
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::ReadyForDev)));
    Ok(())
}

#[test]
fn set_plan_allows_feature_from_ready_for_dev_without_status_transition() -> Result<()> {
    let repo_path = "/tmp/odt-repo-plan-feature-ready";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "feature", TaskStatus::ReadyForDev)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let plan = service.set_plan(repo_path, "task-1", "  # Revised Plan  ", None)?;
    assert_eq!(plan.markdown, "# Revised Plan");

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.plan_set_calls,
        vec![("task-1".to_string(), "# Revised Plan".to_string())]
    );
    assert!(
        !task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status.is_some()),
        "status update should be skipped when already ready_for_dev"
    );
    Ok(())
}

#[test]
fn set_plan_rejects_invalid_status_for_feature() {
    let repo_path = "/tmp/odt-repo-plan-invalid";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "feature", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let error = service
        .set_plan(repo_path, "task-1", "# Plan", None)
        .expect_err("feature/open should not allow plan");
    assert!(error.to_string().contains("set_plan is not allowed"));
}

#[test]
fn set_plan_for_epic_replaces_existing_subtasks_with_new_plan_proposals() -> Result<()> {
    let repo_path = "/tmp/odt-repo-plan-epic";
    let epic = make_task("epic-1", "epic", TaskStatus::SpecReady);
    let mut existing_child = make_task("child-1", "task", TaskStatus::Open);
    existing_child.title = "Build API".to_string();
    existing_child.parent_id = Some("epic-1".to_string());

    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![epic, existing_child],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let plan = service.set_plan(
        repo_path,
        "epic-1",
        "# Epic Plan",
        Some(vec![
            PlanSubtaskInput {
                title: "Build API".to_string(),
                issue_type: Some(IssueType::Task),
                priority: Some(2),
                description: None,
            },
            PlanSubtaskInput {
                title: "Build UI".to_string(),
                issue_type: Some(IssueType::Feature),
                priority: Some(2),
                description: Some("Add interface".to_string()),
            },
            PlanSubtaskInput {
                title: "Build UI".to_string(),
                issue_type: Some(IssueType::Feature),
                priority: Some(2),
                description: Some("Duplicate".to_string()),
            },
        ]),
    )?;
    assert_eq!(plan.markdown, "# Epic Plan");

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.delete_calls,
        vec![("child-1".to_string(), false)]
    );
    assert_eq!(task_state.created_inputs.len(), 2);
    assert_eq!(task_state.created_inputs[0].title, "Build API");
    assert_eq!(
        task_state.created_inputs[0].parent_id.as_deref(),
        Some("epic-1")
    );
    assert_eq!(task_state.created_inputs[1].title, "Build UI");
    assert_eq!(
        task_state.created_inputs[1].parent_id.as_deref(),
        Some("epic-1")
    );
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::ReadyForDev)));
    Ok(())
}

#[test]
fn set_plan_for_epic_without_subtasks_preserves_existing_direct_subtasks() -> Result<()> {
    let repo_path = "/tmp/odt-repo-plan-epic-preserve";
    let epic = make_task("epic-1", "epic", TaskStatus::SpecReady);
    let mut existing_child = make_task("child-1", "task", TaskStatus::Open);
    existing_child.parent_id = Some("epic-1".to_string());

    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![epic, existing_child],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let plan = service.set_plan(repo_path, "epic-1", "# Epic Plan", None)?;
    assert_eq!(plan.markdown, "# Epic Plan");

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state.delete_calls.is_empty());
    assert!(task_state.created_inputs.is_empty());
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::ReadyForDev)));
    Ok(())
}

#[test]
fn set_plan_for_epic_rejects_subtask_replacement_when_existing_subtask_is_active() {
    let repo_path = "/tmp/odt-repo-plan-epic-active-subtask";
    let epic = make_task("epic-1", "epic", TaskStatus::SpecReady);
    let mut active_child = make_task("child-1", "task", TaskStatus::InProgress);
    active_child.parent_id = Some("epic-1".to_string());

    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![epic, active_child],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let error = service
        .set_plan(
            repo_path,
            "epic-1",
            "# Epic Plan",
            Some(vec![PlanSubtaskInput {
                title: "Build API".to_string(),
                issue_type: Some(IssueType::Task),
                priority: Some(2),
                description: None,
            }]),
        )
        .expect_err("active direct subtasks must block replacement");
    assert!(
        error
            .to_string()
            .contains("Cannot replace epic subtasks while active work exists"),
        "unexpected error: {error}"
    );

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state.plan_set_calls.is_empty());
    assert!(task_state.delete_calls.is_empty());
    assert!(task_state.created_inputs.is_empty());
}

#[test]
fn qa_get_report_returns_latest_markdown_when_present() -> Result<()> {
    let repo_path = "/tmp/odt-repo-qa-report";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    {
        let mut state = task_state.lock().expect("task lock poisoned");
        state.latest_qa_report = Some(QaReportDocument {
            markdown: "QA body".to_string(),
            verdict: QaWorkflowVerdict::Approved,
            updated_at: Some("2026-02-20T12:00:00Z".to_string()),
            revision: Some(2),
            error: None,
        });
    }

    let report = service.qa_get_report(repo_path, "task-1")?;
    assert_eq!(report.markdown, "QA body");
    assert_eq!(report.updated_at.as_deref(), Some("2026-02-20T12:00:00Z"));
    Ok(())
}

#[test]
fn qa_get_report_returns_empty_when_not_present() -> Result<()> {
    let repo_path = "/tmp/odt-repo-qa-empty";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let report = service.qa_get_report(repo_path, "task-1")?;
    assert!(report.markdown.is_empty());
    assert!(report.updated_at.is_none());
    Ok(())
}

#[test]
fn qa_get_report_preserves_document_level_decode_errors() -> Result<()> {
    let repo_path = "/tmp/odt-repo-qa-error";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    {
        let mut state = task_state.lock().expect("task lock poisoned");
        state.latest_qa_report = Some(QaReportDocument {
            markdown: String::new(),
            verdict: QaWorkflowVerdict::Approved,
            updated_at: Some("2026-02-20T12:00:00Z".to_string()),
            revision: Some(2),
            error: Some(
                "Failed to decode openducktor.documents.qaReports[0]: invalid base64 payload"
                    .to_string(),
            ),
        });
    }

    let report = service.qa_get_report(repo_path, "task-1")?;
    assert!(report.markdown.is_empty());
    assert_eq!(report.updated_at.as_deref(), Some("2026-02-20T12:00:00Z"));
    assert_eq!(report.revision, Some(2));
    assert_eq!(
        report.error.as_deref(),
        Some("Failed to decode openducktor.documents.qaReports[0]: invalid base64 payload"),
    );
    Ok(())
}

#[test]
fn spec_get_and_plan_get_preserve_document_level_decode_errors() -> Result<()> {
    let repo_path = "/tmp/odt-repo-doc-errors";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    {
        let mut state = task_state.lock().expect("task lock poisoned");
        state.metadata_spec = Some(host_domain::SpecDocument {
            markdown: String::new(),
            updated_at: Some("2026-02-20T10:00:00Z".to_string()),
            revision: Some(1),
            error: Some(
                "Failed to decode openducktor.documents.spec[0]: invalid base64 payload"
                    .to_string(),
            ),
        });
        state.metadata_plan = Some(host_domain::SpecDocument {
            markdown: String::new(),
            updated_at: Some("2026-02-20T11:00:00Z".to_string()),
            revision: Some(2),
            error: Some(
                "Failed to decode openducktor.documents.implementationPlan[0]: invalid gzip payload"
                    .to_string(),
            ),
        });
    }

    let spec = service.spec_get(repo_path, "task-1")?;
    assert!(spec.markdown.is_empty());
    assert_eq!(spec.updated_at.as_deref(), Some("2026-02-20T10:00:00Z"));
    assert_eq!(spec.revision, Some(1));
    assert_eq!(
        spec.error.as_deref(),
        Some("Failed to decode openducktor.documents.spec[0]: invalid base64 payload"),
    );

    let plan = service.plan_get(repo_path, "task-1")?;
    assert!(plan.markdown.is_empty());
    assert_eq!(plan.updated_at.as_deref(), Some("2026-02-20T11:00:00Z"));
    assert_eq!(plan.revision, Some(2));
    assert_eq!(
        plan.error.as_deref(),
        Some("Failed to decode openducktor.documents.implementationPlan[0]: invalid gzip payload"),
    );
    Ok(())
}

#[test]
fn spec_get_and_plan_get_use_consolidated_metadata_lookup() -> Result<()> {
    let repo_path = "/tmp/odt-repo-docs-read";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let _ = service.spec_get(repo_path, "task-1")?;
    let _ = service.plan_get(repo_path, "task-1")?;

    let state = task_state.lock().expect("task lock poisoned");
    assert!(state.spec_get_calls.is_empty());
    assert!(state.plan_get_calls.is_empty());
    assert_eq!(
        state.metadata_get_calls,
        vec!["task-1".to_string(), "task-1".to_string()]
    );
    Ok(())
}

#[test]
fn qa_approved_appends_report_and_transitions_to_human_review() -> Result<()> {
    let repo_path = "/tmp/odt-repo-qa-approved";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::AiReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let task = service.qa_approved(repo_path, "task-1", "Looks good")?;
    assert_eq!(task.status, TaskStatus::HumanReview);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.qa_outcome_calls,
        vec![(
            "task-1".to_string(),
            TaskStatus::HumanReview,
            "Looks good".to_string(),
            QaVerdict::Approved
        )]
    );
    assert!(task_state.updated_patches.is_empty());
    Ok(())
}

#[test]
fn qa_approved_from_human_review_stays_in_human_review() -> Result<()> {
    let repo_path = "/tmp/odt-repo-qa-approved-human-review";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let task = service.qa_approved(repo_path, "task-1", "Looks good again")?;
    assert_eq!(task.status, TaskStatus::HumanReview);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.qa_outcome_calls,
        vec![(
            "task-1".to_string(),
            TaskStatus::HumanReview,
            "Looks good again".to_string(),
            QaVerdict::Approved
        )]
    );
    Ok(())
}

#[test]
fn qa_approved_rejects_non_ai_review_tasks() {
    let repo_path = "/tmp/odt-repo-qa-approved-invalid";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::InProgress)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let error = service
        .qa_approved(repo_path, "task-1", "Looks good")
        .expect_err("qa approval should be rejected outside ai_review");

    assert!(error
        .to_string()
        .contains("QA outcomes are only allowed from ai_review or human_review"));
}

#[test]
fn qa_rejected_appends_report_and_transitions_to_in_progress() -> Result<()> {
    let repo_path = "/tmp/odt-repo-qa-rejected";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::AiReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let task = service.qa_rejected(repo_path, "task-1", "Needs work")?;
    assert_eq!(task.status, TaskStatus::InProgress);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.qa_outcome_calls,
        vec![(
            "task-1".to_string(),
            TaskStatus::InProgress,
            "Needs work".to_string(),
            QaVerdict::Rejected
        )]
    );
    assert!(task_state.updated_patches.is_empty());
    Ok(())
}

#[test]
fn qa_rejected_from_human_review_transitions_to_in_progress() -> Result<()> {
    let repo_path = "/tmp/odt-repo-qa-rejected-human-review";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::HumanReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let task = service.qa_rejected(repo_path, "task-1", "Needs another pass")?;
    assert_eq!(task.status, TaskStatus::InProgress);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.qa_outcome_calls,
        vec![(
            "task-1".to_string(),
            TaskStatus::InProgress,
            "Needs another pass".to_string(),
            QaVerdict::Rejected
        )]
    );
    Ok(())
}

#[test]
fn qa_rejected_rejects_non_ai_review_tasks() {
    let repo_path = "/tmp/odt-repo-qa-rejected-invalid";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::InProgress)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let error = service
        .qa_rejected(repo_path, "task-1", "Needs work")
        .expect_err("qa rejection should be rejected outside ai_review");

    assert!(error
        .to_string()
        .contains("QA outcomes are only allowed from ai_review or human_review"));
}

#[test]
fn agent_sessions_list_and_upsert_flow_through_store() -> Result<()> {
    let repo_path = "/tmp/odt-repo-sessions";
    fs::create_dir_all(repo_path)?;
    init_git_repo(Path::new(repo_path))?;
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    service.workspace_add(repo_path)?;
    {
        let mut state = task_state.lock().expect("task lock poisoned");
        let mut existing_session = make_session("task-1", "session-1");
        existing_session.working_directory = repo_path.to_string();
        state.agent_sessions = vec![existing_session];
    }

    let sessions = service.agent_sessions_list(repo_path, "task-1")?;
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_id, "session-1");

    let mut upsert_session = make_session("wrong-task", "session-2");
    upsert_session.working_directory = repo_path.to_string();
    let upserted = service.agent_session_upsert(repo_path, "task-1", upsert_session)?;
    assert!(upserted);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(task_state.upserted_sessions.len(), 1);
    assert_eq!(task_state.upserted_sessions[0].0, "task-1");
    assert_eq!(
        task_state.upserted_sessions[0].1.external_session_id,
        Some("external-session-2".to_string())
    );
    Ok(())
}

#[test]
fn agent_sessions_list_bulk_returns_empty_map_without_store_access() -> Result<()> {
    let repo_path = "/tmp/odt-repo-sessions-bulk-empty";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    {
        let mut state = task_state.lock().expect("task lock poisoned");
        state.list_error = Some("list_tasks should not be called for empty input".to_string());
    }

    let sessions = service.agent_sessions_list_bulk(repo_path, &[])?;

    assert!(sessions.is_empty());
    assert!(task_state
        .lock()
        .expect("task lock poisoned")
        .metadata_get_calls
        .is_empty());
    Ok(())
}

#[test]
fn agent_sessions_list_bulk_reads_task_card_sessions_without_metadata_lookups() -> Result<()> {
    let repo_path = "/tmp/odt-repo-sessions-bulk";
    let mut task_one = make_task("task-1", "task", TaskStatus::Open);
    let mut task_one_newest = make_session("task-1", "session-1-newest");
    task_one_newest.started_at = "2026-02-20T13:00:00Z".to_string();
    let mut task_one_oldest = make_session("task-1", "session-1-oldest");
    task_one_oldest.started_at = "2026-02-20T11:00:00Z".to_string();
    task_one.agent_sessions = vec![task_one_newest.clone(), task_one_oldest.clone()];

    let task_two = make_task("task-2", "task", TaskStatus::Open);

    let mut task_three = make_task("task-3", "task", TaskStatus::Open);
    let mut task_three_session = make_session("task-3", "session-3");
    task_three_session.started_at = "2026-02-20T12:30:00Z".to_string();
    task_three.agent_sessions = vec![task_three_session.clone()];

    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task_one, task_two, task_three],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let sessions = service.agent_sessions_list_bulk(
        repo_path,
        &[
            "task-1".to_string(),
            "task-2".to_string(),
            "task-3".to_string(),
        ],
    )?;

    assert_eq!(sessions.len(), 3);
    assert_eq!(
        sessions
            .get("task-1")
            .expect("task-1 sessions should exist")
            .iter()
            .map(|session| session.session_id.as_str())
            .collect::<Vec<_>>(),
        vec!["session-1-newest", "session-1-oldest"]
    );
    assert!(sessions
        .get("task-2")
        .expect("task-2 sessions should exist")
        .is_empty());
    assert_eq!(
        sessions
            .get("task-3")
            .expect("task-3 sessions should exist")
            .iter()
            .map(|session| session.session_id.as_str())
            .collect::<Vec<_>>(),
        vec![task_three_session.session_id.as_str()]
    );

    assert!(task_state
        .lock()
        .expect("task lock poisoned")
        .metadata_get_calls
        .is_empty());
    Ok(())
}

#[test]
fn agent_sessions_list_bulk_fails_for_missing_task_before_metadata_reads() {
    let repo_path = "/tmp/odt-repo-sessions-bulk-missing";
    let present = make_task("task-1", "task", TaskStatus::Open);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![present],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let error = service
        .agent_sessions_list_bulk(
            repo_path,
            &["task-1".to_string(), "missing-task".to_string()],
        )
        .expect_err("missing task should fail bulk session lookup");

    assert!(error.to_string().contains("Task not found: missing-task"));
    assert!(task_state
        .lock()
        .expect("task lock poisoned")
        .metadata_get_calls
        .is_empty());
}

#[test]
fn agent_session_upsert_rejects_working_directory_outside_repo_and_worktree_base() -> Result<()> {
    let repo_root = unique_temp_path("session-upsert-invalid-workdir");
    let repo = repo_root.join("repo");
    init_git_repo(&repo)?;
    let external = repo_root.join("external");
    fs::create_dir_all(&external)?;

    let config_store = AppConfigStore::from_path(repo_root.join("config.json"));
    let repo_path = fs::canonicalize(&repo)?.to_string_lossy().to_string();
    let (service, task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;

    let mut session = make_session("task-1", "session-invalid");
    session.working_directory = external.to_string_lossy().to_string();

    let error = service
        .agent_session_upsert(repo_path.as_str(), "task-1", session)
        .expect_err("upsert should reject working directories outside repo/worktree base");

    assert!(error.to_string().contains("must stay inside repository"));
    assert!(task_state
        .lock()
        .expect("task lock poisoned")
        .upserted_sessions
        .is_empty());
    Ok(())
}

#[test]
fn agent_session_upsert_rejects_parent_directory_traversal_working_directory() -> Result<()> {
    let repo_root = unique_temp_path("session-upsert-parent-traversal");
    let repo = repo_root.join("repo");
    let external = repo_root.join("external");
    init_git_repo(&repo)?;
    fs::create_dir_all(&external)?;

    let config_store = AppConfigStore::from_path(repo_root.join("config.json"));
    let repo_path = fs::canonicalize(&repo)?.to_string_lossy().to_string();
    let (service, task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;

    let mut session = make_session("task-1", "session-parent-traversal");
    session.working_directory = repo
        .join("..")
        .join("external")
        .to_string_lossy()
        .to_string();

    let error = service
        .agent_session_upsert(repo_path.as_str(), "task-1", session)
        .expect_err("upsert should reject lexical traversal outside the repo");

    assert!(error.to_string().contains("must stay inside repository"));
    assert!(task_state
        .lock()
        .expect("task lock poisoned")
        .upserted_sessions
        .is_empty());
    Ok(())
}

#[test]
fn agent_session_upsert_accepts_working_directory_inside_effective_worktree_base() -> Result<()> {
    let repo_root = unique_temp_path("session-upsert-worktree-base");
    let repo = repo_root.join("repo");
    let worktree_base = repo_root.join("worktrees");
    let worktree = worktree_base.join("task-1");
    init_git_repo(&repo)?;
    fs::create_dir_all(&worktree)?;

    let config_store = AppConfigStore::from_path(repo_root.join("config.json"));
    let repo_path = fs::canonicalize(&repo)?.to_string_lossy().to_string();
    let (service, task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..RepoConfig::default()
        },
    )?;

    let mut session = make_session("task-1", "session-worktree");
    session.working_directory = worktree.to_string_lossy().to_string();

    let upserted = service.agent_session_upsert(repo_path.as_str(), "task-1", session)?;
    assert!(upserted);
    assert_eq!(
        task_state
            .lock()
            .expect("task lock poisoned")
            .upserted_sessions
            .len(),
        1
    );
    Ok(())
}

#[test]
fn agent_session_upsert_accepts_working_directory_inside_default_workspace_worktree_base(
) -> Result<()> {
    let _env_lock = lock_env();
    let repo_root = unique_temp_path("session-upsert-default-worktree-base");
    let home = repo_root.join("home");
    fs::create_dir_all(&home)?;
    let _home_guard = set_env_var("HOME", home.to_string_lossy().as_ref());
    let repo = repo_root.join("repo");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(repo_root.join("config.json"));
    let repo_path = fs::canonicalize(&repo)?.to_string_lossy().to_string();
    let (service, task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let workspace = service.workspace_add(repo_path.as_str())?;
    let worktree = host_infra_system::resolve_default_worktree_base_dir_for_workspace(
        &workspace.workspace_id,
    )?
    .join("task-1");
    fs::create_dir_all(&worktree)?;

    let mut session = make_session("task-1", "session-default-worktree");
    session.working_directory = worktree.to_string_lossy().to_string();

    let upserted = service.agent_session_upsert(repo_path.as_str(), "task-1", session)?;
    assert!(upserted);
    assert_eq!(
        task_state
            .lock()
            .expect("task lock poisoned")
            .upserted_sessions
            .len(),
        1
    );
    Ok(())
}

#[test]
fn agent_session_upsert_accepts_working_directory_inside_legacy_repo_worktree_base() -> Result<()> {
    let _env_lock = lock_env();
    let repo_root = unique_temp_path("session-upsert-legacy-worktree-base");
    let home = repo_root.join("home");
    fs::create_dir_all(&home)?;
    let _home_guard = set_env_var("HOME", home.to_string_lossy().as_ref());
    let repo = repo_root.join("repo");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(repo_root.join("config.json"));
    let repo_path = fs::canonicalize(&repo)?.to_string_lossy().to_string();
    let (service, task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    let legacy_worktree = host_infra_system::resolve_default_worktree_base_dir(Path::new(repo_path.as_str()))?
        .join("task-1");
    fs::create_dir_all(&legacy_worktree)?;

    let mut session = make_session("task-1", "session-legacy-worktree");
    session.working_directory = legacy_worktree.to_string_lossy().to_string();

    let upserted = service.agent_session_upsert(repo_path.as_str(), "task-1", session)?;
    assert!(upserted);
    assert_eq!(
        task_state
            .lock()
            .expect("task lock poisoned")
            .upserted_sessions
            .len(),
        1
    );
    Ok(())
}

#[test]
fn agent_session_upsert_rejects_unknown_role() -> Result<()> {
    let repo_root = unique_temp_path("session-upsert-invalid-role");
    let repo = repo_root.join("repo");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(repo_root.join("config.json"));
    let repo_path = fs::canonicalize(&repo)?.to_string_lossy().to_string();
    let (service, task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;

    let mut session = make_session("task-1", "session-invalid-role");
    session.role = "workspace".to_string();
    session.working_directory = repo_path.clone();

    let error = service
        .agent_session_upsert(repo_path.as_str(), "task-1", session)
        .expect_err("upsert should reject unknown agent session roles");

    assert!(error
        .to_string()
        .contains("role must be one of spec, planner, build, or qa"));
    assert!(task_state
        .lock()
        .expect("task lock poisoned")
        .upserted_sessions
        .is_empty());
    Ok(())
}
