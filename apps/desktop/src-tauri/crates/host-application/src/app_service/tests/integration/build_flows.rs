#![allow(unused_imports)]

use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentRuntimeSummary, AgentSessionDocument, CreateTaskInput, GitBranch, GitCurrentBranch,
    GitPort, PlanSubtaskInput, QaReportDocument, QaVerdict, RunEvent, RunState, RunSummary, TaskAction, TaskStatus,
    TaskStore, UpdateTaskPatch,
};
use host_infra_system::{AppConfigStore, GlobalConfig, HookSet, RepoConfig};
use serde_json::Value;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::app_service::build_orchestrator::{BuildResponseAction, CleanupMode};
use crate::app_service::{
    build_opencode_config_content, can_set_plan, default_mcp_workspace_root, parse_mcp_command_json,
    read_opencode_process_registry, read_opencode_version, resolve_mcp_command,
    resolve_opencode_binary_path, terminate_child_process, terminate_process_by_pid,
    validate_parent_relationships_for_update, AgentRuntimeProcess, OpencodeProcessRegistryInstance,
    RunProcess, TrackedOpencodeProcessGuard, OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH,
    with_locked_opencode_process_registry,
};
use crate::app_service::test_support::{
    FakeTaskStore, GitCall, TaskStoreState, build_service_with_git_state, build_service_with_store,
    create_fake_bd, create_fake_opencode, create_failing_opencode,
    create_failing_opencode_with_worktree_cleanup, create_orphanable_opencode, empty_patch,
    init_git_repo, lock_env, make_emitter, make_session, make_task, prepend_path,
    process_is_alive, remove_env_var, set_env_var, spawn_sleep_process, unique_temp_path,
    wait_for_orphaned_opencode_process, wait_for_path_exists, wait_for_process_exit,
    write_executable_script,
};

#[test]
fn build_start_respond_and_cleanup_success_flow() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-success");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        fake_opencode.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("builder-worktrees");
    let (service, task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            hooks: HookSet::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
    let emitter = make_emitter(events.clone());

    let run = service.build_start(repo_path.as_str(), "task-1", emitter.clone())?;
    assert!(matches!(run.state, RunState::Running));
    assert_eq!(service.runs_list(Some(repo_path.as_str()))?.len(), 1);

    let deadline = Instant::now() + Duration::from_secs(5);
    while !events
        .lock()
        .expect("events lock poisoned")
        .iter()
        .any(|event| matches!(event, RunEvent::PermissionRequired { .. }))
    {
        if Instant::now() > deadline {
            return Err(anyhow!("timed out waiting for permission-required event"));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(service.build_respond(
        run.run_id.as_str(),
        BuildResponseAction::Approve,
        Some("Allow git push"),
        emitter.clone()
    )?);

    assert!(service.build_cleanup(run.run_id.as_str(), CleanupMode::Success, emitter.clone())?);
    assert!(service.runs_list(Some(repo_path.as_str()))?.is_empty());

    let state = task_state.lock().expect("task lock poisoned");
    assert!(state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::InProgress)));
    assert!(state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::AiReview)));
    drop(state);

    let emitted = events.lock().expect("events lock poisoned");
    assert!(emitted
        .iter()
        .any(|event| matches!(event, RunEvent::RunStarted { .. })));
    assert!(emitted
        .iter()
        .any(|event| matches!(event, RunEvent::PermissionRequired { .. })));
    assert!(emitted
        .iter()
        .any(|event| matches!(event, RunEvent::ToolExecution { .. })));
    assert!(emitted
        .iter()
        .any(|event| matches!(event, RunEvent::RunFinished { success: true, .. })));
    drop(emitted);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_stop_respond_and_cleanup_failure_paths() -> Result<()> {
    let root = unique_temp_path("build-failure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let (service, task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::InProgress)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );

    let run_id = "run-local".to_string();
    service.runs.lock().expect("run lock poisoned").insert(
        run_id.clone(),
        RunProcess {
            summary: RunSummary {
                run_id: run_id.clone(),
                repo_path: repo_path.clone(),
                task_id: "task-1".to_string(),
                branch: "odt/task-1".to_string(),
                worktree_path: repo_path.clone(),
                port: 1,
                state: RunState::Running,
                last_message: None,
                started_at: "2026-02-20T12:00:00Z".to_string(),
            },
            child: spawn_sleep_process(20),
            _opencode_process_guard: None,
            repo_path: repo_path.clone(),
            task_id: "task-1".to_string(),
            worktree_path: repo_path.clone(),
            repo_config: RepoConfig {
                worktree_base_path: None,
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        },
    );

    let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
    let emitter = make_emitter(events.clone());
    assert!(service.build_respond(
        run_id.as_str(),
        BuildResponseAction::Message,
        Some("note"),
        emitter.clone()
    )?);
    assert!(service.build_respond(
        run_id.as_str(),
        BuildResponseAction::Deny,
        None,
        emitter.clone()
    )?);

    assert!(service.build_stop(run_id.as_str(), emitter.clone())?);
    assert!(service.build_cleanup(run_id.as_str(), CleanupMode::Failure, emitter.clone())?);
    assert!(service.runs_list(Some(repo_path.as_str()))?.is_empty());

    let state = task_state.lock().expect("task lock poisoned");
    assert!(state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::Blocked)));
    drop(state);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_and_cleanup_cover_hook_failure_paths() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-hooks");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        fake_opencode.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("hook-worktrees");
    let (service, task_state, _git_state) = build_service_with_store(
        vec![
            make_task("task-1", "bug", TaskStatus::Open),
            make_task("task-2", "bug", TaskStatus::Open),
        ],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );

    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            hooks: HookSet {
                pre_start: vec!["echo pre-fail >&2; exit 1".to_string()],
                post_complete: Vec::new(),
            },
            agent_defaults: Default::default(),
        },
    )?;

    let pre_start_error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("pre-start failure should fail");
    assert!(pre_start_error
        .to_string()
        .contains("Pre-start hook failed"));

    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            hooks: HookSet {
                pre_start: Vec::new(),
                post_complete: vec!["echo post-fail >&2; exit 1".to_string()],
            },
            agent_defaults: Default::default(),
        },
    )?;

    let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
    let emitter = make_emitter(events.clone());
    let run = service.build_start(repo_path.as_str(), "task-2", emitter.clone())?;
    let cleaned =
        service.build_cleanup(run.run_id.as_str(), CleanupMode::Success, emitter.clone())?;
    assert!(!cleaned, "post-hook failure should report false");

    let invalid_mode = service
        .build_cleanup("run-missing", CleanupMode::Success, emitter)
        .expect_err("unknown mode should fail");
    assert!(invalid_mode.to_string().contains("Run not found"));

    let state = task_state.lock().expect("task lock poisoned");
    assert!(state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::Blocked)));
    drop(state);

    let emitted = events.lock().expect("events lock poisoned");
    assert!(emitted
        .iter()
        .any(|event| matches!(event, RunEvent::PostHookStarted { .. })));
    assert!(emitted
        .iter()
        .any(|event| matches!(event, RunEvent::PostHookFailed { .. })));
    drop(emitted);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_requires_worktree_base_path() -> Result<()> {
    let root = unique_temp_path("build-no-worktree-base");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: None,
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            hooks: HookSet::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("build_start should require worktree base");
    assert!(error
        .to_string()
        .contains("Build blocked: configure repos."));
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_rejects_untrusted_hooks_configuration() -> Result<()> {
    let root = unique_temp_path("build-untrusted-hooks");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: false,
            hooks: HookSet {
                pre_start: vec!["echo pre-hook".to_string()],
                post_complete: Vec::new(),
            },
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("hooks should be rejected when not trusted");
    assert!(error
        .to_string()
        .contains("Hooks are configured but not trusted"));
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_rejects_existing_worktree_directory() -> Result<()> {
    let root = unique_temp_path("build-existing-worktree");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("worktrees");
    let task_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&task_worktree)?;

    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            hooks: HookSet::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("existing worktree path should be rejected");
    assert!(error
        .to_string()
        .contains("Worktree path already exists for task task-1"));
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_reports_opencode_startup_failure() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-startup-failure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let failing_opencode = root.join("opencode");
    create_failing_opencode(&failing_opencode)?;
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        failing_opencode.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            hooks: HookSet::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("startup failure should bubble up");
    let message = error.to_string();
    assert!(message.contains("OpenCode build runtime failed to start"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}
