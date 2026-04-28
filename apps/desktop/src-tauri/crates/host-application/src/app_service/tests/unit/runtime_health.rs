use super::support::*;

#[test]
fn repo_runtime_health_startup_failure_respects_runtime_mcp_capability() -> Result<()> {
    let repo_path = unique_temp_path("runtime-health-no-mcp-startup-failure");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let runtime_definition = test_runtime_definition_without_mcp_status(
        "test-runtime",
        "Test Runtime",
        RuntimeProvisioningMode::External,
    );
    let runtime_registry = AppRuntimeRegistry::new(
        vec![
            Arc::new(TestRuntimeAdapter::opencode()),
            Arc::new(
                TestRuntimeAdapter::new(runtime_definition).with_external_start_behavior(
                    ExternalStartBehavior::ReturnError("startup rejected"),
                ),
            ),
        ],
        AgentRuntimeKind::opencode(),
    )?;
    let (service, _task_state, _git_state) =
        build_service_with_runtime_registry(vec![], runtime_registry);
    let repo_path_string = repo_path.to_string_lossy().to_string();
    service.workspace_add(repo_path_string.as_str())?;

    let health = service.repo_runtime_health("test-runtime", repo_path_string.as_str())?;

    assert!(health
        .runtime
        .detail
        .as_deref()
        .unwrap_or_default()
        .contains("startup rejected"));
    assert_eq!(
        health.runtime.status,
        host_domain::RepoRuntimeHealthState::Error
    );
    assert!(health.mcp.is_none());

    Ok(())
}
