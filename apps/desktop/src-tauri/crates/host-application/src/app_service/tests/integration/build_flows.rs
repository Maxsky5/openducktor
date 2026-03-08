#![allow(unused_imports)]

use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentRuntimeKind, RuntimeInstanceSummary, AgentSessionDocument, CreateTaskInput, GitBranch,
    GitCurrentBranch, GitPort, PlanSubtaskInput, QaReportDocument, QaVerdict, RunEvent, RunState,
    RunSummary, TaskAction, TaskStatus, TaskStore, UpdateTaskPatch,
};
use host_infra_system::{hook_set_fingerprint, AppConfigStore, GlobalConfig, HookSet, RepoConfig};
use serde_json::Value;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::app_service::build_orchestrator::{BuildResponseAction, CleanupMode};
use crate::app_service::test_support::{
    build_service_with_git_state, build_service_with_store, create_failing_opencode,
    create_failing_opencode_with_worktree_cleanup, create_fake_bd, create_fake_opencode,
    create_orphanable_opencode, empty_patch, init_git_repo, lock_env, make_emitter, make_session,
    make_task, prepend_path, process_is_alive, remove_env_var, set_env_var, spawn_sleep_process,
    unique_temp_path, wait_for_orphaned_opencode_process, wait_for_path_exists,
    wait_for_process_exit, write_executable_script, write_private_file, FakeTaskStore, GitCall,
    TaskStoreState,
};
use crate::app_service::{
    build_opencode_config_content, can_set_plan, default_mcp_workspace_root,
    parse_mcp_command_json, read_opencode_process_registry, read_opencode_version,
    resolve_mcp_command, resolve_opencode_binary_path, terminate_child_process,
    terminate_process_by_pid, validate_parent_relationships_for_update,
    with_locked_opencode_process_registry, AgentRuntimeProcess, OpencodeProcessRegistryInstance,
    RunProcess, TrackedOpencodeProcessGuard, OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH,
};

fn run_command_in(current_dir: &Path, program: &str, args: &[&str]) -> Result<()> {
    let status = Command::new(program)
        .current_dir(current_dir)
        .args(args)
        .status()
        .with_context(|| {
            format!(
                "failed running {} in {} with args {:?}",
                program,
                current_dir.display(),
                args
            )
        })?;
    if status.success() {
        return Ok(());
    }

    Err(anyhow!(
        "{} {:?} failed in {} with status {}",
        program,
        args,
        current_dir.display(),
        status
    ))
}

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
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            default_target_branch: "origin/main".to_string(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
    let emitter = make_emitter(events.clone());

    let run = service.build_start(repo_path.as_str(), "task-1", "opencode", emitter.clone())?;
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
    let ready_for_review_index = emitted
        .iter()
        .position(|event| matches!(event, RunEvent::ReadyForManualDoneConfirmation { .. }))
        .expect("ready-for-review event should be emitted");
    let run_finished_index = emitted
        .iter()
        .position(|event| matches!(event, RunEvent::RunFinished { success: true, .. }))
        .expect("successful run-finished event should be emitted");
    assert!(
        ready_for_review_index < run_finished_index,
        "ready-for-review event should be emitted before run-finished"
    );
    drop(emitted);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_bases_worktree_on_configured_target_branch() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-target-branch");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        fake_opencode.to_string_lossy().as_ref(),
    );

    let remote = root.join("remote.git");
    let remote_path = remote.to_string_lossy().to_string();
    run_command_in(
        root.as_path(),
        "git",
        &["init", "--bare", remote_path.as_str()],
    )?;
    run_command_in(
        repo.as_path(),
        "git",
        &["remote", "add", "origin", remote_path.as_str()],
    )?;
    run_command_in(repo.as_path(), "git", &["push", "-u", "origin", "main"])?;

    run_command_in(repo.as_path(), "git", &["checkout", "-b", "develop"])?;
    fs::write(repo.join("develop-only.txt"), "develop\n")?;
    run_command_in(repo.as_path(), "git", &["add", "develop-only.txt"])?;
    run_command_in(repo.as_path(), "git", &["commit", "-m", "develop base"])?;
    run_command_in(repo.as_path(), "git", &["push", "-u", "origin", "develop"])?;

    run_command_in(repo.as_path(), "git", &["checkout", "main"])?;
    fs::write(repo.join("main-only.txt"), "main\n")?;
    run_command_in(repo.as_path(), "git", &["add", "main-only.txt"])?;
    run_command_in(repo.as_path(), "git", &["commit", "-m", "main only"])?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("builder-worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            default_target_branch: "origin/develop".to_string(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
    let emitter = make_emitter(events.clone());
    let run = service.build_start(repo_path.as_str(), "task-1", "opencode", emitter.clone())?;
    let worktree_path = Path::new(run.worktree_path.as_str());
    assert!(worktree_path.join("develop-only.txt").exists());
    assert!(!worktree_path.join("main-only.txt").exists());

    assert!(service.build_stop(run.run_id.as_str(), emitter.clone())?);
    assert!(service.build_cleanup(run.run_id.as_str(), CleanupMode::Failure, emitter)?);

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
            revision: None,
        },
        config_store,
    );

    let run_id = "run-local".to_string();
    service.runs.lock().expect("run lock poisoned").insert(
        run_id.clone(),
        RunProcess {
            summary: RunSummary {
                run_id: run_id.clone(),
                runtime_kind: AgentRuntimeKind::Opencode,
                runtime_route: AgentRuntimeKind::Opencode.route_for_port(1),
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
                default_runtime_kind: "opencode".to_string(),
                worktree_base_path: None,
                branch_prefix: "odt".to_string(),
                default_target_branch: "origin/main".to_string(),
                trusted_hooks: true,
                trusted_hooks_fingerprint: None,
                hooks: HookSet::default(),
                worktree_file_copies: Vec::new(),
                prompt_overrides: Default::default(),
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
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;

    let pre_start_failure_hooks = HookSet {
        pre_start: vec!["sh -lc 'echo pre-fail >&2; exit 1'".to_string()],
        post_complete: Vec::new(),
    };
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            default_target_branch: "origin/main".to_string(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: Some(hook_set_fingerprint(&pre_start_failure_hooks)),
            hooks: pre_start_failure_hooks,
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let pre_start_error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            "opencode",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("pre-start failure should fail");
    assert!(pre_start_error
        .to_string()
        .contains("Worktree setup script command failed"));

    let post_complete_failure_hooks = HookSet {
        pre_start: Vec::new(),
        post_complete: vec!["sh -lc 'echo post-fail >&2; exit 1'".to_string()],
    };
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            default_target_branch: "origin/main".to_string(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: Some(hook_set_fingerprint(&post_complete_failure_hooks)),
            hooks: post_complete_failure_hooks,
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
    let emitter = make_emitter(events.clone());
    let run = service.build_start(repo_path.as_str(), "task-2", "opencode", emitter.clone())?;
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
    let post_hook_started_index = emitted
        .iter()
        .position(|event| matches!(event, RunEvent::PostHookStarted { .. }))
        .expect("post-hook-started event should be emitted");
    let post_hook_failed_index = emitted
        .iter()
        .position(|event| matches!(event, RunEvent::PostHookFailed { .. }))
        .expect("post-hook-failed event should be emitted");
    assert!(
        post_hook_started_index < post_hook_failed_index,
        "post-hook-started event should be emitted before post-hook-failed"
    );
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
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: None,
            branch_prefix: "odt".to_string(),
            default_target_branch: "origin/main".to_string(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            "opencode",
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
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            default_target_branch: "origin/main".to_string(),
            trusted_hooks: false,
            trusted_hooks_fingerprint: None,
            hooks: HookSet {
                pre_start: vec!["echo pre-hook".to_string()],
                post_complete: Vec::new(),
            },
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            "opencode",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("hooks should be rejected when not trusted");
    assert!(error
        .to_string()
        .contains("Scripts are configured but not trusted"));
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
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            default_target_branch: "origin/main".to_string(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            "opencode",
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
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            default_target_branch: "origin/main".to_string(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            "opencode",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("startup failure should bubble up");
    let message = error.to_string();
    assert!(message.contains("OpenCode build runtime failed to start"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_fails_on_invalid_startup_config_before_worktree_creation() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-invalid-startup-config");
    let repo = root.join("repo");
    init_git_repo(&repo)?;

    let config_path = root.join("config.json");
    let config_store = AppConfigStore::from_path(config_path.clone());
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            default_target_branch: "origin/main".to_string(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
        },
    )?;

    write_private_file(&config_path, "{ invalid json")?;

    let error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            "opencode",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("invalid config should fail build start before worktree preparation");
    let message = error.to_string();
    assert!(message.contains("Failed parsing config file"));
    assert!(
        !worktree_base.join("task-1").exists(),
        "worktree should not be created when startup config is invalid"
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_stops_spawned_child_when_run_state_lock_is_poisoned() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-run-lock-poison");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let pid_file = root.join("spawned-build.pid");
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        fake_opencode.to_string_lossy().as_ref(),
    );
    let _delay_guard = set_env_var("OPENDUCKTOR_TEST_STARTUP_DELAY_MS", "800");
    let _pid_guard = set_env_var(
        "OPENDUCKTOR_TEST_PID_FILE",
        pid_file.to_string_lossy().as_ref(),
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
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            default_target_branch: "origin/main".to_string(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let build_error = std::thread::scope(|scope| -> Result<anyhow::Error> {
        let build_handle = scope.spawn(|| {
            service.build_start(
                repo_path.as_str(),
                "task-1",
                "opencode",
                make_emitter(Arc::new(Mutex::new(Vec::new()))),
            )
        });

        assert!(wait_for_path_exists(
            pid_file.as_path(),
            Duration::from_secs(2)
        ));
        let spawned_pid = fs::read_to_string(pid_file.as_path())?
            .trim()
            .parse::<i32>()
            .expect("spawned build pid should parse as i32");

        let poison_handle = scope.spawn(|| {
            let _lock = service
                .runs
                .lock()
                .expect("run lock should be available for poisoning");
            panic!("poison run lock");
        });
        assert!(poison_handle.join().is_err());

        let build_error = build_handle
            .join()
            .expect("build thread should join")
            .expect_err("build_start should fail when run lock is poisoned");
        assert!(wait_for_process_exit(spawned_pid, Duration::from_secs(2)));
        Ok(build_error)
    })?;
    assert!(build_error.to_string().contains("Run state lock poisoned"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}
