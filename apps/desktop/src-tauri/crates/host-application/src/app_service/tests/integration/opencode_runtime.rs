use anyhow::Result;
use host_domain::{
    AgentRuntimeKind, BuildContinuationTargetSource, GitCurrentBranch, RunState, RunSummary,
    RuntimeInstanceSummary, RuntimeRole,
};
use host_infra_system::{AppConfigStore, HookSet, RepoConfig};
use std::fs;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use crate::app_service::opencode_runtime::test_support::{
    read_opencode_process_registry, OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH,
};
use crate::app_service::test_support::{
    build_service_with_store, builtin_opencode_runtime_descriptor, builtin_opencode_runtime_route,
    create_fake_opencode, init_git_repo, install_fake_dolt, lock_env, make_session, make_task,
    set_env_var, set_fake_opencode_and_bridge_binaries, spawn_sleep_process, unique_temp_path,
    wait_for_path_exists, wait_for_process_exit,
};
use crate::app_service::{AgentRuntimeProcess, RunProcess};

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

fn run_summary_fixture(repo_path: &str, task_id: &str, worktree_path: &str) -> RunSummary {
    RunSummary {
        run_id: "run-1".to_string(),
        runtime_kind: AgentRuntimeKind::opencode(),
        runtime_route: builtin_opencode_runtime_route(4444),
        repo_path: repo_path.to_string(),
        task_id: task_id.to_string(),
        branch: format!("obp/{task_id}"),
        worktree_path: worktree_path.to_string(),
        port: Some(4444),
        state: RunState::Running,
        last_message: None,
        started_at: "2026-02-22T08:00:00.000Z".to_string(),
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
    let _dolt_guard = install_fake_dolt(&root)?;
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());

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

    let repo_path = fs::canonicalize(&repo)?.to_string_lossy().to_string();
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
fn opencode_workspace_runtime_ensure_deduplicates_parallel_startup() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-workspace-parallel-ensure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let starts_file = root.join("started-pids.log");
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());
    let _delay_guard = set_env_var("OPENDUCKTOR_TEST_STARTUP_DELAY_MS", "400");
    let _starts_guard = set_env_var(
        "OPENDUCKTOR_TEST_STARTS_FILE",
        starts_file.to_string_lossy().as_ref(),
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

    let repo_path = fs::canonicalize(&repo)?.to_string_lossy().to_string();
    let (first, second) = thread::scope(
        |scope| -> Result<(RuntimeInstanceSummary, RuntimeInstanceSummary)> {
            let first_handle =
                scope.spawn(|| service.runtime_ensure("opencode", repo_path.as_str()));
            let second_handle =
                scope.spawn(|| service.runtime_ensure("opencode", repo_path.as_str()));

            let first = first_handle
                .join()
                .expect("first ensure thread should join")?;
            let second = second_handle
                .join()
                .expect("second ensure thread should join")?;
            Ok((first, second))
        },
    )?;

    assert_eq!(first.runtime_id, second.runtime_id);

    let started_pids_file = fs::read_to_string(starts_file.as_path())?;
    let started_pids = started_pids_file
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>();
    assert_eq!(started_pids.len(), 1);

    let registry =
        read_opencode_process_registry(&root.join(OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH))?;
    assert_eq!(registry.len(), 1);
    assert_eq!(registry[0].child_pids.len(), 1);

    assert!(service.runtime_stop(first.runtime_id.as_str())?);
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_workspace_runtime_ensure_does_not_require_task_store_initialization() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-workspace-without-beads-init");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());

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

    let repo_path = fs::canonicalize(&repo)?.to_string_lossy().to_string();
    service.workspace_add(repo_path.as_str())?;
    task_state.lock().expect("task lock poisoned").ensure_error = Some("init failed".to_string());

    let runtime = service.runtime_ensure("opencode", repo_path.as_str())?;
    assert_eq!(runtime.repo_path, repo_path);

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
    let _dolt_guard = install_fake_dolt(&root)?;
    let pid_file = root.join("spawned-runtime.pid");
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());
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

    let repo_path = fs::canonicalize(&repo)?.to_string_lossy().to_string();
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
                child: Some(stale_child),
                _runtime_process_guard: None,
                cleanup_target: None,
            },
        );

    let listed = service.runtime_list("opencode", None)?;
    assert!(listed.is_empty());

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_continuation_target_get_prefers_active_build_run() -> Result<()> {
    let repo_root = unique_temp_path("qa-review-target-active-run");
    let repo = repo_root.join("repo");
    init_git_repo(&repo)?;
    let worktree = repo_root.join("worktrees").join("task-1");
    fs::create_dir_all(&worktree)?;

    let config_store = AppConfigStore::from_path(repo_root.join("config.json"));
    let repo_path = fs::canonicalize(&repo)?.to_string_lossy().to_string();
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task(
            "task-1",
            "task",
            host_domain::TaskStatus::AiReview,
        )],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;
    service.runs.lock().expect("run lock poisoned").insert(
        "run-1".to_string(),
        RunProcess {
            summary: run_summary_fixture(
                repo_path.as_str(),
                "task-1",
                worktree.to_string_lossy().as_ref(),
            ),
            child: Some(spawn_sleep_process(20)),
            _runtime_process_guard: None,
            repo_path: repo_path.clone(),
            task_id: "task-1".to_string(),
            worktree_path: worktree.to_string_lossy().to_string(),
            repo_config: RepoConfig { default_runtime_kind: "opencode".to_string(),
            worktree_base_path: Some(repo_root.join("worktrees").to_string_lossy().to_string()),
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
            agent_defaults: Default::default(), ..Default::default() },
        },
    );

    let repo_path_with_trailing_separator = format!("{repo_path}/");
    let target = service
        .build_continuation_target_get(repo_path_with_trailing_separator.as_str(), "task-1")?
        .expect("active build run should produce a continuation target");
    assert_eq!(target.source, BuildContinuationTargetSource::ActiveBuildRun);
    assert_eq!(
        target.working_directory,
        worktree.to_string_lossy().to_string()
    );
    Ok(())
}

#[test]
fn build_continuation_target_get_falls_back_to_latest_builder_session_worktree() -> Result<()> {
    let repo_root = unique_temp_path("qa-review-target-session");
    let repo = repo_root.join("repo");
    init_git_repo(&repo)?;
    let worktree = repo_root.join("worktrees").join("task-1");
    fs::create_dir_all(&worktree)?;

    let config_store = AppConfigStore::from_path(repo_root.join("config.json"));
    let repo_path = fs::canonicalize(&repo)?.to_string_lossy().to_string();
    let (service, task_state, _git_state) = build_service_with_store(
        vec![make_task(
            "task-1",
            "task",
            host_domain::TaskStatus::AiReview,
        )],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;

    let mut older = make_session("task-1", "build-session-old");
    older.role = "build".to_string();
    older.started_at = "2026-02-22T08:00:00.000Z".to_string();
    older.working_directory = "/tmp/older-worktree".to_string();
    let mut latest = make_session("task-1", "build-session-new");
    latest.role = "build".to_string();
    latest.started_at = "2026-02-22T09:00:00.000Z".to_string();
    latest.working_directory = worktree.to_string_lossy().to_string();
    task_state
        .lock()
        .expect("task lock poisoned")
        .agent_sessions = vec![older, latest];

    let target = service
        .build_continuation_target_get(repo_path.as_str(), "task-1")?
        .expect("latest builder session should produce a continuation target");
    assert_eq!(target.source, BuildContinuationTargetSource::BuilderSession);
    assert_eq!(
        target.working_directory,
        worktree.to_string_lossy().to_string()
    );
    Ok(())
}

#[test]
fn build_continuation_target_get_returns_none_when_builder_worktree_is_missing() -> Result<()> {
    let repo_root = unique_temp_path("qa-review-target-missing");
    let repo = repo_root.join("repo");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(repo_root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let (service, task_state, _git_state) = build_service_with_store(
        vec![make_task(
            "task-1",
            "task",
            host_domain::TaskStatus::AiReview,
        )],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;

    let mut session = make_session("task-1", "build-session-missing");
    session.role = "build".to_string();
    session.started_at = "2026-02-22T09:00:00.000Z".to_string();
    session.working_directory = repo_root
        .join("worktrees")
        .join("missing-task-1")
        .to_string_lossy()
        .to_string();
    task_state
        .lock()
        .expect("task lock poisoned")
        .agent_sessions = vec![session];

    let target = service
        .build_continuation_target_get(repo_path.as_str(), "task-1")
        .expect("missing builder target should be represented explicitly");
    assert!(target.is_none());
    Ok(())
}

#[test]
fn build_continuation_target_get_rejects_repo_root_builder_session() -> Result<()> {
    let repo_root = unique_temp_path("qa-review-target-root");
    let repo = repo_root.join("repo");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(repo_root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let (service, task_state, _git_state) = build_service_with_store(
        vec![make_task(
            "task-1",
            "task",
            host_domain::TaskStatus::AiReview,
        )],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
        config_store,
    );
    service.workspace_add(repo_path.as_str())?;

    let mut session = make_session("task-1", "build-session");
    session.role = "build".to_string();
    session.working_directory = repo_path.clone();
    task_state
        .lock()
        .expect("task lock poisoned")
        .agent_sessions = vec![session];

    let error = service
        .build_continuation_target_get(repo_path.as_str(), "task-1")
        .expect_err("repo root builder session should be rejected");
    assert!(error.to_string().contains("repository root"));
    Ok(())
}
