use super::support::*;

#[test]
fn app_service_new_constructor_is_callable() -> Result<()> {
    let config_store = AppConfigStore::from_path(unique_temp_path("new-constructor"));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: Arc::new(Mutex::new(TaskStoreState {
            diagnose_calls: Vec::new(),
            diagnose_error: None,
            diagnose_health: None,
            ensure_calls: Vec::new(),
            ensure_error: None,
            tasks: Vec::new(),
            list_calls: Vec::new(),
            list_pull_request_sync_candidate_calls: Vec::new(),
            get_task_calls: Vec::new(),
            get_task_error: None,
            list_error: None,
            delete_calls: Vec::new(),
            delete_error: None,
            created_inputs: Vec::new(),
            updated_patches: Vec::new(),
            spec_get_calls: Vec::new(),
            spec_set_calls: Vec::new(),
            plan_get_calls: Vec::new(),
            plan_set_calls: Vec::new(),
            metadata_get_calls: Vec::new(),
            metadata_spec: None,
            metadata_plan: None,
            metadata_target_branch: None,
            qa_append_calls: Vec::new(),
            qa_outcome_calls: Vec::new(),
            latest_qa_report: None,
            agent_sessions: Vec::new(),
            upserted_sessions: Vec::new(),
            cleared_session_roles: Vec::new(),
            clear_agent_sessions_error: None,
            cleared_workflow_documents: Vec::new(),
            cleared_qa_reports: Vec::new(),
            set_delivery_metadata_error: None,
            pull_requests: std::collections::HashMap::new(),
            direct_merge_records: std::collections::HashMap::new(),
        })),
    });

    let service = AppService::new(task_store, config_store);
    let _ = service.runtime_check()?;
    Ok(())
}

#[test]
fn open_in_tool_discovery_uses_cached_results_without_rerunning_discovery() -> Result<()> {
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let discovery_calls = Arc::new(AtomicU64::new(0));

    let first_result = {
        let discovery_calls = discovery_calls.clone();
        service.list_open_in_tools_with_discovery(false, move || {
            discovery_calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec![
                SystemOpenInToolInfo {
                    tool_id: SystemOpenInToolId::Finder,
                    icon_data_url: None,
                },
                SystemOpenInToolInfo {
                    tool_id: SystemOpenInToolId::Ghostty,
                    icon_data_url: Some("data:image/png;base64,ghostty".to_string()),
                },
            ])
        })?
    };
    let second_result = {
        let discovery_calls = discovery_calls.clone();
        service.list_open_in_tools_with_discovery(false, move || {
            discovery_calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec![SystemOpenInToolInfo {
                tool_id: SystemOpenInToolId::Finder,
                icon_data_url: None,
            }])
        })?
    };

    assert_eq!(discovery_calls.load(Ordering::SeqCst), 1);
    assert_eq!(first_result, second_result);
    Ok(())
}

#[test]
fn open_in_tool_discovery_force_refresh_bypasses_cached_results() -> Result<()> {
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let discovery_calls = Arc::new(AtomicU64::new(0));

    let _ = {
        let discovery_calls = discovery_calls.clone();
        service.list_open_in_tools_with_discovery(false, move || {
            discovery_calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec![SystemOpenInToolInfo {
                tool_id: SystemOpenInToolId::Finder,
                icon_data_url: None,
            }])
        })?
    };
    let refreshed_result = {
        let discovery_calls = discovery_calls.clone();
        service.list_open_in_tools_with_discovery(true, move || {
            discovery_calls.fetch_add(1, Ordering::SeqCst);
            Ok(vec![SystemOpenInToolInfo {
                tool_id: SystemOpenInToolId::Zed,
                icon_data_url: Some("data:image/png;base64,zed".to_string()),
            }])
        })?
    };

    assert_eq!(discovery_calls.load(Ordering::SeqCst), 2);
    assert_eq!(refreshed_result[0].tool_id, SystemOpenInToolId::Zed);
    Ok(())
}

#[test]
fn open_directory_in_tool_rejects_missing_directory_paths_before_launch() {
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let missing_path = unique_temp_path("open-in-missing-directory");

    let error = service
        .open_directory_in_tool(
            missing_path.to_string_lossy().as_ref(),
            SystemOpenInToolId::Finder,
        )
        .expect_err("missing directory should fail before launch");

    assert!(error.to_string().contains("Directory does not exist"));
}

#[test]
fn open_directory_in_tool_rejects_non_directory_paths_before_launch() {
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let file_path = unique_temp_path("open-in-file-path");
    fs::write(&file_path, "not a directory").expect("test file should be created");

    let error = service
        .open_directory_in_tool(
            file_path.to_string_lossy().as_ref(),
            SystemOpenInToolId::Finder,
        )
        .expect_err("file path should fail before launch");

    assert!(error.to_string().contains("Path is not a directory"));
    let _ = fs::remove_file(file_path);
}

#[test]
fn open_directory_in_tool_passes_validated_directory_and_tool_to_launcher() -> Result<()> {
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let directory_path = unique_temp_path("open-in-valid-directory");
    fs::create_dir_all(&directory_path).context("test directory should be created")?;
    let launched = Arc::new(Mutex::new(None::<(std::path::PathBuf, SystemOpenInToolId)>));

    service.open_directory_in_tool_with_launcher(
        directory_path.to_string_lossy().as_ref(),
        SystemOpenInToolId::Ghostty,
        {
            let launched = launched.clone();
            move |directory, tool_id| {
                *launched
                    .lock()
                    .expect("launcher capture lock should not be poisoned") =
                    Some((directory.to_path_buf(), tool_id));
                Ok(())
            }
        },
    )?;

    assert_eq!(
        *launched
            .lock()
            .expect("launcher capture lock should not be poisoned"),
        Some((directory_path.clone(), SystemOpenInToolId::Ghostty))
    );
    fs::remove_dir_all(&directory_path).context("test directory should be removed")?;
    Ok(())
}

#[test]
fn open_directory_in_tool_preserves_significant_spaces_in_directory_path() -> Result<()> {
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let parent_directory = unique_temp_path("open-in-space-parent");
    let padded_directory = parent_directory.join(" repo-with-space ");
    fs::create_dir_all(&padded_directory).context("padded test directory should be created")?;
    let launched = Arc::new(Mutex::new(None::<std::path::PathBuf>));

    service.open_directory_in_tool_with_launcher(
        padded_directory.to_string_lossy().as_ref(),
        SystemOpenInToolId::Finder,
        {
            let launched = launched.clone();
            move |directory, _tool_id| {
                *launched
                    .lock()
                    .expect("launcher capture lock should not be poisoned") =
                    Some(directory.to_path_buf());
                Ok(())
            }
        },
    )?;

    assert_eq!(
        *launched
            .lock()
            .expect("launcher capture lock should not be poisoned"),
        Some(padded_directory.clone())
    );
    fs::remove_dir_all(&parent_directory).context("padded test directories should be removed")?;
    Ok(())
}
