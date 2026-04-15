#![allow(unused_imports)]

use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentRuntimeKind, AgentSessionDocument, CreateTaskInput, DevServerGroupState,
    DevServerScriptState, DevServerScriptStatus, GitBranch, GitCurrentBranch, GitPort,
    PlanSubtaskInput, QaReportDocument, QaVerdict, RunEvent, RunState, RunSummary,
    RuntimeInstanceSummary, RuntimeRole, TaskAction, TaskStatus, TaskStore, UpdateTaskPatch,
};
use host_infra_system::{AppConfigStore, GlobalConfig, HookSet, RepoConfig};
use serde_json::Value;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::app_service::build_orchestrator::{BuildResponseAction, CleanupMode};
use crate::app_service::test_support::{
    build_service_with_git_state, build_service_with_store, builtin_opencode_runtime_descriptor,
    builtin_opencode_runtime_route, create_failing_opencode, create_fake_bd, create_fake_opencode,
    create_orphanable_opencode, empty_patch, init_git_repo, install_fake_dolt, lock_env,
    make_emitter, make_session, make_task, prepend_path, process_is_alive,
    read_opencode_process_registry, remove_env_var, set_env_var, spawn_sleep_process,
    spawn_sleep_process_group, unique_temp_path, wait_for_orphaned_opencode_process,
    wait_for_path_exists, wait_for_process_exit, with_locked_opencode_process_registry,
    write_executable_script, FakeTaskStore, GitCall, OpencodeProcessRegistryInstance,
    TaskStoreState, TrackedOpencodeProcessGuard, OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH,
};
use crate::app_service::{
    build_opencode_config_content, can_set_plan, default_mcp_workspace_root,
    find_openducktor_workspace_root, parse_mcp_command_json, read_opencode_version,
    resolve_mcp_command, resolve_opencode_binary_path, terminate_child_process,
    terminate_process_by_pid, validate_parent_relationships_for_update, AgentRuntimeProcess,
    DevServerGroupRuntime, RunProcess, RuntimeCleanupTarget,
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
        kind: AgentRuntimeKind::opencode(),
        runtime_id: runtime_id.to_string(),
        repo_path: repo_path.to_string(),
        task_id: Some(task_id.to_string()),
        role,
        working_directory: working_directory.to_string(),
        runtime_route: builtin_opencode_runtime_route(port),
        started_at: "2026-02-20T12:00:00Z".to_string(),
        descriptor: builtin_opencode_runtime_descriptor(),
    }
}

#[test]
fn shutdown_reports_runtime_cleanup_errors_and_drains_state() -> Result<()> {
    let _env_lock = lock_env();
    let config_root = unique_temp_path("shutdown-runtime-cleanup-config");
    let _config_guard = set_env_var(
        "OPENDUCKTOR_CONFIG_DIR",
        config_root.to_string_lossy().as_ref(),
    );
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let run_id = "run-shutdown".to_string();
    service.runs.lock().expect("run lock poisoned").insert(
        run_id.clone(),
        RunProcess {
            summary: RunSummary {
                run_id: run_id.clone(),
                runtime_kind: AgentRuntimeKind::opencode(),
                runtime_route: builtin_opencode_runtime_route(1),
                repo_path: "/tmp/repo".to_string(),
                task_id: "task-1".to_string(),
                branch: "odt/task-1".to_string(),
                worktree_path: "/tmp/worktree".to_string(),
                port: Some(1),
                state: RunState::Running,
                last_message: None,
                started_at: "2026-02-20T12:00:00Z".to_string(),
            },
            child: Some(spawn_sleep_process(20)),
            _runtime_process_guard: None,
            repo_path: "/tmp/repo".to_string(),
            task_id: "task-1".to_string(),
            worktree_path: "/tmp/worktree".to_string(),
            repo_config: RepoConfig {
                default_runtime_kind: "opencode".to_string(),
                worktree_base_path: None,
                branch_prefix: "odt".to_string(),
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
            },
        },
    );

    let runtime_id = "runtime-shutdown".to_string();
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
                    "/tmp/worktree",
                    1,
                ),
                child: Some(spawn_sleep_process(20)),
                _runtime_process_guard: None,
                cleanup_target: Some(RuntimeCleanupTarget {
                    repo_path: "/tmp/non-existent-repo-for-shutdown".to_string(),
                    worktree_path: "/tmp/non-existent-worktree-for-shutdown".to_string(),
                }),
            },
        );

    service
        .shutdown()
        .expect("shutdown should drain runtime state without QA cleanup errors");
    assert!(service.runs.lock().expect("run lock poisoned").is_empty());
    assert!(service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .is_empty());
    let _ = fs::remove_dir_all(config_root);
    Ok(())
}

#[test]
fn shutdown_terminates_pending_opencode_processes() -> Result<()> {
    let _env_lock = lock_env();
    let config_root = unique_temp_path("shutdown-pending-opencode-config");
    let _config_guard = set_env_var(
        "OPENDUCKTOR_CONFIG_DIR",
        config_root.to_string_lossy().as_ref(),
    );
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let root = unique_temp_path("shutdown-pending-opencode");
    let orphanable_opencode = root.join("opencode");
    create_orphanable_opencode(&orphanable_opencode)?;
    let mut pending_child = Command::new("/bin/sh")
        .arg(orphanable_opencode.as_path())
        .arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg("54323")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("failed spawning pending opencode process")?;
    let pending_pid = pending_child.id();
    let _pending_process_guard = service
        .runtime_registry
        .runtime(&AgentRuntimeKind::opencode())?
        .track_process(&service, pending_pid)?;

    service.shutdown()?;

    assert!(
        wait_for_process_exit(pending_pid as i32, Duration::from_secs(2)),
        "pending OpenCode process should have exited during shutdown"
    );
    let _ = pending_child
        .wait()
        .context("failed waiting pending OpenCode process")?;

    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(config_root);
    Ok(())
}

#[test]
fn shutdown_keeps_other_service_pending_opencode_processes_running() -> Result<()> {
    let _env_lock = lock_env();
    let config_root = unique_temp_path("shutdown-pending-opencode-isolated-config");
    let _config_guard = set_env_var(
        "OPENDUCKTOR_CONFIG_DIR",
        config_root.to_string_lossy().as_ref(),
    );
    let (service_one, _task_state_one, _git_state_one) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let (service_two, _task_state_two, _git_state_two) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );

    let root = unique_temp_path("shutdown-pending-opencode-isolated");
    let orphanable_opencode = root.join("opencode");
    create_orphanable_opencode(&orphanable_opencode)?;
    let mut service_two_child = Command::new("/bin/sh")
        .arg(orphanable_opencode.as_path())
        .arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg("54324")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .context("failed spawning pending opencode process for second service")?;
    let service_two_pid = service_two_child.id();
    let service_two_guard = service_two
        .runtime_registry
        .runtime(&AgentRuntimeKind::opencode())?
        .track_process(&service_two, service_two_pid)?;

    service_one.shutdown()?;

    assert!(
        process_is_alive(service_two_pid as i32),
        "shutting down one service should not terminate another service's pending OpenCode process"
    );

    drop(service_two_guard);
    terminate_process_by_pid(service_two_pid);
    assert!(
        wait_for_process_exit(service_two_pid as i32, Duration::from_secs(2)),
        "second service pending OpenCode process should exit during cleanup"
    );
    let _ = service_two_child
        .wait()
        .context("failed waiting second service pending OpenCode process")?;
    service_two.shutdown()?;

    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(config_root);
    Ok(())
}

#[test]
fn shutdown_drains_runs_and_runtimes_when_pending_opencode_cleanup_fails() -> Result<()> {
    let root = unique_temp_path("shutdown-drains-after-pending-cleanup-failure");
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

    let run_child = spawn_sleep_process(20);
    let run_pid = run_child.id() as i32;
    service.runs.lock().expect("run lock poisoned").insert(
        "run-shutdown-registry-error".to_string(),
        RunProcess {
            summary: RunSummary {
                run_id: "run-shutdown-registry-error".to_string(),
                runtime_kind: AgentRuntimeKind::opencode(),
                runtime_route: builtin_opencode_runtime_route(1),
                repo_path: "/tmp/repo".to_string(),
                task_id: "task-1".to_string(),
                branch: "odt/task-1".to_string(),
                worktree_path: "/tmp/worktree".to_string(),
                port: Some(1),
                state: RunState::Running,
                last_message: None,
                started_at: "2026-02-20T12:00:00Z".to_string(),
            },
            child: Some(run_child),
            _runtime_process_guard: None,
            repo_path: "/tmp/repo".to_string(),
            task_id: "task-1".to_string(),
            worktree_path: "/tmp/worktree".to_string(),
            repo_config: RepoConfig {
                default_runtime_kind: "opencode".to_string(),
                worktree_base_path: None,
                branch_prefix: "odt".to_string(),
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
            },
        },
    );

    let runtime_child = spawn_sleep_process(20);
    let runtime_pid = runtime_child.id() as i32;
    service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .insert(
            "runtime-shutdown-registry-error".to_string(),
            AgentRuntimeProcess {
                summary: runtime_summary_fixture(
                    "runtime-shutdown-registry-error",
                    "/tmp/repo",
                    "task-1",
                    RuntimeRole::Spec,
                    "/tmp/repo",
                    1,
                ),
                child: Some(runtime_child),
                _runtime_process_guard: None,
                cleanup_target: None,
            },
        );

    let registry_path = root.join(OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH);
    if let Some(parent) = registry_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(registry_path.as_path(), "{ this is not valid json")?;

    let error = service
        .shutdown()
        .expect_err("shutdown should surface pending opencode cleanup failure");
    let message = error.to_string();
    assert!(message.contains("Failed terminating pending opencode runtime processes"));
    assert!(service.runs.lock().expect("run lock poisoned").is_empty());
    assert!(service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .is_empty());
    assert!(wait_for_process_exit(run_pid, Duration::from_secs(2)));
    assert!(wait_for_process_exit(runtime_pid, Duration::from_secs(2)));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[cfg(unix)]
#[test]
fn shutdown_stops_running_dev_server_process_groups() -> Result<()> {
    let _env_lock = lock_env();
    let config_root = unique_temp_path("shutdown-dev-server-config");
    let _config_guard = set_env_var(
        "OPENDUCKTOR_CONFIG_DIR",
        config_root.to_string_lossy().as_ref(),
    );
    let repo_path = unique_temp_path("shutdown-dev-server-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let workspace = service.workspace_add(&repo_path.to_string_lossy())?;
    let canonical_repo_path = workspace.path;

    let mut child = spawn_sleep_process_group(20);
    let pid = child.id();
    let repo_path_string = canonical_repo_path;
    service
        .dev_server_groups
        .lock()
        .expect("dev server lock poisoned")
        .insert(
            format!("{}::task-1", repo_path_string),
            DevServerGroupRuntime {
                state: DevServerGroupState {
                    repo_path: repo_path_string.clone(),
                    task_id: "task-1".to_string(),
                    worktree_path: Some(repo_path_string.clone()),
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

    let shutdown_result = service.shutdown();
    let exited = wait_for_process_exit(pid as i32, Duration::from_secs(2));
    if !exited {
        let _ = child.kill();
    }
    let _ = child.wait().context("failed waiting dev server child")?;
    shutdown_result?;

    assert!(exited, "dev server process should exit during shutdown");

    let groups = service
        .dev_server_groups
        .lock()
        .expect("dev server lock poisoned");
    let group = groups
        .get(&format!("{}::task-1", repo_path_string))
        .expect("dev server group retained");
    assert!(group.state.scripts.is_empty());
    drop(groups);

    let _ = fs::remove_dir_all(repo_path);
    let _ = fs::remove_dir_all(config_root);
    Ok(())
}

#[test]
fn tracked_guard_drop_refcounts_prevent_pid_reuse_untracking() -> Result<()> {
    let root = unique_temp_path("guard-drop-refcount-pid-reuse");
    let registry_path = root.join(OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH);
    let parent_pid = 70_001;
    let child_pid = 80_001;

    with_locked_opencode_process_registry(
        registry_path.as_path(),
        |instances: &mut Vec<OpencodeProcessRegistryInstance>| {
            instances.push(OpencodeProcessRegistryInstance::with_child(
                parent_pid, child_pid,
            ));
            Ok(())
        },
    )?;

    let tracked = Arc::new(Mutex::new(std::collections::HashMap::<u32, usize>::new()));
    tracked
        .lock()
        .expect("tracked lock poisoned")
        .insert(child_pid, 2);

    {
        let first_guard = TrackedOpencodeProcessGuard {
            tracked_opencode_processes: tracked.clone(),
            opencode_process_registry_path: registry_path.clone(),
            parent_pid,
            child_pid,
        };
        drop(first_guard);
    }
    assert_eq!(
        tracked
            .lock()
            .expect("tracked lock poisoned")
            .get(&child_pid)
            .copied(),
        Some(1)
    );
    let remaining_after_first = read_opencode_process_registry(registry_path.as_path())?;
    assert!(remaining_after_first.iter().any(|instance| {
        instance.parent_pid == parent_pid && instance.child_pids.contains(&child_pid)
    }));

    {
        let second_guard = TrackedOpencodeProcessGuard {
            tracked_opencode_processes: tracked.clone(),
            opencode_process_registry_path: registry_path.clone(),
            parent_pid,
            child_pid,
        };
        drop(second_guard);
    }
    assert!(tracked
        .lock()
        .expect("tracked lock poisoned")
        .get(&child_pid)
        .is_none());
    assert!(read_opencode_process_registry(registry_path.as_path())?.is_empty());

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn startup_reconcile_terminates_orphaned_registered_opencode_processes() -> Result<()> {
    let root = unique_temp_path("startup-reconcile-orphan-opencode");
    let orphanable_opencode = root.join("opencode");
    create_orphanable_opencode(&orphanable_opencode)?;

    let spawn_command = format!(
        "\"{}\" serve --hostname 127.0.0.1 --port 54321 >/dev/null 2>&1 & echo $!",
        orphanable_opencode.display()
    );
    let output = Command::new("/bin/sh")
        .arg("-lc")
        .arg(spawn_command)
        .output()?;
    assert!(output.status.success());

    let orphan_pid = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u32>()
        .expect("spawned orphan pid should parse as u32");
    assert!(wait_for_orphaned_opencode_process(
        orphan_pid,
        Duration::from_secs(2)
    ));

    let registry_path = root.join(OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH);
    with_locked_opencode_process_registry(
        registry_path.as_path(),
        |instances: &mut Vec<OpencodeProcessRegistryInstance>| {
            instances.push(OpencodeProcessRegistryInstance::with_child(
                999_999, orphan_pid,
            ));
            Ok(())
        },
    )?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (_service, _task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );

    assert!(wait_for_process_exit(
        orphan_pid as i32,
        Duration::from_secs(2)
    ));
    assert!(read_opencode_process_registry(registry_path.as_path())?.is_empty());

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn startup_reconcile_keeps_non_orphan_registered_opencode_processes() -> Result<()> {
    let root = unique_temp_path("startup-reconcile-live-opencode");
    let orphanable_opencode = root.join("opencode");
    create_orphanable_opencode(&orphanable_opencode)?;
    let pid_file = root.join("live-opencode-pids.txt");
    let spawn_command = format!(
            "\"{}\" serve --hostname 127.0.0.1 --port 54322 >/dev/null 2>&1 & echo \"$$ $!\" > \"{}\"; sleep 30",
            orphanable_opencode.display(),
            pid_file.display()
        );
    let mut live_parent_process = Command::new("/bin/sh")
        .arg("-lc")
        .arg(spawn_command)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;

    assert!(wait_for_path_exists(
        pid_file.as_path(),
        Duration::from_secs(2)
    ));
    let pids = fs::read_to_string(pid_file.as_path())?;
    let mut parts = pids.split_whitespace();
    let live_parent_pid = parts
        .next()
        .ok_or_else(|| anyhow!("missing live parent pid"))?
        .parse::<u32>()
        .context("failed parsing live parent pid")?;
    let live_pid = parts
        .next()
        .ok_or_else(|| anyhow!("missing live child pid"))?
        .parse::<u32>()
        .context("failed parsing live child pid")?;
    assert!(process_is_alive(live_parent_pid as i32));
    assert!(process_is_alive(live_pid as i32));

    let registry_path = root.join(OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH);
    with_locked_opencode_process_registry(
        registry_path.as_path(),
        |instances: &mut Vec<OpencodeProcessRegistryInstance>| {
            instances.push(OpencodeProcessRegistryInstance::with_child(
                live_parent_pid,
                live_pid,
            ));
            Ok(())
        },
    )?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (_service, _task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );

    assert!(process_is_alive(live_pid as i32));
    let remaining = read_opencode_process_registry(registry_path.as_path())?;
    assert!(remaining.iter().any(|instance| {
        instance.parent_pid == live_parent_pid && instance.child_pids.contains(&live_pid)
    }));

    terminate_child_process(&mut live_parent_process);
    terminate_process_by_pid(live_pid);
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn helper_functions_cover_mcp_and_opencode_resolution_paths() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("helpers");
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        fake_opencode.to_string_lossy().as_ref(),
    );

    let version = read_opencode_version(fake_opencode.to_string_lossy().as_ref());
    assert_eq!(version.as_deref(), Some("opencode-fake 0.0.1"));
    assert_eq!(
        resolve_opencode_binary_path().as_deref(),
        Some(fake_opencode.to_string_lossy().as_ref())
    );

    let _workspace_guard = set_env_var(
        "OPENDUCKTOR_WORKSPACE_ROOT",
        root.to_string_lossy().as_ref(),
    );
    let _command_guard = set_env_var("OPENDUCKTOR_MCP_COMMAND_JSON", "[\"mcp-bin\",\"--stdio\"]");
    let parsed = resolve_mcp_command()?;
    assert_eq!(parsed, vec!["mcp-bin".to_string(), "--stdio".to_string()]);
    assert_eq!(
        default_mcp_workspace_root()?,
        root.to_string_lossy().to_string()
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn resolve_opencode_binary_path_supports_home_shorthand_override() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("opencode-tilde-override");
    let home = root.join("home");
    let override_dir = home.join("custom-bin");
    fs::create_dir_all(&override_dir)?;
    let override_binary = override_dir.join("opencode");
    create_fake_opencode(&override_binary)?;

    let _home_guard = set_env_var("HOME", home.to_string_lossy().as_ref());
    let _override_guard = set_env_var("OPENDUCKTOR_OPENCODE_BINARY", "~/custom-bin/opencode");

    let resolved = resolve_opencode_binary_path();
    assert_eq!(
        resolved.as_deref(),
        Some(override_binary.to_string_lossy().as_ref())
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn resolve_opencode_binary_path_uses_home_fallback_when_override_and_path_missing() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("opencode-home-fallback");
    let home_bin = root.join(".opencode").join("bin");
    fs::create_dir_all(&home_bin)?;
    let home_opencode = home_bin.join("opencode");
    create_fake_opencode(&home_opencode)?;
    let empty_bin = root.join("empty-bin");
    fs::create_dir_all(&empty_bin)?;
    let fallback_path = format!("{}:/usr/bin:/bin", empty_bin.to_string_lossy());

    let _override_guard = set_env_var("OPENDUCKTOR_OPENCODE_BINARY", "   ");
    let _home_guard = set_env_var("HOME", root.to_string_lossy().as_ref());
    let _path_guard = set_env_var("PATH", fallback_path.as_str());

    let resolved = resolve_opencode_binary_path();
    assert_eq!(
        resolved.as_deref(),
        Some(home_opencode.to_string_lossy().as_ref())
    );
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn resolve_opencode_binary_path_prefers_home_fallback_before_path() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("opencode-path-priority");
    let path_bin = root.join("path-bin");
    let home_bin = root.join(".opencode").join("bin");
    fs::create_dir_all(&path_bin)?;
    fs::create_dir_all(&home_bin)?;
    let path_opencode = path_bin.join("opencode");
    let home_opencode = home_bin.join("opencode");
    create_fake_opencode(&path_opencode)?;
    create_fake_opencode(&home_opencode)?;

    let _override_guard = remove_env_var("OPENDUCKTOR_OPENCODE_BINARY");
    let _home_guard = set_env_var("HOME", root.to_string_lossy().as_ref());
    let _path_guard = prepend_path(&path_bin);

    let resolved = resolve_opencode_binary_path();
    assert_eq!(
        resolved.as_deref(),
        Some(home_opencode.to_string_lossy().as_ref())
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn resolve_opencode_binary_path_uses_path_when_home_is_unset() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("opencode-path-without-home");
    let path_bin = root.join("path-bin");
    fs::create_dir_all(&path_bin)?;
    let path_opencode = path_bin.join("opencode");
    create_fake_opencode(&path_opencode)?;

    let _override_guard = remove_env_var("OPENDUCKTOR_OPENCODE_BINARY");
    let _home_guard = remove_env_var("HOME");
    let _path_guard = prepend_path(&path_bin);

    let resolved = resolve_opencode_binary_path();
    assert_eq!(
        resolved.as_deref(),
        Some(path_opencode.to_string_lossy().as_ref())
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[cfg(unix)]
#[test]
fn resolve_opencode_binary_path_skips_non_executable_path_entry() -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let _env_lock = lock_env();
    let root = unique_temp_path("opencode-path-non-executable");
    let path_bin = root.join("path-bin");
    let fallback_bin = root.join("fallback-bin");
    fs::create_dir_all(&path_bin)?;
    fs::create_dir_all(&fallback_bin)?;
    let non_executable = path_bin.join("opencode");
    let fallback = fallback_bin.join("opencode");
    fs::write(&non_executable, "#!/bin/sh\nexit 0\n")?;
    fs::set_permissions(&non_executable, std::fs::Permissions::from_mode(0o644))?;
    create_fake_opencode(&fallback)?;

    let _override_guard = remove_env_var("OPENDUCKTOR_OPENCODE_BINARY");
    let _home_guard = remove_env_var("HOME");
    let _path_guard = set_env_var(
        "PATH",
        format!(
            "{}:{}:/usr/bin:/bin",
            path_bin.to_string_lossy(),
            fallback_bin.to_string_lossy()
        )
        .as_str(),
    );

    let resolved = resolve_opencode_binary_path();
    assert_eq!(
        resolved.as_deref(),
        Some(fallback.to_string_lossy().as_ref())
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn find_openducktor_workspace_root_uses_workspace_markers_instead_of_fixed_depth() -> Result<()> {
    let root = unique_temp_path("workspace-root-discovery");
    let nested_manifest = root.join("apps").join("desktop").join("src-tauri");
    fs::create_dir_all(root.join("apps"))?;
    fs::create_dir_all(root.join("packages"))?;
    fs::create_dir_all(&nested_manifest)?;
    fs::write(root.join("bun.lock"), "")?;
    fs::write(
        root.join("package.json"),
        r#"{"name":"openducktor","private":true}"#,
    )?;

    let resolved = find_openducktor_workspace_root(&nested_manifest)?;
    assert_eq!(resolved, root);

    let _ = fs::remove_dir_all(resolved);
    Ok(())
}

#[test]
fn resolve_mcp_command_prefers_workspace_entrypoint_and_preserves_fallbacks() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("mcp-command-fallbacks");
    let cli_bin = root.join("cli-bin");
    let empty_bin = root.join("empty-bin");
    let bun_bin = root.join("bun-bin");
    fs::create_dir_all(&cli_bin)?;
    fs::create_dir_all(&empty_bin)?;
    fs::create_dir_all(&bun_bin)?;
    write_executable_script(&cli_bin.join("openducktor-mcp"), "#!/bin/sh\nexit 0\n")?;
    write_executable_script(&bun_bin.join("bun"), "#!/bin/sh\nexit 0\n")?;

    let _mcp_env_guard = remove_env_var("OPENDUCKTOR_MCP_COMMAND_JSON");

    let workspace_direct = root.join("workspace-direct");
    let direct_entrypoint = workspace_direct
        .join("packages")
        .join("openducktor-mcp")
        .join("src")
        .join("index.ts");
    fs::create_dir_all(
        direct_entrypoint
            .parent()
            .expect("entrypoint parent should exist"),
    )?;
    fs::write(&direct_entrypoint, "console.log('mcp');\n")?;

    {
        let _workspace_guard = remove_env_var("OPENDUCKTOR_WORKSPACE_ROOT");
        let path = format!("{}:/usr/bin:/bin", empty_bin.to_string_lossy());
        let _path_guard = set_env_var("PATH", path.as_str());
        let _bun_override_guard = set_env_var("OPENDUCKTOR_BUN_PATH", "/tmp/odt-missing-bun");
        let error = resolve_mcp_command().expect_err("missing mcp + bun should fail");
        assert!(error
            .to_string()
            .contains("Configured command override OPENDUCKTOR_BUN_PATH points to a missing file"));
    }

    {
        let _workspace_guard =
            set_env_var("OPENDUCKTOR_WORKSPACE_ROOT", "/tmp/odt-missing-workspace");
        let path = format!("{}:/usr/bin:/bin", cli_bin.to_string_lossy());
        let _path_guard = set_env_var("PATH", path.as_str());
        let _bun_override_guard = remove_env_var("OPENDUCKTOR_BUN_PATH");
        let command = resolve_mcp_command()?;
        assert_eq!(
            command,
            vec![cli_bin
                .join("openducktor-mcp")
                .to_string_lossy()
                .to_string()]
        );
    }

    {
        let path = format!(
            "{}:{}:/usr/bin:/bin",
            cli_bin.to_string_lossy(),
            bun_bin.to_string_lossy()
        );
        let _path_guard = set_env_var("PATH", path.as_str());
        let _workspace_guard = set_env_var(
            "OPENDUCKTOR_WORKSPACE_ROOT",
            workspace_direct.to_string_lossy().as_ref(),
        );
        let command = resolve_mcp_command()?;
        assert_eq!(
            command,
            vec![
                bun_bin.join("bun").to_string_lossy().to_string(),
                direct_entrypoint.to_string_lossy().to_string()
            ]
        );
    }

    {
        let path = format!("{}:/usr/bin:/bin", cli_bin.to_string_lossy());
        let _path_guard = set_env_var("PATH", path.as_str());
        let _workspace_guard =
            set_env_var("OPENDUCKTOR_WORKSPACE_ROOT", "/tmp/odt-missing-workspace");
        let command = resolve_mcp_command()?;
        assert_eq!(
            command,
            vec![cli_bin
                .join("openducktor-mcp")
                .to_string_lossy()
                .to_string()]
        );
    }

    let workspace_filter = root.join("workspace-filter");
    fs::create_dir_all(&workspace_filter)?;
    {
        let path = format!(
            "{}:{}:/usr/bin:/bin",
            cli_bin.to_string_lossy(),
            bun_bin.to_string_lossy()
        );
        let _path_guard = set_env_var("PATH", path.as_str());
        let _workspace_guard = set_env_var(
            "OPENDUCKTOR_WORKSPACE_ROOT",
            workspace_filter.to_string_lossy().as_ref(),
        );
        let command = resolve_mcp_command()?;
        assert_eq!(
            command,
            vec![cli_bin
                .join("openducktor-mcp")
                .to_string_lossy()
                .to_string()]
        );
    }

    {
        let path = format!("{}:/usr/bin:/bin", bun_bin.to_string_lossy());
        let _path_guard = set_env_var("PATH", path.as_str());
        let _workspace_guard = set_env_var(
            "OPENDUCKTOR_WORKSPACE_ROOT",
            workspace_filter.to_string_lossy().as_ref(),
        );
        let command = resolve_mcp_command()?;
        assert_eq!(
            command,
            vec![
                bun_bin.join("bun").to_string_lossy().to_string(),
                "run".to_string(),
                "--silent".to_string(),
                "--cwd".to_string(),
                workspace_filter.to_string_lossy().to_string(),
                "--filter".to_string(),
                "@openducktor/mcp".to_string(),
                "start".to_string(),
            ]
        );
    }

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn default_mcp_workspace_root_supports_home_shorthand_override() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("mcp-workspace-root-tilde");
    let home = root.join("home");
    let workspace = home.join("workspace-root");
    fs::create_dir_all(&workspace)?;

    let _home_guard = set_env_var("HOME", home.to_string_lossy().as_ref());
    let _workspace_guard = set_env_var("OPENDUCKTOR_WORKSPACE_ROOT", "~/workspace-root");

    assert_eq!(
        default_mcp_workspace_root()?,
        workspace.to_string_lossy().to_string()
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn default_mcp_workspace_root_ignores_empty_override() -> Result<()> {
    let _env_lock = lock_env();
    let _workspace_guard = set_env_var("OPENDUCKTOR_WORKSPACE_ROOT", "   ");
    let resolved = default_mcp_workspace_root()?;
    assert!(!resolved.trim().is_empty());
    Ok(())
}

#[test]
fn parse_mcp_command_json_accepts_non_empty_string_array() {
    let parsed = parse_mcp_command_json(r#"["openducktor-mcp","--repo","/tmp/repo"]"#)
        .expect("command should parse");
    assert_eq!(
        parsed,
        vec![
            "openducktor-mcp".to_string(),
            "--repo".to_string(),
            "/tmp/repo".to_string()
        ]
    );
}

#[test]
fn parse_mcp_command_json_rejects_invalid_payloads() {
    assert!(parse_mcp_command_json("{}").is_err());
    assert!(parse_mcp_command_json("[]").is_err());
    assert!(parse_mcp_command_json(r#"["openducktor-mcp",""]"#).is_err());
}

#[test]
fn parse_mcp_command_json_trims_entries() {
    let parsed = parse_mcp_command_json(r#"["  openducktor-mcp  "," --repo "," /tmp/repo "]"#)
        .expect("command should parse");
    assert_eq!(
        parsed,
        vec![
            "openducktor-mcp".to_string(),
            "--repo".to_string(),
            "/tmp/repo".to_string()
        ]
    );
}

#[test]
fn build_opencode_config_content_embeds_mcp_command_and_env() {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-opencode-config-content");
    let _dolt_guard = install_fake_dolt(&root).expect("fake dolt should install");
    let previous = std::env::var("OPENDUCKTOR_MCP_COMMAND_JSON").ok();
    std::env::set_var(
        "OPENDUCKTOR_MCP_COMMAND_JSON",
        r#"["/usr/local/bin/openducktor-mcp","--stdio"]"#,
    );

    let config =
        build_opencode_config_content(Path::new("/tmp/openducktor-repo"), "http://127.0.0.1:14327")
            .expect("config should serialize");

    match previous {
        Some(value) => std::env::set_var("OPENDUCKTOR_MCP_COMMAND_JSON", value),
        None => std::env::remove_var("OPENDUCKTOR_MCP_COMMAND_JSON"),
    }
    let _ = fs::remove_dir_all(root);

    let parsed: Value = serde_json::from_str(&config).expect("valid json");
    assert_eq!(parsed["logLevel"].as_str(), Some("INFO"));
    let command = parsed["mcp"]["openducktor"]["command"]
        .as_array()
        .expect("command array")
        .iter()
        .filter_map(|entry| entry.as_str())
        .collect::<Vec<_>>();
    assert_eq!(command, vec!["/usr/local/bin/openducktor-mcp", "--stdio"]);

    let env = &parsed["mcp"]["openducktor"]["environment"];
    assert_eq!(env["ODT_REPO_PATH"].as_str(), Some("/tmp/openducktor-repo"));
    assert_eq!(env["ODT_HOST_URL"].as_str(), Some("http://127.0.0.1:14327"));
}
