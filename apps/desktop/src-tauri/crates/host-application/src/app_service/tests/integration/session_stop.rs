use anyhow::Result;
use host_domain::{
    AgentRuntimeKind, AgentSessionStopRequest, RunState, RuntimeInstanceSummary, TaskStatus,
};
use host_infra_system::AppConfigStore;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use super::support::{test_git_current_branch, test_repo_config, TEST_RUNTIME_KIND, TEST_TASK_ID};
use crate::app_service::build_orchestrator::CleanupMode;
use crate::app_service::test_support::{
    build_service_with_store, builtin_opencode_runtime_route, create_fake_opencode, init_git_repo,
    install_fake_dolt, lock_env, make_emitter, make_session, make_task, set_env_var,
    set_fake_opencode_and_bridge_binaries, unique_temp_path, wait_for_path_exists,
    workspace_update_repo_config_by_repo_path,
};
use crate::app_service::{AgentRuntimeProcess, AppService};

fn create_session_stop_service(
    root: &Path,
    worktree_base_name: &str,
) -> Result<(AppService, String)> {
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = root.join("repo").to_string_lossy().to_string();
    let worktree_base = root.join(worktree_base_name);
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task(TEST_TASK_ID, "bug", TaskStatus::Open)],
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
    Ok((service, repo_path))
}

fn make_agent_session_stop_request(
    repo_path: &str,
    session_id: &str,
    working_directory: &str,
    external_session_id: Option<&str>,
) -> AgentSessionStopRequest {
    AgentSessionStopRequest {
        repo_path: repo_path.to_string(),
        task_id: TEST_TASK_ID.to_string(),
        session_id: session_id.to_string(),
        runtime_kind: AgentRuntimeKind::opencode(),
        working_directory: working_directory.to_string(),
        external_session_id: external_session_id.map(str::to_string),
    }
}

#[test]
fn build_stop_aborts_matching_builder_session_on_shared_runtime() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-stop-aborts-builder-session");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let aborts_file = root.join("aborts.log");
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());
    let _aborts_guard = set_env_var(
        "OPENDUCKTOR_TEST_ABORTS_FILE",
        aborts_file.to_string_lossy().as_ref(),
    );
    let _session_status_guard = set_env_var(
        "OPENDUCKTOR_TEST_SESSION_STATUS_BODY",
        r#"{"external-build-session":{"type":"busy"}}"#,
    );

    let (service, repo_path) = create_session_stop_service(&root, "builder-worktrees")?;
    let emitter = make_emitter(Arc::new(Mutex::new(Vec::new())));
    let run = service.build_start(
        repo_path.as_str(),
        TEST_TASK_ID,
        TEST_RUNTIME_KIND,
        emitter.clone(),
    )?;
    let mut session = make_session(TEST_TASK_ID, "build-session");
    session.role = "build".to_string();
    session.working_directory = run.worktree_path.clone();
    session.external_session_id = Some("external-build-session".to_string());
    assert!(service.agent_session_upsert(repo_path.as_str(), TEST_TASK_ID, session)?);

    assert!(service.build_stop(run.run_id.as_str(), emitter.clone())?);
    assert!(wait_for_path_exists(
        aborts_file.as_path(),
        Duration::from_secs(2)
    ));
    let abort_request = fs::read_to_string(aborts_file.as_path())?;
    assert!(abort_request.contains("/session/external-build-session/abort?directory="));

    assert!(service.build_cleanup(run.run_id.as_str(), CleanupMode::Failure, emitter)?);
    let runtime = service.runtime_list(TEST_RUNTIME_KIND, Some(repo_path.as_str()))?;
    assert_eq!(runtime.len(), 1);
    assert!(service.runtime_stop(runtime[0].runtime_id.as_str())?);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_stop_propagates_abort_failures_without_marking_run_stopped() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-stop-abort-failure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let aborts_file = root.join("aborts.log");
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());
    let _aborts_guard = set_env_var(
        "OPENDUCKTOR_TEST_ABORTS_FILE",
        aborts_file.to_string_lossy().as_ref(),
    );
    let _abort_status_guard = set_env_var("OPENDUCKTOR_TEST_ABORT_STATUS", "500");
    let _session_status_guard = set_env_var(
        "OPENDUCKTOR_TEST_SESSION_STATUS_BODY",
        r#"{"external-build-session":{"type":"busy"}}"#,
    );

    let (service, repo_path) = create_session_stop_service(&root, "builder-worktrees")?;
    let emitter = make_emitter(Arc::new(Mutex::new(Vec::new())));
    let run = service.build_start(
        repo_path.as_str(),
        TEST_TASK_ID,
        TEST_RUNTIME_KIND,
        emitter.clone(),
    )?;
    let mut session = make_session(TEST_TASK_ID, "build-session");
    session.role = "build".to_string();
    session.working_directory = run.worktree_path.clone();
    session.external_session_id = Some("external-build-session".to_string());
    assert!(service.agent_session_upsert(repo_path.as_str(), TEST_TASK_ID, session)?);

    let error = service
        .build_stop(run.run_id.as_str(), emitter.clone())
        .expect_err("abort failures should surface to the caller");
    assert!(error.to_string().contains(
        "OpenCode runtime rejected abort for session external-build-session with status 500"
    ));
    let listed_runs = service.runs_list(Some(repo_path.as_str()))?;
    assert_eq!(listed_runs.len(), 1);
    assert!(matches!(listed_runs[0].state, RunState::Running));
    assert!(wait_for_path_exists(
        aborts_file.as_path(),
        Duration::from_secs(2)
    ));

    assert!(service.build_cleanup(run.run_id.as_str(), CleanupMode::Failure, emitter)?);
    let runtime = service.runtime_list(TEST_RUNTIME_KIND, Some(repo_path.as_str()))?;
    assert_eq!(runtime.len(), 1);
    assert!(service.runtime_stop(runtime[0].runtime_id.as_str())?);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn agent_session_stop_marks_the_matching_build_run_stopped() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("agent-session-stop-build");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let aborts_file = root.join("aborts.log");
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());
    let _aborts_guard = set_env_var(
        "OPENDUCKTOR_TEST_ABORTS_FILE",
        aborts_file.to_string_lossy().as_ref(),
    );

    let (service, repo_path) = create_session_stop_service(&root, "builder-worktrees")?;
    let emitter = make_emitter(Arc::new(Mutex::new(Vec::new())));
    let run = service.build_start(
        repo_path.as_str(),
        TEST_TASK_ID,
        TEST_RUNTIME_KIND,
        emitter.clone(),
    )?;
    let mut session = make_session(TEST_TASK_ID, "build-session");
    session.role = "build".to_string();
    session.working_directory = run.worktree_path.clone();
    session.external_session_id = Some("external-build-session".to_string());
    assert!(service.agent_session_upsert(repo_path.as_str(), TEST_TASK_ID, session)?);

    let stopped = service.agent_session_stop(
        make_agent_session_stop_request(
            repo_path.as_str(),
            "build-session",
            run.worktree_path.as_str(),
            Some("external-build-session"),
        ),
        emitter.clone(),
    )?;

    assert!(stopped);
    assert!(wait_for_path_exists(
        aborts_file.as_path(),
        Duration::from_secs(2)
    ));
    let abort_request = fs::read_to_string(aborts_file.as_path())?;
    assert!(abort_request.contains("/session/external-build-session/abort?directory="));
    let listed_runs = service.runs_list(Some(repo_path.as_str()))?;
    assert_eq!(listed_runs.len(), 1);
    assert!(matches!(listed_runs[0].state, RunState::Stopped));

    assert!(service.build_cleanup(run.run_id.as_str(), CleanupMode::Failure, emitter)?);
    let runtime = service.runtime_list(TEST_RUNTIME_KIND, Some(repo_path.as_str()))?;
    assert_eq!(runtime.len(), 1);
    assert!(service.runtime_stop(runtime[0].runtime_id.as_str())?);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn agent_session_stop_targets_shared_runtime_qa_sessions_without_stopping_the_build_run(
) -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("agent-session-stop-qa");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let aborts_file = root.join("aborts.log");
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());
    let _aborts_guard = set_env_var(
        "OPENDUCKTOR_TEST_ABORTS_FILE",
        aborts_file.to_string_lossy().as_ref(),
    );

    let (service, repo_path) = create_session_stop_service(&root, "builder-worktrees")?;
    let emitter = make_emitter(Arc::new(Mutex::new(Vec::new())));
    let run = service.build_start(
        repo_path.as_str(),
        TEST_TASK_ID,
        TEST_RUNTIME_KIND,
        emitter.clone(),
    )?;

    let mut build_session = make_session(TEST_TASK_ID, "build-session");
    build_session.role = "build".to_string();
    build_session.working_directory = run.worktree_path.clone();
    build_session.external_session_id = Some("external-build-session".to_string());
    assert!(service.agent_session_upsert(repo_path.as_str(), TEST_TASK_ID, build_session)?);

    let mut qa_session = make_session(TEST_TASK_ID, "qa-session");
    qa_session.role = "qa".to_string();
    qa_session.working_directory = run.worktree_path.clone();
    qa_session.external_session_id = Some("external-qa-session".to_string());
    assert!(service.agent_session_upsert(repo_path.as_str(), TEST_TASK_ID, qa_session)?);

    let stopped = service.agent_session_stop(
        make_agent_session_stop_request(
            repo_path.as_str(),
            "qa-session",
            run.worktree_path.as_str(),
            Some("external-qa-session"),
        ),
        emitter.clone(),
    )?;

    assert!(stopped);
    assert!(wait_for_path_exists(
        aborts_file.as_path(),
        Duration::from_secs(2)
    ));
    let abort_request = fs::read_to_string(aborts_file.as_path())?;
    assert!(abort_request.contains("/session/external-qa-session/abort?directory="));
    assert!(!abort_request.contains("external-build-session"));
    let stored_run_state = {
        let runs = service.runs.lock().expect("run lock poisoned");
        runs.get(run.run_id.as_str())
            .expect("build run should remain registered")
            .summary
            .state
            .clone()
    };
    assert!(matches!(stored_run_state, RunState::Running));

    assert!(service.build_cleanup(run.run_id.as_str(), CleanupMode::Failure, emitter)?);
    let runtime = service.runtime_list(TEST_RUNTIME_KIND, Some(repo_path.as_str()))?;
    assert_eq!(runtime.len(), 1);
    assert!(service.runtime_stop(runtime[0].runtime_id.as_str())?);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn agent_session_stop_stops_recovered_build_sessions_without_active_runs() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("agent-session-stop-recovered-build");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let aborts_file = root.join("aborts.log");
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());
    let _aborts_guard = set_env_var(
        "OPENDUCKTOR_TEST_ABORTS_FILE",
        aborts_file.to_string_lossy().as_ref(),
    );

    let (service, repo_path) = create_session_stop_service(&root, "builder-worktrees")?;
    let runtime = service.runtime_ensure(TEST_RUNTIME_KIND, repo_path.as_str())?;
    let recovered_worktree = root.join("builder-worktrees/recovered-task-1");
    fs::create_dir_all(&recovered_worktree)?;
    let mut session = make_session(TEST_TASK_ID, "build-session");
    session.role = "build".to_string();
    session.working_directory = recovered_worktree.to_string_lossy().to_string();
    session.external_session_id = Some("external-build-session".to_string());
    assert!(service.agent_session_upsert(repo_path.as_str(), TEST_TASK_ID, session)?);

    let stopped = service.agent_session_stop(
        make_agent_session_stop_request(
            repo_path.as_str(),
            "build-session",
            recovered_worktree.to_string_lossy().as_ref(),
            Some("external-build-session"),
        ),
        make_emitter(Arc::new(Mutex::new(Vec::new()))),
    )?;

    assert!(stopped);
    assert!(wait_for_path_exists(
        aborts_file.as_path(),
        Duration::from_secs(2)
    ));
    let abort_request = fs::read_to_string(aborts_file.as_path())?;
    assert!(abort_request.contains("/session/external-build-session/abort?directory="));
    assert!(service.runtime_stop(runtime.runtime_id.as_str())?);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn agent_session_stop_stops_recovered_qa_sessions_on_repo_runtime_without_active_runs() -> Result<()>
{
    let _env_lock = lock_env();
    let root = unique_temp_path("agent-session-stop-recovered-qa");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let aborts_file = root.join("aborts.log");
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());
    let _aborts_guard = set_env_var(
        "OPENDUCKTOR_TEST_ABORTS_FILE",
        aborts_file.to_string_lossy().as_ref(),
    );

    let (service, repo_path) = create_session_stop_service(&root, "builder-worktrees")?;
    let runtime = service.runtime_ensure(TEST_RUNTIME_KIND, repo_path.as_str())?;
    let recovered_worktree = root.join("builder-worktrees/recovered-task-1");
    fs::create_dir_all(&recovered_worktree)?;
    let mut session = make_session(TEST_TASK_ID, "qa-session");
    session.role = "qa".to_string();
    session.scenario = "qa_review".to_string();
    session.working_directory = recovered_worktree.to_string_lossy().to_string();
    session.external_session_id = Some("external-qa-session".to_string());
    assert!(service.agent_session_upsert(repo_path.as_str(), TEST_TASK_ID, session)?);

    let stopped = service.agent_session_stop(
        make_agent_session_stop_request(
            repo_path.as_str(),
            "qa-session",
            recovered_worktree.to_string_lossy().as_ref(),
            Some("external-qa-session"),
        ),
        make_emitter(Arc::new(Mutex::new(Vec::new()))),
    )?;

    assert!(stopped);
    assert!(wait_for_path_exists(
        aborts_file.as_path(),
        Duration::from_secs(2)
    ));
    let abort_request = fs::read_to_string(aborts_file.as_path())?;
    assert!(abort_request.contains("/session/external-qa-session/abort?directory="));
    assert!(service.runtime_stop(runtime.runtime_id.as_str())?);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn agent_session_stop_propagates_abort_failures_without_marking_build_runs_stopped() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("agent-session-stop-abort-failure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let aborts_file = root.join("aborts.log");
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());
    let _aborts_guard = set_env_var(
        "OPENDUCKTOR_TEST_ABORTS_FILE",
        aborts_file.to_string_lossy().as_ref(),
    );
    let _abort_status_guard = set_env_var("OPENDUCKTOR_TEST_ABORT_STATUS", "500");
    let _session_status_guard = set_env_var(
        "OPENDUCKTOR_TEST_SESSION_STATUS_BODY",
        r#"{"external-build-session":{"type":"busy"}}"#,
    );

    let (service, repo_path) = create_session_stop_service(&root, "builder-worktrees")?;
    let emitter = make_emitter(Arc::new(Mutex::new(Vec::new())));
    let run = service.build_start(
        repo_path.as_str(),
        TEST_TASK_ID,
        TEST_RUNTIME_KIND,
        emitter.clone(),
    )?;
    let mut session = make_session(TEST_TASK_ID, "build-session");
    session.role = "build".to_string();
    session.working_directory = run.worktree_path.clone();
    session.external_session_id = Some("external-build-session".to_string());
    assert!(service.agent_session_upsert(repo_path.as_str(), TEST_TASK_ID, session)?);

    let error = service
        .agent_session_stop(
            make_agent_session_stop_request(
                repo_path.as_str(),
                "build-session",
                run.worktree_path.as_str(),
                Some("external-build-session"),
            ),
            emitter.clone(),
        )
        .expect_err("abort failures should surface to the caller");
    assert!(error.to_string().contains(
        "OpenCode runtime rejected abort for session external-build-session with status 500"
    ));
    let listed_runs = service.runs_list(Some(repo_path.as_str()))?;
    assert_eq!(listed_runs.len(), 1);
    assert!(matches!(listed_runs[0].state, RunState::Running));
    assert!(wait_for_path_exists(
        aborts_file.as_path(),
        Duration::from_secs(2)
    ));

    assert!(service.build_cleanup(run.run_id.as_str(), CleanupMode::Failure, emitter)?);
    let runtime = service.runtime_list(TEST_RUNTIME_KIND, Some(repo_path.as_str()))?;
    assert_eq!(runtime.len(), 1);
    assert!(service.runtime_stop(runtime[0].runtime_id.as_str())?);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn agent_session_stop_supports_workspace_scoped_planner_sessions() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("agent-session-stop-planner-workspace");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let aborts_file = root.join("aborts.log");
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());
    let _aborts_guard = set_env_var(
        "OPENDUCKTOR_TEST_ABORTS_FILE",
        aborts_file.to_string_lossy().as_ref(),
    );

    let (service, repo_path) = create_session_stop_service(&root, "planner-worktrees")?;
    let emitter = make_emitter(Arc::new(Mutex::new(Vec::new())));
    let build_run = service.build_start(
        repo_path.as_str(),
        TEST_TASK_ID,
        TEST_RUNTIME_KIND,
        emitter.clone(),
    )?;
    let build_runtime = service
        .runtime_list(TEST_RUNTIME_KIND, Some(repo_path.as_str()))?
        .into_iter()
        .next()
        .expect("build runtime should be present");
    service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .insert(
            "runtime-workspace-root".to_string(),
            AgentRuntimeProcess {
                summary: RuntimeInstanceSummary {
                    runtime_id: "runtime-workspace-root".to_string(),
                    working_directory: repo_path.clone(),
                    ..build_runtime.clone()
                },
                child: None,
                _runtime_process_guard: None,
                cleanup_target: None,
            },
        );
    let mut planner_session = make_session(TEST_TASK_ID, "planner-session");
    planner_session.role = "planner".to_string();
    planner_session.scenario = "planner_initial".to_string();
    planner_session.working_directory = repo_path.clone();
    planner_session.external_session_id = Some("external-planner-session".to_string());
    assert!(service.agent_session_upsert(repo_path.as_str(), TEST_TASK_ID, planner_session)?);

    let stopped = service.agent_session_stop(
        make_agent_session_stop_request(
            repo_path.as_str(),
            "planner-session",
            repo_path.as_str(),
            Some("external-planner-session"),
        ),
        emitter.clone(),
    )?;

    assert!(stopped);
    assert!(wait_for_path_exists(
        aborts_file.as_path(),
        Duration::from_secs(2)
    ));
    let abort_request = fs::read_to_string(aborts_file.as_path())?;
    assert!(abort_request.contains("/session/external-planner-session/abort?directory="));
    assert!(service.runtime_stop("runtime-workspace-root")?);
    assert!(service.build_cleanup(build_run.run_id.as_str(), CleanupMode::Failure, emitter)?);
    assert!(service.runtime_stop(build_runtime.runtime_id.as_str())?);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn agent_session_stop_requires_external_session_id_without_marking_build_runs_stopped() -> Result<()>
{
    let _env_lock = lock_env();
    let root = unique_temp_path("agent-session-stop-missing-external-id");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());

    let (service, repo_path) = create_session_stop_service(&root, "builder-worktrees")?;
    let emitter = make_emitter(Arc::new(Mutex::new(Vec::new())));
    let run = service.build_start(
        repo_path.as_str(),
        TEST_TASK_ID,
        TEST_RUNTIME_KIND,
        emitter.clone(),
    )?;
    let mut session = make_session(TEST_TASK_ID, "build-session");
    session.role = "build".to_string();
    session.working_directory = run.worktree_path.clone();
    session.external_session_id = None;
    assert!(service.agent_session_upsert(repo_path.as_str(), TEST_TASK_ID, session)?);

    let error = service
        .agent_session_stop(
            make_agent_session_stop_request(
                repo_path.as_str(),
                "build-session",
                run.worktree_path.as_str(),
                None,
            ),
            emitter.clone(),
        )
        .expect_err("missing external session ids should fail fast");
    assert!(error
        .to_string()
        .contains("Session build-session is missing an external runtime session id"));
    let stored_run_state = {
        let runs = service.runs.lock().expect("run lock poisoned");
        runs.get(run.run_id.as_str())
            .expect("build run should remain registered")
            .summary
            .state
            .clone()
    };
    assert!(matches!(stored_run_state, RunState::Running));

    assert!(service.build_cleanup(run.run_id.as_str(), CleanupMode::Failure, emitter)?);
    let runtime = service.runtime_list(TEST_RUNTIME_KIND, Some(repo_path.as_str()))?;
    assert_eq!(runtime.len(), 1);
    assert!(service.runtime_stop(runtime[0].runtime_id.as_str())?);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn agent_session_stop_fails_when_no_live_runtime_route_is_resolvable() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("agent-session-stop-missing-route");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());

    let (service, repo_path) = create_session_stop_service(&root, "builder-worktrees")?;
    let runtime = service.runtime_ensure(TEST_RUNTIME_KIND, repo_path.as_str())?;
    let recovered_worktree = root.join("builder-worktrees/recovered-task-1");
    fs::create_dir_all(&recovered_worktree)?;
    let mut session = make_session(TEST_TASK_ID, "build-session");
    session.role = "build".to_string();
    session.working_directory = recovered_worktree.to_string_lossy().to_string();
    session.external_session_id = Some("external-build-session".to_string());
    assert!(service.agent_session_upsert(repo_path.as_str(), TEST_TASK_ID, session)?);
    assert!(service.runtime_stop(runtime.runtime_id.as_str())?);

    let error = service
        .agent_session_stop(
            make_agent_session_stop_request(
                repo_path.as_str(),
                "build-session",
                recovered_worktree.to_string_lossy().as_ref(),
                Some("external-build-session"),
            ),
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("missing runtime routes should fail fast");
    assert!(error
        .to_string()
        .contains("No live runtime route found for session build-session"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn agent_session_stop_fails_when_multiple_live_runtime_routes_match() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("agent-session-stop-multiple-routes");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());

    let (service, repo_path) = create_session_stop_service(&root, "builder-worktrees")?;
    let emitter = make_emitter(Arc::new(Mutex::new(Vec::new())));
    let run = service.build_start(
        repo_path.as_str(),
        TEST_TASK_ID,
        TEST_RUNTIME_KIND,
        emitter.clone(),
    )?;
    let runtime_summary = service
        .runtime_list(TEST_RUNTIME_KIND, Some(repo_path.as_str()))?
        .into_iter()
        .next()
        .expect("build runtime should be present");
    let mut session = make_session(TEST_TASK_ID, "planner-session");
    session.role = "planner".to_string();
    session.scenario = "planner_initial".to_string();
    session.working_directory = repo_path.clone();
    session.external_session_id = Some("external-planner-session".to_string());
    assert!(service.agent_session_upsert(repo_path.as_str(), TEST_TASK_ID, session)?);

    service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .insert(
            "runtime-workspace-root-primary".to_string(),
            AgentRuntimeProcess {
                summary: RuntimeInstanceSummary {
                    runtime_id: "runtime-workspace-root-primary".to_string(),
                    working_directory: repo_path.clone(),
                    ..runtime_summary.clone()
                },
                child: None,
                _runtime_process_guard: None,
                cleanup_target: None,
            },
        );
    service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .insert(
            "runtime-workspace-root-secondary".to_string(),
            AgentRuntimeProcess {
                summary: RuntimeInstanceSummary {
                    runtime_id: "runtime-workspace-root-secondary".to_string(),
                    working_directory: repo_path.clone(),
                    runtime_route: builtin_opencode_runtime_route(51_234),
                    ..runtime_summary.clone()
                },
                child: None,
                _runtime_process_guard: None,
                cleanup_target: None,
            },
        );

    let error = service
        .agent_session_stop(
            make_agent_session_stop_request(
                repo_path.as_str(),
                "planner-session",
                repo_path.as_str(),
                Some("external-planner-session"),
            ),
            emitter.clone(),
        )
        .expect_err("ambiguous runtime routes should fail fast");
    assert!(error
        .to_string()
        .contains("Multiple live runtime routes matched session planner-session"));
    let stored_run_state = {
        let runs = service.runs.lock().expect("run lock poisoned");
        runs.get(run.run_id.as_str())
            .expect("build run should remain registered")
            .summary
            .state
            .clone()
    };
    assert!(matches!(stored_run_state, RunState::Running));

    assert!(service.runtime_stop("runtime-workspace-root-secondary")?);
    assert!(service.runtime_stop("runtime-workspace-root-primary")?);
    assert!(service.build_cleanup(run.run_id.as_str(), CleanupMode::Failure, emitter)?);
    assert!(service.runtime_stop(runtime_summary.runtime_id.as_str())?);

    let _ = fs::remove_dir_all(root);
    Ok(())
}
