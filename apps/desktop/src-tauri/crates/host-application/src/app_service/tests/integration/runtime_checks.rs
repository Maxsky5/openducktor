#![allow(unused_imports)]

use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentRuntimeSummary, AgentSessionDocument, CreateTaskInput, GitBranch, GitCurrentBranch,
    GitPort, PlanSubtaskInput, QaReportDocument, QaVerdict, RunEvent, RunState, RunSummary,
    TaskAction, TaskStatus, TaskStore, UpdateTaskPatch,
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
use crate::app_service::test_support::{
    build_service_with_git_state, build_service_with_store, create_failing_opencode,
    create_failing_opencode_with_worktree_cleanup, create_fake_bd, create_fake_opencode,
    create_orphanable_opencode, empty_patch, init_git_repo, lock_env, make_emitter, make_session,
    make_task, prepend_path, process_is_alive, remove_env_var, set_env_var, spawn_sleep_process,
    unique_temp_path, wait_for_orphaned_opencode_process, wait_for_path_exists,
    wait_for_process_exit, write_executable_script, FakeTaskStore, GitCall, TaskStoreState,
};
use crate::app_service::{
    build_opencode_config_content, can_set_plan, default_mcp_workspace_root,
    parse_mcp_command_json, read_opencode_process_registry, read_opencode_version,
    resolve_mcp_command, resolve_opencode_binary_path, terminate_child_process,
    terminate_process_by_pid, validate_parent_relationships_for_update,
    with_locked_opencode_process_registry, AgentRuntimeProcess, OpencodeProcessRegistryInstance,
    RunProcess, TrackedOpencodeProcessGuard, OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH,
};

#[test]
fn runtime_beads_system_and_workspace_paths_are_exercised() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-workspace");
    let repo = root.join("repo");
    init_git_repo(&repo)?;

    let bin_dir = root.join("bin");
    let fake_opencode = bin_dir.join("opencode");
    let fake_bd = bin_dir.join("bd");
    create_fake_opencode(&fake_opencode)?;
    create_fake_bd(&fake_bd)?;

    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        fake_opencode.to_string_lossy().as_ref(),
    );
    let _path_guard = prepend_path(&bin_dir);

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );

    let repo_path = repo.to_string_lossy().to_string();
    let runtime = service.runtime_check()?;
    assert!(runtime.git_ok);
    assert!(runtime.opencode_ok);
    assert!(runtime
        .opencode_version
        .as_deref()
        .unwrap_or_default()
        .contains("opencode-fake"));

    let beads = service.beads_check(repo_path.as_str())?;
    assert!(beads.beads_ok);
    assert!(beads.beads_path.is_some());

    let system = service.system_check(repo_path.as_str())?;
    assert!(system.git_ok);
    assert!(system.beads_ok);
    assert!(system.opencode_ok);
    assert!(system.errors.is_empty());

    let workspace = service.workspace_add(repo_path.as_str())?;
    assert!(workspace.is_active);
    let selected = service.workspace_select(repo_path.as_str())?;
    assert!(selected.is_active);

    let worktree_base = root.join("worktrees").to_string_lossy().to_string();
    let updated = service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.clone()),
            branch_prefix: "odt".to_string(),
            default_target_branch: "origin/main".to_string(),
            trusted_hooks: false,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
        },
    )?;
    assert!(updated.has_config);

    let config = service.workspace_get_repo_config(repo_path.as_str())?;
    assert_eq!(config.branch_prefix, "odt");
    assert_eq!(
        config.worktree_base_path.as_deref(),
        Some(worktree_base.as_str())
    );
    assert!(service
        .workspace_get_repo_config_optional(repo_path.as_str())?
        .is_some());
    let stale_trust_error = service
        .workspace_set_trusted_hooks(repo_path.as_str(), true, Some("stale-fingerprint"))
        .expect_err("stale fingerprint should be rejected");
    assert!(stale_trust_error
        .to_string()
        .contains("Hook trust challenge is stale"));
    let trusted = service.workspace_set_trusted_hooks(
        repo_path.as_str(),
        true,
        Some(host_infra_system::hook_set_fingerprint(&config.hooks).as_str()),
    )?;
    assert!(trusted.has_config);

    let records = service.workspace_list()?;
    assert_eq!(records.len(), 1);
    assert!(records[0].is_active);

    let state = task_state.lock().expect("task lock poisoned");
    assert!(!state.ensure_calls.is_empty());
    drop(state);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn beads_check_reports_task_store_init_error() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("beads-error");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let bin_dir = root.join("bin");
    create_fake_bd(&bin_dir.join("bd"))?;
    let _path_guard = prepend_path(&bin_dir);

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );
    task_state.lock().expect("task lock poisoned").ensure_error = Some("init failed".to_string());

    let repo_path = repo.to_string_lossy().to_string();
    let check = service.beads_check(repo_path.as_str())?;
    assert!(!check.beads_ok);
    let beads_error = check.beads_error.unwrap_or_default();
    assert!(
        beads_error.contains("Failed to initialize task store"),
        "unexpected beads error: {beads_error}"
    );
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn beads_and_system_checks_report_missing_bd_binary() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("beads-missing-binary");
    let _path_guard = set_env_var("PATH", "/usr/bin:/bin");

    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let beads = service.beads_check("/tmp/does-not-matter")?;
    assert!(!beads.beads_ok);
    assert!(beads.beads_path.is_none());
    assert!(beads
        .beads_error
        .as_deref()
        .unwrap_or_default()
        .contains("bd not found in PATH"));

    let system = service.system_check("/tmp/does-not-matter")?;
    assert!(system
        .errors
        .iter()
        .any(|entry| entry.contains("beads: bd not found in PATH")));

    let _ = fs::remove_dir_all(root);
    Ok(())
}
