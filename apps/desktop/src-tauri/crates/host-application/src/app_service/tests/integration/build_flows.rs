use anyhow::{anyhow, Context, Result};
use host_domain::{AgentRuntimeKind, RunEvent, RunState, RunSummary, TaskStatus};
use host_infra_system::{AppConfigStore, HookSet, RepoConfig};
#[cfg(unix)]
use std::ffi::OsString;
use std::fs;
#[cfg(unix)]
use std::os::unix::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::support::{test_git_current_branch, test_repo_config};
use crate::app_service::build_orchestrator::{BuildResponseAction, CleanupMode};
#[cfg(not(unix))]
use crate::app_service::test_support::remove_env_var;
use crate::app_service::test_support::{
    build_service_with_store, builtin_opencode_runtime_route, create_failing_opencode,
    create_fake_opencode, init_git_repo, install_fake_dolt, lock_env, make_emitter, make_task,
    repo_config_for_workspace, set_env_var, set_fake_opencode_and_bridge_binaries,
    spawn_sleep_process, unique_temp_path, wait_for_path_exists, wait_for_process_exit,
    workspace_update_repo_config_by_repo_path, write_private_file, EnvVarGuard,
};
use crate::app_service::RunProcess;

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

fn assert_branch_missing(repo_path: &Path, branch: &str) -> Result<()> {
    let output = Command::new("git")
        .current_dir(repo_path)
        .args(["branch", "--list", branch])
        .output()
        .with_context(|| format!("failed listing branch {branch} in {}", repo_path.display()))?;
    if !output.status.success() {
        return Err(anyhow!(
            "git branch --list failed for {branch} in {}",
            repo_path.display()
        ));
    }

    assert!(
        String::from_utf8_lossy(&output.stdout).trim().is_empty(),
        "branch {branch} should have been removed"
    );
    Ok(())
}

#[test]
fn build_start_respond_and_cleanup_success_flow() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-success");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("builder-worktrees");
    let (service, task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        test_git_current_branch(),
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        test_repo_config(Some(worktree_base.as_path())),
    )?;

    let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
    let emitter = make_emitter(events.clone());

    let run = service.build_start(repo_path.as_str(), "task-1", "opencode", emitter.clone())?;
    assert!(matches!(run.state, RunState::Running));
    let worktree_path = PathBuf::from(run.worktree_path.clone());
    assert_eq!(service.runs_list(Some(repo_path.as_str()))?.len(), 1);

    assert!(service.build_respond(
        run.run_id.as_str(),
        BuildResponseAction::Approve,
        Some("Allow git push"),
        emitter.clone()
    )?);

    assert!(service.build_cleanup(run.run_id.as_str(), CleanupMode::Success, emitter.clone())?);
    assert!(service.runs_list(Some(repo_path.as_str()))?.is_empty());
    assert!(
        worktree_path.exists(),
        "builder worktree should be retained while the task is under review"
    );

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
        .any(|event| matches!(event, RunEvent::AgentThought { .. })));
    assert!(emitted
        .iter()
        .any(|event| matches!(event, RunEvent::RunFinished { success: true, .. })));
    assert!(emitted.iter().any(|event| matches!(
        event,
        RunEvent::RunFinished {
            success: true,
            message,
            ..
        } if message.contains("builder worktree retained")
    )));
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
    let _dolt_guard = install_fake_dolt(&root)?;
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());

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
        test_git_current_branch(),
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            default_target_branch: host_infra_system::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "develop".to_string(),
            },
            git: Default::default(),
            hooks: HookSet::default(),
            dev_servers: Vec::new(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
            ..Default::default()
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
fn build_start_fails_when_task_target_remote_branch_is_unavailable_even_if_local_branch_exists(
) -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-task-target-branch-unavailable");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());

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
    run_command_in(
        repo.as_path(),
        "git",
        &["branch", "-D", "-r", "origin/develop"],
    )?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("builder-worktrees");
    let (service, task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        test_git_current_branch(),
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        test_repo_config(Some(worktree_base.as_path())),
    )?;
    task_state.lock().expect("task state lock poisoned").tasks[0].target_branch =
        Some(host_domain::GitTargetBranch {
            remote: Some("origin".to_string()),
            branch: "develop".to_string(),
        });

    let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
    let emitter = make_emitter(events);
    let error = service
        .build_start(repo_path.as_str(), "task-1", "opencode", emitter)
        .expect_err("missing recorded remote-tracking branch should fail");

    assert!(error
        .to_string()
        .contains("Configured target branch is unavailable for build worktree creation"));
    assert!(error.to_string().contains("origin/develop"));
    assert!(!worktree_base.join("task-1").exists());

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_copies_configured_worktree_files_into_new_worktree() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-copy-configured-files");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    write_private_file(repo.join(".env").as_path(), "API_KEY=builder-secret\n")?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("builder-worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        test_git_current_branch(),
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            default_target_branch: host_infra_system::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "main".to_string(),
            },
            git: Default::default(),
            hooks: HookSet::default(),
            dev_servers: Vec::new(),
            worktree_file_copies: vec![".env".to_string()],
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
            ..Default::default()
        },
    )?;

    let emitter = make_emitter(Arc::new(Mutex::new(Vec::new())));
    let run = service.build_start(repo_path.as_str(), "task-1", "opencode", emitter.clone())?;
    let worktree_path = Path::new(run.worktree_path.as_str());
    assert_eq!(
        fs::read_to_string(worktree_path.join(".env"))?,
        "API_KEY=builder-secret\n"
    );

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
        test_git_current_branch(),
        config_store,
    );

    let run_id = "run-local".to_string();
    service.runs.lock().expect("run lock poisoned").insert(
        run_id.clone(),
        RunProcess {
            summary: RunSummary {
                run_id: run_id.clone(),
                runtime_kind: AgentRuntimeKind::opencode(),
                runtime_route: builtin_opencode_runtime_route(1),
                repo_path: repo_path.clone(),
                task_id: "task-1".to_string(),
                branch: "odt/task-1".to_string(),
                worktree_path: repo_path.clone(),
                port: Some(1),
                state: RunState::Running,
                last_message: None,
                started_at: "2026-02-20T12:00:00Z".to_string(),
            },
            child: Some(spawn_sleep_process(20)),
            _runtime_process_guard: None,
            repo_path: repo_path.clone(),
            task_id: "task-1".to_string(),
            worktree_path: repo_path.clone(),
            repo_config: test_repo_config(None),
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
    assert!(
        state.updated_patches.iter().any(
            |(task_id, patch)| task_id == "task-1" && patch.status == Some(TaskStatus::Blocked)
        ),
        "run failure should block the active task"
    );
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
    let _dolt_guard = install_fake_dolt(&root)?;
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("hook-worktrees");
    let (service, task_state, _git_state) = build_service_with_store(
        vec![
            make_task("task-1", "bug", TaskStatus::Open),
            make_task("task-2", "bug", TaskStatus::Open),
        ],
        vec![],
        test_git_current_branch(),
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;

    let pre_start_failure_hooks = HookSet {
        pre_start: vec!["sh -lc 'echo pre-fail >&2; exit 1'".to_string()],
        post_complete: Vec::new(),
    };
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            default_target_branch: host_infra_system::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "main".to_string(),
            },
            git: Default::default(),
            hooks: pre_start_failure_hooks,
            dev_servers: Vec::new(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
            ..Default::default()
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
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            default_target_branch: host_infra_system::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "main".to_string(),
            },
            git: Default::default(),
            hooks: post_complete_failure_hooks,
            dev_servers: Vec::new(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
            ..Default::default()
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
    assert!(
        state
            .updated_patches
            .iter()
            .all(|(task_id, _)| task_id != "task-1"),
        "pre-start hook failure should not update task status before the build starts"
    );
    assert!(
        state.updated_patches.iter().any(|(task_id, patch)| {
            task_id == "task-2" && patch.status == Some(TaskStatus::InProgress)
        }),
        "successful build start should move task-2 into progress"
    );
    assert!(
        state.updated_patches.iter().any(
            |(task_id, patch)| task_id == "task-2" && patch.status == Some(TaskStatus::Blocked)
        ),
        "post-complete hook failure should block task-2"
    );
    drop(state);

    let failed_branch = host_infra_system::build_branch_name("odt", "task-1", "Task task-1");
    assert_branch_missing(repo.as_path(), failed_branch.as_str())?;

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
fn build_start_cleans_up_when_configured_worktree_file_copy_fails() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-copy-configured-files-failure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("builder-worktrees");
    let (service, task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        test_git_current_branch(),
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            default_target_branch: host_infra_system::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "main".to_string(),
            },
            git: Default::default(),
            hooks: HookSet::default(),
            dev_servers: Vec::new(),
            worktree_file_copies: vec![".env".to_string()],
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
            ..Default::default()
        },
    )?;

    let error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            "opencode",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("missing configured worktree file should fail build startup");
    let message = error.to_string();
    assert!(message.contains("Configured worktree file copy failed"));
    assert!(message.contains(".env"));
    assert!(
        !worktree_base.join("task-1").exists(),
        "failed worktree setup should clean up the created worktree"
    );

    let state = task_state.lock().expect("task lock poisoned");
    assert!(
        state
            .updated_patches
            .iter()
            .all(|(task_id, _)| task_id != "task-1"),
        "configured file copy failure should not change task status before build start"
    );
    drop(state);

    let failed_branch = host_infra_system::build_branch_name("odt", "task-1", "Task task-1");
    assert_branch_missing(repo.as_path(), failed_branch.as_str())?;

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_uses_default_effective_worktree_base_path() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-default-worktree-base");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let home = root.join("home");
    fs::create_dir_all(&home)?;
    let _home_guard = set_env_var("HOME", home.to_string_lossy().as_ref());
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let expected_worktree_base =
        host_infra_system::resolve_default_worktree_base_dir_for_workspace("repo")?;
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        test_git_current_branch(),
        config_store,
    );
    let workspace = service.workspace_add(repo_path.as_str())?;
    service.workspace_update_repo_config(
        workspace.workspace_id.as_str(),
        repo_config_for_workspace(&workspace, test_repo_config(None)),
    )?;

    let emitter = make_emitter(Arc::new(Mutex::new(Vec::new())));
    let run = service.build_start(repo_path.as_str(), "task-1", "opencode", emitter.clone())?;
    assert_eq!(
        Path::new(run.worktree_path.as_str()),
        expected_worktree_base.join("task-1")
    );

    assert!(service.build_stop(run.run_id.as_str(), emitter.clone())?);
    assert!(service.build_cleanup(run.run_id.as_str(), CleanupMode::Failure, emitter)?);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_reports_home_or_override_guidance_when_default_worktree_resolution_fails(
) -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-missing-home-worktree-guidance");
    let repo = root.join("repo");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let config_path = config_store.path().display().to_string();
    let repo_path = repo.to_string_lossy().to_string();
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        test_git_current_branch(),
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        test_repo_config(None),
    )?;

    #[cfg(unix)]
    let _home_guard = EnvVarGuard::set_os("HOME", OsString::from_vec(vec![0xFF]));
    #[cfg(not(unix))]
    let _home_guard = remove_env_var("HOME");

    let error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            "opencode",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("missing HOME should fail default worktree resolution");
    let message = error.to_string();
    assert!(
        message.contains("Build blocked: unable to resolve effective worktree base path")
            || message.contains("Build blocked: effective worktree base path must be valid UTF-8")
    );
    assert!(message.contains("Ensure HOME is set or configure"));
    assert!(message.contains("worktreeBasePath"));
    assert!(message.contains(config_path.as_str()));

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
        test_git_current_branch(),
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        test_repo_config(Some(worktree_base.as_path())),
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
fn build_start_uses_targeted_task_reads_instead_of_listing_all_tasks() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-targeted-task-read");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("worktrees");
    let (service, task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        test_git_current_branch(),
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        test_repo_config(Some(worktree_base.as_path())),
    )?;

    {
        let mut state = task_state.lock().expect("task lock poisoned");
        state.list_error = Some("build start should not enumerate the full task list".to_string());
    }

    let emitter = make_emitter(Arc::new(Mutex::new(Vec::new())));
    let run = service.build_start(repo_path.as_str(), "task-1", "opencode", emitter.clone())?;
    assert!(matches!(run.state, RunState::Running));

    {
        let state = task_state.lock().expect("task lock poisoned");
        assert!(
            !state.get_task_calls.is_empty(),
            "build_start should perform targeted task lookups"
        );
        assert!(
            state.get_task_calls.iter().all(|id| id == "task-1"),
            "build_start should only fetch the requested task id"
        );
    }

    {
        let mut state = task_state.lock().expect("task lock poisoned");
        state.list_error = None;
    }

    assert!(service.build_stop(run.run_id.as_str(), emitter.clone())?);
    assert!(service.build_cleanup(run.run_id.as_str(), CleanupMode::Failure, emitter)?);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_reports_missing_task_from_targeted_lookup() -> Result<()> {
    let root = unique_temp_path("build-missing-task");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("worktrees");
    let (service, _task_state, _git_state) =
        build_service_with_store(Vec::new(), vec![], test_git_current_branch(), config_store);
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        test_repo_config(Some(worktree_base.as_path())),
    )?;

    let error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            "opencode",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("missing task should fail targeted lookup");
    assert_eq!(error.to_string(), "Task not found: task-1");

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_preserves_transition_validation_with_targeted_lookup() -> Result<()> {
    let root = unique_temp_path("build-invalid-transition");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "feature", TaskStatus::Open)],
        vec![],
        test_git_current_branch(),
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        test_repo_config(Some(worktree_base.as_path())),
    )?;

    let error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            "opencode",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("feature should still require ready_for_dev before build start");
    assert!(error
        .to_string()
        .contains("Transition not allowed for task-1 (feature): open -> in_progress"));

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
    let fake_bridge = root.join("browser-backend");
    create_failing_opencode(&failing_opencode)?;
    create_fake_opencode(&fake_bridge)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        failing_opencode.to_string_lossy().as_ref(),
    );
    let _bridge_guard = set_env_var(
        "OPENDUCKTOR_MCP_BRIDGE_BINARY",
        fake_bridge.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        test_git_current_branch(),
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        test_repo_config(Some(worktree_base.as_path())),
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
    assert!(message.contains("opencode build runtime failed to start"));

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
        test_git_current_branch(),
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        test_repo_config(Some(worktree_base.as_path())),
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
    let _dolt_guard = install_fake_dolt(&root)?;
    let pid_file = root.join("spawned-build.pid");
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());
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
        test_git_current_branch(),
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        repo_path.as_str(),
        test_repo_config(Some(worktree_base.as_path())),
    )?;

    let shared_runtime = service.runtime_ensure("opencode", repo_path.as_str())?;
    assert!(wait_for_path_exists(
        pid_file.as_path(),
        Duration::from_secs(2)
    ));
    let shared_pid = fs::read_to_string(pid_file.as_path())?
        .trim()
        .parse::<i32>()
        .expect("shared runtime pid should parse as i32");

    let build_error = std::thread::scope(|scope| -> Result<anyhow::Error> {
        let build_handle = scope.spawn(|| {
            service.build_start(
                repo_path.as_str(),
                "task-1",
                "opencode",
                make_emitter(Arc::new(Mutex::new(Vec::new()))),
            )
        });

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
        Ok(build_error)
    })?;
    assert!(build_error.to_string().contains("Run state lock poisoned"));
    assert!(
        !wait_for_process_exit(shared_pid, Duration::from_millis(250)),
        "shared repo runtime should remain alive when build registration fails"
    );
    assert!(service.runtime_stop(shared_runtime.runtime_id.as_str())?);

    let _ = fs::remove_dir_all(root);
    Ok(())
}
