#![allow(unused_imports)]

use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentRuntimeSummary, AgentSessionDocument, CreateTaskInput, GitBranch, GitCurrentBranch,
    GitPort, PlanSubtaskInput, QaReportDocument, QaVerdict, RunEvent, RunState, RunSummary, TaskAction, TaskStatus,
    TaskStore, UpdateTaskPatch,
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
fn opencode_workspace_runtime_ensure_list_and_stop_flow() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-workspace-flow");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        fake_opencode.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );

    let repo_path = repo.to_string_lossy().to_string();
    let first = service.opencode_repo_runtime_ensure(repo_path.as_str())?;
    let second = service.opencode_repo_runtime_ensure(repo_path.as_str())?;
    assert_eq!(first.runtime_id, second.runtime_id);

    let listed = service.opencode_runtime_list(Some(repo_path.as_str()))?;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].runtime_id, first.runtime_id);

    assert!(service.opencode_runtime_stop(first.runtime_id.as_str())?);
    assert!(service
        .opencode_runtime_list(Some(repo_path.as_str()))?
        .is_empty());
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_workspace_runtime_ensure_stops_spawned_child_when_post_start_prune_fails() -> Result<()>
{
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-workspace-prune-failure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let pid_file = root.join("spawned-runtime.pid");
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        fake_opencode.to_string_lossy().as_ref(),
    );
    let _delay_guard = set_env_var("OPENDUCKTOR_TEST_STARTUP_DELAY_MS", "600");
    let _pid_guard = set_env_var(
        "OPENDUCKTOR_TEST_PID_FILE",
        pid_file.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );
    let stale_child = Command::new("/bin/sh")
        .arg("-lc")
        .arg("sleep 0.2")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn stale child");
    service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .insert(
            "runtime-stale-prune-failure-window".to_string(),
            AgentRuntimeProcess {
                summary: AgentRuntimeSummary {
                    runtime_id: "runtime-stale-prune-failure-window".to_string(),
                    repo_path: "/tmp/other-repo-for-prune".to_string(),
                    task_id: "task-1".to_string(),
                    role: "spec".to_string(),
                    working_directory: "/tmp/other-repo-for-prune".to_string(),
                    port: 1,
                    started_at: "2026-02-20T12:00:00Z".to_string(),
                },
                child: stale_child,
                _opencode_process_guard: None,
                cleanup_repo_path: Some(
                    "/tmp/non-existent-repo-for-ensure-post-start-prune".to_string(),
                ),
                cleanup_worktree_path: Some(
                    "/tmp/non-existent-worktree-for-ensure-post-start-prune".to_string(),
                ),
            },
        );

    let repo_path = repo.to_string_lossy().to_string();
    let error = service
        .opencode_repo_runtime_ensure(repo_path.as_str())
        .expect_err("post-start prune failure should bubble up");
    let message = error.to_string();
    assert!(message.contains("Failed pruning stale runtimes while finalizing workspace runtime"));
    assert!(wait_for_path_exists(
        pid_file.as_path(),
        Duration::from_secs(2)
    ));
    let spawned_pid = fs::read_to_string(pid_file.as_path())?
        .trim()
        .parse::<i32>()
        .expect("spawned runtime pid should parse as i32");
    assert!(wait_for_process_exit(spawned_pid, Duration::from_secs(2)));
    assert!(service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .is_empty());

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_runtime_start_supports_spec_and_qa_roles() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-start");
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
    let worktree_base = root.join("qa-worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::Open)],
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
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let spec_runtime = service.opencode_runtime_start(repo_path.as_str(), "task-1", "spec")?;
    assert_eq!(spec_runtime.role, "spec");
    assert!(service.opencode_runtime_stop(spec_runtime.runtime_id.as_str())?);

    let qa_runtime = service.opencode_runtime_start(repo_path.as_str(), "task-1", "qa")?;
    assert_eq!(qa_runtime.role, "qa");
    let qa_worktree = PathBuf::from(qa_runtime.working_directory.clone());
    assert!(qa_worktree.exists());
    assert!(service.opencode_runtime_stop(qa_runtime.runtime_id.as_str())?);
    assert!(!qa_worktree.exists());

    let bad_role = service
        .opencode_runtime_start(repo_path.as_str(), "task-1", "build")
        .expect_err("unsupported role should fail");
    assert!(bad_role
        .to_string()
        .contains("Unsupported agent runtime role"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_runtime_start_reports_missing_task() -> Result<()> {
    let root = unique_temp_path("runtime-missing-task");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );

    let repo_path = repo.to_string_lossy().to_string();
    let error = service
        .opencode_runtime_start(repo_path.as_str(), "missing-task", "spec")
        .expect_err("missing task should fail");
    assert!(error.to_string().contains("Task not found: missing-task"));
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_runtime_start_qa_validates_config_and_existing_worktree_path() -> Result<()> {
    let root = unique_temp_path("runtime-qa-guards");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("qa-worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::Open)],
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
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            agent_defaults: Default::default(),
        },
    )?;
    let missing_base_error = service
        .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
        .expect_err("qa runtime should require worktree base path");
    assert!(missing_base_error
        .to_string()
        .contains("QA blocked: configure repos."));

    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: false,
            trusted_hooks_fingerprint: None,
            hooks: HookSet {
                pre_start: vec!["echo pre-hook".to_string()],
                post_complete: Vec::new(),
            },
            agent_defaults: Default::default(),
        },
    )?;
    let trust_error = service
        .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
        .expect_err("qa runtime should reject untrusted hooks");
    assert!(trust_error
        .to_string()
        .contains("Hooks are configured but not trusted"));

    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            agent_defaults: Default::default(),
        },
    )?;
    fs::create_dir_all(worktree_base.join("qa-task-1"))?;
    let existing_path_error = service
        .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
        .expect_err("existing qa worktree should fail");
    assert!(existing_path_error
        .to_string()
        .contains("QA worktree path already exists"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_runtime_start_surfaces_qa_pre_start_cleanup_failure() -> Result<()> {
    let root = unique_temp_path("runtime-pre-start-cleanup-failure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("qa-worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );

    let pre_start_cleanup_failure_hooks = HookSet {
        pre_start: vec![format!("sh -lc 'rm -rf \"{repo_path}\"; exit 1'")],
        post_complete: Vec::new(),
    };
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            trusted_hooks_fingerprint: Some(hook_set_fingerprint(&pre_start_cleanup_failure_hooks)),
            hooks: pre_start_cleanup_failure_hooks,
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
        .expect_err("cleanup failure should be surfaced when pre-start hook fails");
    let message = error.to_string();
    assert!(message.contains("QA pre-start hook failed"));
    assert!(message.contains("Failed removing QA worktree runtime"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_runtime_start_surfaces_cleanup_failure_after_startup_error() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-startup-cleanup-failure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let failing_opencode = root.join("opencode");
    create_failing_opencode_with_worktree_cleanup(&failing_opencode)?;
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        failing_opencode.to_string_lossy().as_ref(),
    );
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("qa-worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::Open)],
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
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
        .expect_err("startup cleanup failure should be surfaced");
    let message = error.to_string();
    assert!(message.contains("OpenCode runtime failed to start for task task-1"));
    assert!(message.contains("Failed removing QA worktree runtime"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_runtime_start_reuses_existing_runtime_for_same_task_and_role() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-reuse");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        fake_opencode.to_string_lossy().as_ref(),
    );
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();

    let first = service.opencode_runtime_start(repo_path.as_str(), "task-1", "spec")?;
    let second = service.opencode_runtime_start(repo_path.as_str(), "task-1", "spec")?;
    assert_eq!(first.runtime_id, second.runtime_id);
    assert!(service.opencode_runtime_stop(first.runtime_id.as_str())?);
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_runtime_stop_reports_cleanup_failure() -> Result<()> {
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let runtime_id = "runtime-cleanup-error".to_string();
    service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .insert(
            runtime_id.clone(),
            AgentRuntimeProcess {
                summary: AgentRuntimeSummary {
                    runtime_id: runtime_id.clone(),
                    repo_path: "/tmp/repo".to_string(),
                    task_id: "task-1".to_string(),
                    role: "qa".to_string(),
                    working_directory: "/tmp/repo".to_string(),
                    port: 1,
                    started_at: "2026-02-20T12:00:00Z".to_string(),
                },
                child: spawn_sleep_process(20),
                _opencode_process_guard: None,
                cleanup_repo_path: Some("/tmp/non-existent-repo-for-stop".to_string()),
                cleanup_worktree_path: Some("/tmp/non-existent-worktree-for-stop".to_string()),
            },
        );

    let error = service
        .opencode_runtime_stop(runtime_id.as_str())
        .expect_err("cleanup failure should bubble up");
    assert!(error
        .to_string()
        .contains("Failed removing QA worktree runtime"));
    assert!(service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .is_empty());
    Ok(())
}

#[test]
fn opencode_runtime_list_prunes_stale_entries() -> Result<()> {
    let root = unique_temp_path("runtime-prune");
    let repo = root.join("repo");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );

    let mut stale_child = Command::new("/bin/sh")
        .arg("-lc")
        .arg("exit 0")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn stale child");
    let _ = stale_child.wait();
    let summary = AgentRuntimeSummary {
        runtime_id: "runtime-stale".to_string(),
        repo_path: repo.to_string_lossy().to_string(),
        task_id: "task-1".to_string(),
        role: "spec".to_string(),
        working_directory: repo.to_string_lossy().to_string(),
        port: 1,
        started_at: "2026-02-20T12:00:00Z".to_string(),
    };
    service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .insert(
            summary.runtime_id.clone(),
            AgentRuntimeProcess {
                summary,
                child: stale_child,
                _opencode_process_guard: None,
                cleanup_repo_path: None,
                cleanup_worktree_path: None,
            },
        );

    let listed = service.opencode_runtime_list(None)?;
    assert!(listed.is_empty());

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_runtime_list_surfaces_stale_cleanup_failure() -> Result<()> {
    let root = unique_temp_path("runtime-prune-cleanup-failure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );

    let mut stale_child = Command::new("/bin/sh")
        .arg("-lc")
        .arg("exit 0")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn stale child");
    let _ = stale_child.wait();
    let summary = AgentRuntimeSummary {
        runtime_id: "runtime-stale-cleanup-error".to_string(),
        repo_path: repo.to_string_lossy().to_string(),
        task_id: "task-1".to_string(),
        role: "qa".to_string(),
        working_directory: repo.to_string_lossy().to_string(),
        port: 1,
        started_at: "2026-02-20T12:00:00Z".to_string(),
    };
    service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .insert(
            summary.runtime_id.clone(),
            AgentRuntimeProcess {
                summary,
                child: stale_child,
                _opencode_process_guard: None,
                cleanup_repo_path: Some("/tmp/non-existent-repo-for-prune".to_string()),
                cleanup_worktree_path: Some("/tmp/non-existent-worktree-for-prune".to_string()),
            },
        );

    let error = service
        .opencode_runtime_list(None)
        .expect_err("stale runtime cleanup failure should be surfaced");
    let message = error.to_string();
    assert!(message.contains("Failed pruning stale agent runtimes"));
    assert!(message.contains("Failed removing QA worktree runtime"));
    assert!(service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .is_empty());

    let _ = fs::remove_dir_all(root);
    Ok(())
}
