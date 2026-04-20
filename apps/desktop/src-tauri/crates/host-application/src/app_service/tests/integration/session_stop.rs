use anyhow::Result;
use host_domain::{AgentRuntimeKind, AgentSessionStopRequest, BuildSessionBootstrap, TaskStatus};
use host_infra_system::AppConfigStore;
use std::fs;
use std::path::Path;
use std::time::Duration;

use super::support::{test_git_current_branch, test_repo_config, TEST_RUNTIME_KIND, TEST_TASK_ID};
use crate::app_service::test_support::{
    build_service_with_store, create_fake_opencode, init_git_repo, install_fake_dolt, lock_env,
    make_session, make_task, set_env_var, set_fake_opencode_and_bridge_binaries, unique_temp_path,
    wait_for_path_exists, workspace_update_repo_config_by_repo_path,
};
use crate::app_service::AppService;

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

fn start_build_session(
    service: &AppService,
    repo_path: &str,
    external_session_id: Option<&str>,
) -> Result<BuildSessionBootstrap> {
    let bootstrap = service.build_start(repo_path, TEST_TASK_ID, TEST_RUNTIME_KIND)?;
    let mut session = make_session(TEST_TASK_ID, "build-session");
    session.role = "build".to_string();
    session.working_directory = bootstrap.working_directory.clone();
    session.external_session_id = external_session_id.map(str::to_string);
    assert!(service.agent_session_upsert(repo_path, TEST_TASK_ID, session)?);
    Ok(bootstrap)
}

#[test]
fn agent_session_stop_aborts_builder_session_via_repo_runtime_probe() -> Result<()> {
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
    let _session_status_guard = set_env_var(
        "OPENDUCKTOR_TEST_SESSION_STATUS_BODY",
        r#"{"external-build-session":{"type":"busy"}}"#,
    );

    let (service, repo_path) = create_session_stop_service(&root, "builder-worktrees")?;
    let bootstrap =
        start_build_session(&service, repo_path.as_str(), Some("external-build-session"))?;

    let stopped = service.agent_session_stop(make_agent_session_stop_request(
        repo_path.as_str(),
        "build-session",
        bootstrap.working_directory.as_str(),
        Some("external-build-session"),
    ))?;

    assert!(stopped);
    assert!(wait_for_path_exists(
        aborts_file.as_path(),
        Duration::from_secs(2),
    ));
    let abort_request = fs::read_to_string(aborts_file.as_path())?;
    assert!(abort_request.contains("/session/external-build-session/abort?directory="));

    let runtime = service.runtime_list(TEST_RUNTIME_KIND, Some(repo_path.as_str()))?;
    assert_eq!(runtime.len(), 1);
    assert!(service.runtime_stop(runtime[0].runtime_id.as_str())?);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn agent_session_stop_rejects_sessions_without_external_runtime_id() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("agent-session-stop-missing-external-id");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _dolt_guard = install_fake_dolt(&root)?;
    let _runtime_binary_guards = set_fake_opencode_and_bridge_binaries(fake_opencode.as_path());

    let (service, repo_path) = create_session_stop_service(&root, "builder-worktrees")?;
    let bootstrap = start_build_session(&service, repo_path.as_str(), None)?;

    let error = service
        .agent_session_stop(make_agent_session_stop_request(
            repo_path.as_str(),
            "build-session",
            bootstrap.working_directory.as_str(),
            None,
        ))
        .expect_err("missing external session id should fail fast");

    assert!(error
        .to_string()
        .contains("Session build-session is missing an external runtime session id"));

    let runtime = service.runtime_list(TEST_RUNTIME_KIND, Some(repo_path.as_str()))?;
    assert_eq!(runtime.len(), 1);
    assert!(service.runtime_stop(runtime[0].runtime_id.as_str())?);

    let _ = fs::remove_dir_all(root);
    Ok(())
}
