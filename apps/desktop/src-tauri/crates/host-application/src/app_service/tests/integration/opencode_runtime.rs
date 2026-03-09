#![allow(unused_imports)]

use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentRuntimeKind, AgentRuntimeRole, AgentSessionDocument, CreateTaskInput, GitBranch,
    GitCurrentBranch, GitPort, PlanSubtaskInput, QaReportDocument, QaVerdict, RunEvent, RunState,
    RunSummary, RuntimeInstanceSummary, RuntimeRole, TaskAction, TaskStatus, TaskStore,
    UpdateTaskPatch,
};
use host_infra_system::{hook_set_fingerprint, AppConfigStore, GlobalConfig, HookSet, RepoConfig};
use serde_json::Value;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
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
    RunProcess, RuntimeCleanupTarget, TrackedOpencodeProcessGuard,
    OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH,
};

fn runtime_summary_fixture(
    runtime_id: &str,
    repo_path: &str,
    task_id: &str,
    role: RuntimeRole,
    working_directory: &str,
    port: u16,
) -> RuntimeInstanceSummary {
    RuntimeInstanceSummary {
        kind: AgentRuntimeKind::Opencode,
        runtime_id: runtime_id.to_string(),
        repo_path: repo_path.to_string(),
        task_id: Some(task_id.to_string()),
        role,
        working_directory: working_directory.to_string(),
        runtime_route: AgentRuntimeKind::Opencode.route_for_port(port),
        started_at: "2026-02-20T12:00:00Z".to_string(),
        descriptor: AgentRuntimeKind::Opencode.descriptor(),
    }
}

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
            revision: None,
        },
        config_store,
    );

    let repo_path = repo.to_string_lossy().to_string();
    let first = service.runtime_ensure("opencode", repo_path.as_str())?;
    let second = service.runtime_ensure("opencode", repo_path.as_str())?;
    assert_eq!(first.runtime_id, second.runtime_id);

    let listed = service.runtime_list("opencode", Some(repo_path.as_str()))?;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].runtime_id, first.runtime_id);

    assert!(service.runtime_stop(first.runtime_id.as_str())?);
    assert!(service
        .runtime_list("opencode", Some(repo_path.as_str()))?
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
            revision: None,
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
                summary: runtime_summary_fixture(
                    "runtime-stale-prune-failure-window",
                    "/tmp/other-repo-for-prune",
                    "task-1",
                    RuntimeRole::Spec,
                    "/tmp/other-repo-for-prune",
                    1,
                ),
                child: stale_child,
                _opencode_process_guard: None,
                cleanup_target: Some(RuntimeCleanupTarget {
                    repo_path: "/tmp/non-existent-repo-for-ensure-post-start-prune".to_string(),
                    worktree_path: "/tmp/non-existent-worktree-for-ensure-post-start-prune"
                        .to_string(),
                }),
            },
        );

    let repo_path = repo.to_string_lossy().to_string();
    let error = service
        .runtime_ensure("opencode", repo_path.as_str())
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
fn runtime_start_supports_spec_and_qa_roles() -> Result<()> {
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

    let spec_runtime = service.runtime_start(
        "opencode",
        repo_path.as_str(),
        "task-1",
        AgentRuntimeRole::Spec,
    )?;
    assert_eq!(spec_runtime.role, RuntimeRole::Spec);
    assert!(service.runtime_stop(spec_runtime.runtime_id.as_str())?);

    let qa_runtime = service.runtime_start(
        "opencode",
        repo_path.as_str(),
        "task-1",
        AgentRuntimeRole::Qa,
    )?;
    assert_eq!(qa_runtime.role, RuntimeRole::Qa);
    let qa_worktree = PathBuf::from(qa_runtime.working_directory.clone());
    assert!(qa_worktree.exists());
    assert!(service.runtime_stop(qa_runtime.runtime_id.as_str())?);
    assert!(!qa_worktree.exists());

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn runtime_start_persists_canonical_repo_path_in_summary() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-canonical-repo-path");
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
            revision: None,
        },
        config_store,
    );
    let repo_path_with_suffix = format!("{}/.", repo.to_string_lossy());
    let runtime = service.runtime_start(
        "opencode",
        repo_path_with_suffix.as_str(),
        "task-1",
        AgentRuntimeRole::Spec,
    )?;

    let expected_repo_key = fs::canonicalize(&repo)?.to_string_lossy().to_string();
    assert_eq!(runtime.repo_path, expected_repo_key);
    assert!(service.runtime_stop(runtime.runtime_id.as_str())?);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn runtime_start_reports_missing_task() -> Result<()> {
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
            revision: None,
        },
        config_store,
    );

    let repo_path = repo.to_string_lossy().to_string();
    let error = service
        .runtime_start(
            "opencode",
            repo_path.as_str(),
            "missing-task",
            AgentRuntimeRole::Spec,
        )
        .expect_err("missing task should fail");
    assert!(error.to_string().contains("Task not found: missing-task"));
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn runtime_start_qa_validates_config_and_existing_worktree_path() -> Result<()> {
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
    let missing_base_error = service
        .runtime_start(
            "opencode",
            repo_path.as_str(),
            "task-1",
            AgentRuntimeRole::Qa,
        )
        .expect_err("qa runtime should require worktree base path");
    assert!(missing_base_error
        .to_string()
        .contains("QA blocked: configure repos."));

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
    let trust_error = service
        .runtime_start(
            "opencode",
            repo_path.as_str(),
            "task-1",
            AgentRuntimeRole::Qa,
        )
        .expect_err("qa runtime should reject untrusted hooks");
    assert!(trust_error
        .to_string()
        .contains("Scripts are configured but not trusted"));

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
    fs::create_dir_all(worktree_base.join("qa-task-1"))?;
    let existing_path_error = service
        .runtime_start(
            "opencode",
            repo_path.as_str(),
            "task-1",
            AgentRuntimeRole::Qa,
        )
        .expect_err("existing qa worktree should fail");
    assert!(existing_path_error
        .to_string()
        .contains("QA worktree path already exists"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn runtime_start_surfaces_qa_pre_start_cleanup_failure() -> Result<()> {
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
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;

    let pre_start_cleanup_failure_hooks = HookSet {
        pre_start: vec![format!("sh -lc 'rm -rf \"{repo_path}\"; exit 1'")],
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
            trusted_hooks_fingerprint: Some(hook_set_fingerprint(&pre_start_cleanup_failure_hooks)),
            hooks: pre_start_cleanup_failure_hooks,
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .runtime_start(
            "opencode",
            repo_path.as_str(),
            "task-1",
            AgentRuntimeRole::Qa,
        )
        .expect_err("cleanup failure should be surfaced when pre-start hook fails");
    let message = error.to_string();
    assert!(message.contains("QA worktree setup script command failed"));
    assert!(message.contains("Failed removing QA worktree runtime"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn runtime_start_surfaces_cleanup_failure_after_startup_error() -> Result<()> {
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
        .runtime_start(
            "opencode",
            repo_path.as_str(),
            "task-1",
            AgentRuntimeRole::Qa,
        )
        .expect_err("startup cleanup failure should be surfaced");
    let message = error.to_string();
    assert!(message.contains("opencode runtime failed to start for task task-1"));
    assert!(message.contains("Failed removing QA worktree runtime"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn runtime_start_fails_on_invalid_startup_config_before_qa_worktree_setup() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-invalid-startup-config");
    let repo = root.join("repo");
    init_git_repo(&repo)?;

    let config_path = root.join("config.json");
    let config_store = AppConfigStore::from_path(config_path.clone());
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("qa-worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::Open)],
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
        .runtime_start(
            "opencode",
            repo_path.as_str(),
            "task-1",
            AgentRuntimeRole::Qa,
        )
        .expect_err("invalid config should fail runtime start before QA worktree setup");
    let message = format!("{error:#}");
    assert!(
        message.contains("Failed parsing config file")
            || message.contains("Failed loading OpenCode startup readiness config"),
        "runtime startup error should preserve actionable config context: {message}"
    );
    assert!(
        !worktree_base.exists(),
        "QA worktree base should not be created when startup config is invalid"
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn runtime_start_reuses_existing_runtime_for_same_task_and_role() -> Result<()> {
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
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();

    let first = service.runtime_start(
        "opencode",
        repo_path.as_str(),
        "task-1",
        AgentRuntimeRole::Spec,
    )?;
    let config_path = root.join("config.json");
    write_private_file(&config_path, "{ invalid json")?;
    let second = service.runtime_start(
        "opencode",
        repo_path.as_str(),
        "task-1",
        AgentRuntimeRole::Spec,
    )?;
    assert_eq!(first.runtime_id, second.runtime_id);
    assert!(service.runtime_stop(first.runtime_id.as_str())?);
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn runtime_start_deduplicates_concurrent_same_task_and_role() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-concurrent-dedup");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        fake_opencode.to_string_lossy().as_ref(),
    );
    let _delay_guard = set_env_var("OPENDUCKTOR_TEST_STARTUP_DELAY_MS", "700");
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();

    let (first, second) = thread::scope(|scope| {
        let first_start = scope.spawn(|| {
            service.runtime_start(
                "opencode",
                repo_path.as_str(),
                "task-1",
                AgentRuntimeRole::Spec,
            )
        });
        let second_start = scope.spawn(|| {
            service.runtime_start(
                "opencode",
                repo_path.as_str(),
                "task-1",
                AgentRuntimeRole::Spec,
            )
        });
        (
            first_start
                .join()
                .expect("first runtime start thread should join"),
            second_start
                .join()
                .expect("second runtime start thread should join"),
        )
    });
    let first = first?;
    let second = second?;
    assert_eq!(first.runtime_id, second.runtime_id);
    assert_eq!(
        service
            .agent_runtimes
            .lock()
            .expect("runtime lock poisoned")
            .len(),
        1
    );
    assert!(service.runtime_stop(first.runtime_id.as_str())?);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_workspace_runtime_ensure_cleans_up_spawned_child_when_runtime_lock_is_poisoned(
) -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-workspace-lock-poison");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let pid_file = root.join("spawned-runtime.pid");
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
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );

    let repo_path = repo.to_string_lossy().to_string();
    let ensure_error = thread::scope(|scope| -> Result<anyhow::Error> {
        let ensure_handle = scope.spawn(|| service.runtime_ensure("opencode", repo_path.as_str()));

        assert!(wait_for_path_exists(
            pid_file.as_path(),
            Duration::from_secs(2)
        ));
        let spawned_pid = fs::read_to_string(pid_file.as_path())?
            .trim()
            .parse::<i32>()
            .expect("spawned runtime pid should parse as i32");

        let poison_handle = scope.spawn(|| {
            let _lock = service
                .agent_runtimes
                .lock()
                .expect("runtime lock should be available for poisoning");
            panic!("poison runtime lock");
        });
        assert!(poison_handle.join().is_err());

        let ensure_error = ensure_handle
            .join()
            .expect("workspace ensure thread should join")
            .expect_err("workspace ensure should fail when runtime lock is poisoned");
        assert!(wait_for_process_exit(spawned_pid, Duration::from_secs(2)));
        Ok(ensure_error)
    })?;
    assert!(ensure_error
        .to_string()
        .contains("Agent runtime state lock poisoned"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn runtime_start_cleans_up_qa_worktree_when_tracking_fails() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-qa-tracking-failure-cleanup");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let pid_file = root.join("spawned-runtime.pid");
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
    let worktree_base = root.join("qa-worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::Open)],
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

    let poison_service = service.clone();
    let poison_handle = thread::spawn(move || {
        let _lock = poison_service
            .tracked_opencode_processes
            .lock()
            .expect("tracked process lock should be available for poisoning");
        panic!("poison tracked OpenCode process lock");
    });
    assert!(poison_handle.join().is_err());

    let error = service
        .runtime_start(
            "opencode",
            repo_path.as_str(),
            "task-1",
            AgentRuntimeRole::Qa,
        )
        .expect_err("qa runtime start should fail when tracked process lock is poisoned");
    assert!(error
        .to_string()
        .contains("Failed tracking spawned OpenCode agent runtime"));

    if wait_for_path_exists(pid_file.as_path(), Duration::from_secs(2)) {
        let spawned_pid = fs::read_to_string(pid_file.as_path())?
            .trim()
            .parse::<i32>()
            .expect("spawned runtime pid should parse as i32");
        assert!(wait_for_process_exit(spawned_pid, Duration::from_secs(2)));
    }
    assert!(
        !worktree_base.join("qa-task-1").exists(),
        "qa worktree should be removed when runtime tracking fails"
    );
    assert!(service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .is_empty());

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn runtime_stop_reports_cleanup_failure() -> Result<()> {
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
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
                summary: runtime_summary_fixture(
                    runtime_id.as_str(),
                    "/tmp/repo",
                    "task-1",
                    RuntimeRole::Qa,
                    "/tmp/repo",
                    1,
                ),
                child: spawn_sleep_process(20),
                _opencode_process_guard: None,
                cleanup_target: Some(RuntimeCleanupTarget {
                    repo_path: "/tmp/non-existent-repo-for-stop".to_string(),
                    worktree_path: "/tmp/non-existent-worktree-for-stop".to_string(),
                }),
            },
        );

    let error = service
        .runtime_stop(runtime_id.as_str())
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
fn runtime_list_prunes_stale_entries() -> Result<()> {
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
            revision: None,
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
    let summary = runtime_summary_fixture(
        "runtime-stale",
        repo.to_string_lossy().as_ref(),
        "task-1",
        RuntimeRole::Spec,
        repo.to_string_lossy().as_ref(),
        1,
    );
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
                cleanup_target: None,
            },
        );

    let listed = service.runtime_list("opencode", None)?;
    assert!(listed.is_empty());

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn runtime_list_surfaces_stale_cleanup_failure() -> Result<()> {
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
            revision: None,
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
    let summary = runtime_summary_fixture(
        "runtime-stale-cleanup-error",
        repo.to_string_lossy().as_ref(),
        "task-1",
        RuntimeRole::Qa,
        repo.to_string_lossy().as_ref(),
        1,
    );
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
                cleanup_target: Some(RuntimeCleanupTarget {
                    repo_path: "/tmp/non-existent-repo-for-prune".to_string(),
                    worktree_path: "/tmp/non-existent-worktree-for-prune".to_string(),
                }),
            },
        );

    let error = service
        .runtime_list("opencode", None)
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
