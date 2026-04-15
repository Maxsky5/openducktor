#![allow(unused_imports)]

use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentSessionDocument, CreateTaskInput, GitBranch, GitCurrentBranch, GitPort, PlanSubtaskInput,
    QaReportDocument, QaVerdict, RepoStoreAttachmentHealth, RepoStoreHealth,
    RepoStoreHealthCategory, RepoStoreHealthStatus, RepoStoreSharedServerHealth,
    RepoStoreSharedServerOwnershipState, RunEvent, RunState, RunSummary, RuntimeInstanceSummary,
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
use crate::app_service::opencode_runtime::test_support::{
    read_opencode_process_registry, with_locked_opencode_process_registry,
    OpencodeProcessRegistryInstance, TrackedOpencodeProcessGuard,
    OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH,
};
use crate::app_service::test_support::{
    build_service_with_git_state, build_service_with_store, create_failing_opencode,
    create_fake_bd, create_fake_opencode, create_orphanable_opencode, empty_patch, init_git_repo,
    lock_env, make_emitter, make_session, make_task, prepend_path, process_is_alive,
    remove_env_var, set_env_var, spawn_sleep_process, unique_temp_path,
    wait_for_orphaned_opencode_process, wait_for_path_exists, wait_for_process_exit,
    write_executable_script, FakeTaskStore, GitCall, TaskStoreState,
};
use crate::app_service::{
    build_opencode_config_content, can_set_plan, default_mcp_workspace_root,
    parse_mcp_command_json, read_opencode_version, resolve_mcp_command,
    resolve_opencode_binary_path, terminate_child_process, terminate_process_by_pid,
    validate_parent_relationships_for_update, AgentRuntimeProcess, RunProcess,
};

fn repo_store_health(
    category: RepoStoreHealthCategory,
    status: RepoStoreHealthStatus,
    detail: &str,
) -> RepoStoreHealth {
    RepoStoreHealth {
        is_ready: matches!(status, RepoStoreHealthStatus::Ready),
        category,
        status,
        detail: Some(detail.to_string()),
        attachment: RepoStoreAttachmentHealth {
            path: Some("/tmp/repo/.beads".to_string()),
            database_name: Some("repo_db".to_string()),
        },
        shared_server: RepoStoreSharedServerHealth {
            host: Some("127.0.0.1".to_string()),
            port: Some(3307),
            ownership_state: RepoStoreSharedServerOwnershipState::OwnedByCurrentProcess,
        },
    }
}

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
            revision: None,
        },
        config_store,
    );

    let repo_path = repo.to_string_lossy().to_string();
    let runtime = service.runtime_check()?;
    assert!(runtime.git_ok);
    let opencode_runtime = runtime
        .runtimes
        .iter()
        .find(|entry| entry.kind == "opencode")
        .expect("opencode runtime should be present");
    assert!(opencode_runtime.ok);
    assert!(opencode_runtime
        .version
        .as_deref()
        .unwrap_or_default()
        .contains("opencode-fake"));

    let beads = service.beads_check(repo_path.as_str())?;
    assert!(beads.beads_ok);
    assert!(beads.beads_path.is_some());
    assert_eq!(
        beads.repo_store_health.category,
        RepoStoreHealthCategory::Healthy
    );

    let system = service.system_check(repo_path.as_str())?;
    assert!(system.git_ok);
    assert!(system.beads_ok);
    assert_eq!(
        system.repo_store_health.category,
        RepoStoreHealthCategory::Healthy
    );
    assert!(system
        .runtimes
        .iter()
        .find(|entry| entry.kind == "opencode")
        .is_some_and(|entry| entry.ok));
    assert!(system.errors.is_empty());

    let workspace = service.workspace_add(repo_path.as_str())?;
    assert!(workspace.is_active);
    let selected = service.workspace_select(repo_path.as_str())?;
    assert!(selected.is_active);

    let worktree_base = root.join("worktrees").to_string_lossy().to_string();
    let updated = service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(worktree_base.clone()),
            branch_prefix: "odt".to_string(),
            default_target_branch: host_infra_system::GitTargetBranch {
                remote: Some("origin".to_string()),
                branch: "main".to_string(),
            },
            git: Default::default(),
            trusted_hooks: false,
            trusted_hooks_fingerprint: None,
            hooks: HookSet::default(),
            dev_servers: Vec::new(),
            worktree_file_copies: Vec::new(),
            prompt_overrides: Default::default(),
            agent_defaults: Default::default(),
        },
    )?;
    assert!(updated.has_config);
    assert_eq!(
        updated.effective_worktree_base_path.as_deref(),
        Some(worktree_base.as_str())
    );

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
        .workspace_persist_trusted_hooks(repo_path.as_str(), true, Some("stale-fingerprint"))
        .expect_err("stale fingerprint should be rejected");
    assert!(stale_trust_error
        .to_string()
        .contains("Hook trust challenge is stale"));
    let trusted = service.workspace_persist_trusted_hooks(
        repo_path.as_str(),
        true,
        Some(host_infra_system::hook_set_fingerprint(&config.hooks).as_str()),
    )?;
    assert!(trusted.has_config);
    assert_eq!(
        trusted.effective_worktree_base_path.as_deref(),
        Some(worktree_base.as_str())
    );

    let records = service.workspace_list()?;
    assert_eq!(records.len(), 1);
    assert!(records[0].is_active);

    let state = task_state.lock().expect("task lock poisoned");
    assert!(!state.diagnose_calls.is_empty());
    drop(state);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn beads_check_reports_structured_restore_needed_health() -> Result<()> {
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
            revision: None,
        },
        config_store,
    );
    task_state
        .lock()
        .expect("task lock poisoned")
        .diagnose_health = Some(repo_store_health(
        RepoStoreHealthCategory::MissingSharedDatabase,
        RepoStoreHealthStatus::RestoreNeeded,
        "Shared Dolt database repo_db is missing and restore is required",
    ));

    let repo_path = repo.to_string_lossy().to_string();
    let check = service.beads_check(repo_path.as_str())?;
    assert!(!check.beads_ok);
    assert_eq!(
        check.repo_store_health.category,
        RepoStoreHealthCategory::MissingSharedDatabase
    );
    assert_eq!(
        check.repo_store_health.status,
        RepoStoreHealthStatus::RestoreNeeded
    );
    assert!(check
        .beads_error
        .as_deref()
        .unwrap_or_default()
        .contains("restore is required"));
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn beads_and_system_checks_report_missing_bd_binary() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("beads-missing-binary");
    let _path_guard = set_env_var("PATH", "/usr/bin:/bin");
    let _override_guard = set_env_var("OPENDUCKTOR_BD_PATH", "/tmp/odt-missing-bd-binary");

    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let beads = service.beads_check("/tmp/does-not-matter")?;
    assert!(!beads.beads_ok);
    assert!(beads.beads_path.is_none());
    assert_eq!(
        beads.repo_store_health.category,
        RepoStoreHealthCategory::AttachmentVerificationFailed
    );
    assert!(beads
        .beads_error
        .as_deref()
        .unwrap_or_default()
        .contains("bd not found in bundled locations, standard install locations, or PATH"));

    let system = service.system_check("/tmp/does-not-matter")?;
    assert!(system.errors.iter().any(|entry| entry.contains(
        "beads: bd not found in bundled locations, standard install locations, or PATH"
    )));

    let _ = fs::remove_dir_all(root);
    Ok(())
}
