use super::support::*;

#[test]
fn task_reset_implementation_discards_builder_state_and_rolls_back_to_ready_for_dev_from_ai_review(
) -> Result<()> {
    assert_task_reset_implementation_discards_builder_state_and_rolls_back_to_ready_for_dev(
        TaskStatus::AiReview,
    )
}

#[test]
fn task_reset_implementation_discards_builder_state_and_rolls_back_to_ready_for_dev_from_blocked(
) -> Result<()> {
    assert_task_reset_implementation_discards_builder_state_and_rolls_back_to_ready_for_dev(
        TaskStatus::Blocked,
    )
}

fn assert_task_reset_implementation_discards_builder_state_and_rolls_back_to_ready_for_dev(
    status: TaskStatus,
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let build_worktree = worktree_base.join("task-1");
    let qa_worktree = worktree_base.join("task-1-qa");
    fs::create_dir_all(&worktree_base)?;
    fs::create_dir_all(&build_worktree)?;
    fs::create_dir_all(&qa_worktree)?;

    let mut task = make_task("task-1", "task", status);
    task.document_summary.spec.has = true;
    task.document_summary.plan.has = true;
    task.document_summary.qa_report.has = true;
    task.document_summary.qa_report.verdict = QaWorkflowVerdict::Rejected;
    task.pull_request = Some(PullRequestRecord {
        provider_id: "github".to_string(),
        number: 42,
        url: "https://example.com/pr/42".to_string(),
        state: "open".to_string(),
        created_at: "2026-03-17T12:00:00Z".to_string(),
        updated_at: "2026-03-17T12:00:00Z".to_string(),
        last_synced_at: None,
        merged_at: None,
        closed_at: None,
    });

    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![
            GitBranch {
                name: "odt/task-1".to_string(),
                is_current: false,
                is_remote: false,
            },
            GitBranch {
                name: "odt/task-1-follow-up".to_string(),
                is_current: false,
                is_remote: false,
            },
        ],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let workspace = service.workspace_add(&repo_path.to_string_lossy())?;
    let canonical_repo_path = workspace.repo_path.clone();
    let repo_config = host_infra_system::RepoConfig {
        branch_prefix: "odt".to_string(),
        worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
        ..Default::default()
    };
    service.workspace_update_repo_config(
        workspace.workspace_id.as_str(),
        repo_config_for_workspace(&workspace, repo_config),
    )?;
    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.current_branches_by_path.insert(
            build_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
        state.current_branches_by_path.insert(
            qa_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1-follow-up".to_string()),
                detached: false,
                revision: None,
            },
        );
    }
    {
        let mut state = task_state.lock().expect("task store lock poisoned");
        state.agent_sessions = vec![
            AgentSessionDocument {
                session_id: "spec-session".to_string(),
                external_session_id: None,
                role: "spec".to_string(),
                scenario: "spec_initial".to_string(),
                started_at: "2026-03-17T10:00:00Z".to_string(),
                runtime_kind: "opencode".to_string(),
                working_directory: repo_path.to_string_lossy().to_string(),
                selected_model: None,
            },
            AgentSessionDocument {
                session_id: "build-session".to_string(),
                external_session_id: None,
                role: "build".to_string(),
                scenario: "build_implementation_start".to_string(),
                started_at: "2026-03-17T11:00:00Z".to_string(),
                runtime_kind: "opencode".to_string(),
                working_directory: build_worktree.to_string_lossy().to_string(),
                selected_model: None,
            },
            AgentSessionDocument {
                session_id: "qa-session".to_string(),
                external_session_id: None,
                role: "qa".to_string(),
                scenario: "qa_review".to_string(),
                started_at: "2026-03-17T12:00:00Z".to_string(),
                runtime_kind: "opencode".to_string(),
                working_directory: qa_worktree.to_string_lossy().to_string(),
                selected_model: None,
            },
        ];
        state.pull_requests.insert(
            "task-1".to_string(),
            PullRequestRecord {
                provider_id: "github".to_string(),
                number: 42,
                url: "https://example.com/pr/42".to_string(),
                state: "open".to_string(),
                created_at: "2026-03-17T12:00:00Z".to_string(),
                updated_at: "2026-03-17T12:00:00Z".to_string(),
                last_synced_at: None,
                merged_at: None,
                closed_at: None,
            },
        );
    }

    #[cfg(unix)]
    let (mut dev_server_child, dev_server_pid) = {
        let child = spawn_sleep_process_group(20);
        let pid = child.id();
        service
            .dev_server_groups
            .lock()
            .expect("dev server lock poisoned")
            .insert(
                format!("{}::task-1", canonical_repo_path),
                DevServerGroupRuntime {
                    state: DevServerGroupState {
                        repo_path: canonical_repo_path.clone(),
                        task_id: "task-1".to_string(),
                        worktree_path: Some(build_worktree.to_string_lossy().to_string()),
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
        (child, pid)
    };

    let reset_result = service.task_reset_implementation(canonical_repo_path.as_str(), "task-1");

    #[cfg(unix)]
    {
        let unix_cleanup_result = (|| -> Result<()> {
            let deadline = Instant::now() + Duration::from_secs(2);
            let exited = loop {
                if dev_server_child
                    .try_wait()
                    .context("failed checking dev server child status")?
                    .is_some()
                {
                    break true;
                }
                if Instant::now() >= deadline {
                    break false;
                }
                std::thread::sleep(Duration::from_millis(50));
            };
            if !exited {
                terminate_child_process(&mut dev_server_child);
            } else {
                let _ = dev_server_child
                    .wait()
                    .context("failed waiting dev server child")?;
            }

            assert!(wait_for_process_exit(
                dev_server_pid as i32,
                Duration::from_secs(2)
            ));

            let groups = service
                .dev_server_groups
                .lock()
                .expect("dev server lock poisoned");
            let group = groups
                .get(&format!("{}::task-1", canonical_repo_path))
                .expect("dev server group retained");
            assert!(group.state.scripts.is_empty());
            Ok(())
        })();
        unix_cleanup_result?;
    }

    let updated = reset_result?;
    assert_eq!(updated.status, TaskStatus::ReadyForDev);
    assert!(updated.pull_request.is_none());
    assert!(!updated.document_summary.qa_report.has);

    let state = task_state.lock().expect("task store lock poisoned");
    assert_eq!(
        state.cleared_session_roles,
        vec![(
            "task-1".to_string(),
            vec!["build".to_string(), "qa".to_string()]
        )]
    );
    assert_eq!(state.cleared_qa_reports, vec!["task-1".to_string()]);
    assert_eq!(state.agent_sessions.len(), 1);
    assert_eq!(state.agent_sessions[0].role, "spec");
    assert!(!state.pull_requests.contains_key("task-1"));
    drop(state);

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &build_worktree.to_string_lossy() && *force
    )));
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &qa_worktree.to_string_lossy() && *force
    )));
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::DeleteLocalBranch { branch, force, .. }
            if branch == "odt/task-1" && *force
    )));

    Ok(())
}

#[test]
fn task_reset_implementation_uses_document_presence_for_rollback_target() -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-status-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let mut ready_for_dev = make_task("task-ready", "task", TaskStatus::Blocked);
    ready_for_dev.document_summary.spec.has = true;
    ready_for_dev.document_summary.plan.has = true;

    let mut spec_ready = make_task("task-spec", "task", TaskStatus::Blocked);
    spec_ready.document_summary.spec.has = true;

    let open = make_task("task-open", "task", TaskStatus::Blocked);

    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![ready_for_dev, spec_ready, open],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    let repo_config = host_infra_system::RepoConfig {
        branch_prefix: "odt".to_string(),
        ..Default::default()
    };
    workspace_update_repo_config_by_repo_path(&service, &repo_path.to_string_lossy(), repo_config)?;

    let ready_for_dev_result =
        service.task_reset_implementation(&repo_path.to_string_lossy(), "task-ready")?;
    let spec_ready_result =
        service.task_reset_implementation(&repo_path.to_string_lossy(), "task-spec")?;
    let open_result =
        service.task_reset_implementation(&repo_path.to_string_lossy(), "task-open")?;

    assert_eq!(ready_for_dev_result.status, TaskStatus::ReadyForDev);
    assert_eq!(spec_ready_result.status, TaskStatus::SpecReady);
    assert_eq!(open_result.status, TaskStatus::Open);
    Ok(())
}

#[test]
fn task_reset_implementation_ignores_stale_persisted_build_session_without_live_runtime(
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-active-session-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    let repo_config = host_infra_system::RepoConfig {
        branch_prefix: "odt".to_string(),
        ..Default::default()
    };
    workspace_update_repo_config_by_repo_path(&service, &repo_path.to_string_lossy(), repo_config)?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let reset = service.task_reset_implementation(&repo_path.to_string_lossy(), "task-1")?;
    assert_eq!(reset.status, TaskStatus::Open);
    Ok(())
}

#[test]
fn task_reset_implementation_ignores_stale_qa_sessions_with_persisted_external_ids() -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-stale-qa-session-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    let repo_config = host_infra_system::RepoConfig {
        branch_prefix: "odt".to_string(),
        ..Default::default()
    };
    workspace_update_repo_config_by_repo_path(&service, &repo_path.to_string_lossy(), repo_config)?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "qa-session".to_string(),
        external_session_id: Some("external-qa-session".to_string()),
        role: "qa".to_string(),
        scenario: "qa_review".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let reset = service.task_reset_implementation(&repo_path.to_string_lossy(), "task-1")?;

    assert_eq!(reset.status, TaskStatus::Open);
    Ok(())
}

#[test]
fn task_reset_clears_workflow_artifacts_and_sets_status_to_open() -> Result<()> {
    let repo_path = unique_temp_path("reset-task-clears-workflow-artifacts-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let mut task = make_task("task-1", "task", TaskStatus::HumanReview);
    task.document_summary.spec.has = true;
    task.document_summary.plan.has = true;
    task.document_summary.qa_report.has = true;
    task.document_summary.qa_report.verdict = QaWorkflowVerdict::Approved;
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![
        AgentSessionDocument {
            session_id: "spec-session".to_string(),
            external_session_id: Some("external-spec-session".to_string()),
            role: "spec".to_string(),
            scenario: "spec_authoring".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: repo_path.to_string_lossy().to_string(),
            selected_model: None,
        },
        AgentSessionDocument {
            session_id: "planner-session".to_string(),
            external_session_id: Some("external-planner-session".to_string()),
            role: "planner".to_string(),
            scenario: "plan_authoring".to_string(),
            started_at: "2026-03-17T11:00:01Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: repo_path.to_string_lossy().to_string(),
            selected_model: None,
        },
        AgentSessionDocument {
            session_id: "build-session".to_string(),
            external_session_id: Some("external-build-session".to_string()),
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T11:00:02Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: repo_path.to_string_lossy().to_string(),
            selected_model: None,
        },
        AgentSessionDocument {
            session_id: "qa-session".to_string(),
            external_session_id: Some("external-qa-session".to_string()),
            role: "qa".to_string(),
            scenario: "qa_review".to_string(),
            started_at: "2026-03-17T11:00:03Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: repo_path.to_string_lossy().to_string(),
            selected_model: None,
        },
    ];
    {
        let mut state = task_state.lock().expect("task store lock poisoned");
        state.pull_requests.insert(
            "task-1".to_string(),
            PullRequestRecord {
                provider_id: "github".to_string(),
                number: 42,
                url: "https://example.com/pr/42".to_string(),
                state: "open".to_string(),
                created_at: "2026-03-17T11:00:00Z".to_string(),
                updated_at: "2026-03-17T11:05:00Z".to_string(),
                last_synced_at: None,
                merged_at: None,
                closed_at: None,
            },
        );
        state.direct_merge_records.insert(
            "task-1".to_string(),
            host_domain::DirectMergeRecord {
                method: host_domain::GitMergeMethod::Squash,
                source_branch: "odt/task-1".to_string(),
                target_branch: host_domain::GitTargetBranch {
                    remote: Some("origin".to_string()),
                    branch: "main".to_string(),
                },
                merged_at: "2026-03-17T11:10:00Z".to_string(),
            },
        );
    }
    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-1".to_string(),
            crate::app_service::RunProcess {
                summary: serde_json::from_value(json!({
                    "runId": "run-1",
                    "runtimeKind": "opencode",
                    "runtimeRoute": {
                        "type": "local_http",
                        "endpoint": "http://127.0.0.1:3001",
                    },
                    "repoPath": repo_path.to_string_lossy().to_string(),
                    "taskId": "task-1",
                    "branch": "odt/task-1",
                    "worktreePath": repo_path.to_string_lossy().to_string(),
                    "port": 3001,
                    "state": "completed",
                    "lastMessage": null,
                    "startedAt": "2026-03-17T11:00:00Z",
                }))?,
                child: None,
                _runtime_process_guard: None,
                repo_path: repo_path.to_string_lossy().to_string(),
                task_id: "task-1".to_string(),
                worktree_path: repo_path.to_string_lossy().to_string(),
                repo_config: host_infra_system::RepoConfig {
                    branch_prefix: "odt".to_string(),
                    ..Default::default()
                },
            },
        );

    let reset = service.task_reset(&repo_path.to_string_lossy(), "task-1")?;

    assert_eq!(reset.status, TaskStatus::Open);
    let state = task_state.lock().expect("task store lock poisoned");
    assert_eq!(state.cleared_workflow_documents, vec!["task-1".to_string()]);
    assert!(state.metadata_spec.is_none());
    assert!(state.metadata_plan.is_none());
    assert_eq!(
        state.cleared_session_roles,
        vec![(
            "task-1".to_string(),
            vec![
                "spec".to_string(),
                "planner".to_string(),
                "build".to_string(),
                "qa".to_string(),
            ],
        )]
    );
    assert!(!state.pull_requests.contains_key("task-1"));
    assert!(!state.direct_merge_records.contains_key("task-1"));
    assert!(state.agent_sessions.is_empty());
    drop(state);
    assert!(service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .is_empty());
    Ok(())
}

#[test]
fn task_reset_rejects_live_spec_session_status_with_task_runtime_without_run() -> Result<()> {
    assert_task_reset_rejects_live_session_status(
        TaskStatus::SpecReady,
        "spec",
        "spec_authoring",
        "Cannot reset task while active spec session(s) exist",
        false,
    )
}

#[test]
fn task_reset_rejects_live_planner_session_status_with_task_runtime_without_run() -> Result<()> {
    assert_task_reset_rejects_live_session_status(
        TaskStatus::ReadyForDev,
        "planner",
        "plan_authoring",
        "Cannot reset task while active planner session(s) exist",
        false,
    )
}

#[test]
fn task_reset_rejects_live_build_session_status_with_task_runtime_without_run() -> Result<()> {
    assert_task_reset_rejects_live_session_status(
        TaskStatus::InProgress,
        "build",
        "build_implementation_start",
        "Cannot reset task while active build session(s) exist",
        false,
    )
}

#[test]
fn task_reset_rejects_live_qa_session_status_with_task_runtime_without_run() -> Result<()> {
    assert_task_reset_rejects_live_session_status(
        TaskStatus::AiReview,
        "qa",
        "qa_review",
        "Cannot reset task while active qa session(s) exist",
        false,
    )
}

#[test]
fn task_reset_rejects_live_spec_session_status_with_workspace_runtime_without_run() -> Result<()> {
    assert_task_reset_rejects_live_session_status(
        TaskStatus::SpecReady,
        "spec",
        "spec_authoring",
        "Cannot reset task while active spec session(s) exist",
        true,
    )
}

#[test]
fn task_reset_rejects_live_planner_session_status_with_workspace_runtime_without_run() -> Result<()>
{
    assert_task_reset_rejects_live_session_status(
        TaskStatus::ReadyForDev,
        "planner",
        "plan_authoring",
        "Cannot reset task while active planner session(s) exist",
        true,
    )
}

#[test]
fn task_reset_rejects_live_build_session_status_with_workspace_runtime_without_run() -> Result<()> {
    assert_task_reset_rejects_live_session_status(
        TaskStatus::InProgress,
        "build",
        "build_implementation_start",
        "Cannot reset task while active build session(s) exist",
        true,
    )
}

#[test]
fn task_reset_rejects_live_qa_session_status_with_workspace_runtime_without_run() -> Result<()> {
    assert_task_reset_rejects_live_session_status(
        TaskStatus::AiReview,
        "qa",
        "qa_review",
        "Cannot reset task while active qa session(s) exist",
        true,
    )
}

fn assert_task_reset_rejects_live_session_status(
    status: TaskStatus,
    role: &str,
    scenario: &str,
    expected_message: &str,
    use_workspace_runtime: bool,
) -> Result<()> {
    let repo_path = unique_temp_path("reset-task-live-spec-shared-runtime-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", status);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: format!("{role}-session"),
        external_session_id: Some(format!("external-{role}-session")),
        role: role.to_string(),
        scenario: scenario.to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let status_payload = format!(r#"{{"external-{role}-session":{{"type":"busy"}}}}"#);
    let status_payload = Box::leak(status_payload.into_boxed_str());
    let (port, server_handle) = spawn_opencode_session_status_server(status_payload)?;
    let runtime_role = match role {
        "spec" => RuntimeRole::Spec,
        "planner" => RuntimeRole::Planner,
        "build" => RuntimeRole::Build,
        "qa" => RuntimeRole::Qa,
        other => panic!("unsupported role fixture: {other}"),
    };
    if use_workspace_runtime {
        insert_workspace_runtime(&service, &repo_path.to_string_lossy(), port)?;
    } else {
        insert_task_runtime_for_kind_role(
            &service,
            AgentRuntimeKind::opencode(),
            "task-1",
            runtime_role,
            &repo_path.to_string_lossy(),
            &repo_path.to_string_lossy(),
            builtin_opencode_runtime_route(port),
        )?;
    }

    let error = service
        .task_reset(&repo_path.to_string_lossy(), "task-1")
        .expect_err("live session should block full reset");
    assert!(error.to_string().contains(expected_message));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_reset_only_mutates_the_selected_task() -> Result<()> {
    let repo_path = unique_temp_path("reset-task-selected-task-only-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let parent = make_task("task-parent", "epic", TaskStatus::HumanReview);
    let mut child = make_task("task-child", "task", TaskStatus::InProgress);
    child.parent_id = Some("task-parent".to_string());
    child.document_summary.spec.has = true;
    child.document_summary.plan.has = true;
    child.document_summary.qa_report.has = true;
    child.document_summary.qa_report.verdict = QaWorkflowVerdict::Rejected;

    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![
            TaskCard {
                subtask_ids: vec!["task-child".to_string()],
                ..parent
            },
            child,
        ],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;

    let reset = service.task_reset(&repo_path.to_string_lossy(), "task-parent")?;

    assert_eq!(reset.status, TaskStatus::Open);
    let state = task_state.lock().expect("task store lock poisoned");
    assert_eq!(
        state.cleared_workflow_documents,
        vec!["task-parent".to_string()]
    );
    assert_eq!(
        state.cleared_session_roles,
        vec![(
            "task-parent".to_string(),
            vec![
                "spec".to_string(),
                "planner".to_string(),
                "build".to_string(),
                "qa".to_string(),
            ],
        )]
    );
    let child = state
        .tasks
        .iter()
        .find(|task| task.id == "task-child")
        .expect("child task should remain present");
    assert_eq!(child.status, TaskStatus::InProgress);
    assert!(child.document_summary.spec.has);
    assert!(child.document_summary.plan.has);
    assert!(child.document_summary.qa_report.has);
    assert_eq!(
        child.document_summary.qa_report.verdict,
        QaWorkflowVerdict::Rejected
    );
    Ok(())
}

#[test]
fn task_reset_removes_task_managed_worktrees_for_spec_and_planner_sessions() -> Result<()> {
    let repo_path = unique_temp_path("reset-task-owned-planning-worktrees-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let spec_worktree = worktree_base.join("task-1-spec");
    let planner_worktree = worktree_base.join("task-1-plan");
    let unrelated_worktree = worktree_base.join("scratch");
    fs::create_dir_all(&spec_worktree)?;
    fs::create_dir_all(&planner_worktree)?;
    fs::create_dir_all(&unrelated_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::ReadyForDev);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let workspace = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        workspace.workspace_id.as_str(),
        repo_config_for_workspace(
            &workspace,
            host_infra_system::RepoConfig {
                branch_prefix: "odt".to_string(),
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                ..Default::default()
            },
        ),
    )?;
    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.current_branches_by_path.insert(
            spec_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
        state.current_branches_by_path.insert(
            planner_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
        state.current_branches_by_path.insert(
            unrelated_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("user/scratch".to_string()),
                detached: false,
                revision: None,
            },
        );
    }
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![
        AgentSessionDocument {
            session_id: "spec-session".to_string(),
            external_session_id: None,
            role: "spec".to_string(),
            scenario: "spec_authoring".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: spec_worktree.to_string_lossy().to_string(),
            selected_model: None,
        },
        AgentSessionDocument {
            session_id: "planner-session".to_string(),
            external_session_id: None,
            role: "planner".to_string(),
            scenario: "plan_authoring".to_string(),
            started_at: "2026-03-17T12:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: planner_worktree.to_string_lossy().to_string(),
            selected_model: None,
        },
        AgentSessionDocument {
            session_id: "build-session".to_string(),
            external_session_id: None,
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T13:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: unrelated_worktree.to_string_lossy().to_string(),
            selected_model: None,
        },
    ];

    let _ = service.task_reset(workspace.repo_path.as_str(), "task-1")?;

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &spec_worktree.to_string_lossy() && *force
    )));
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &planner_worktree.to_string_lossy() && *force
    )));
    assert!(!git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, .. }
            if worktree_path == &unrelated_worktree.to_string_lossy()
    )));

    Ok(())
}

#[test]
fn task_reset_removes_stranded_task_managed_worktrees_when_branch_inspection_fails() -> Result<()> {
    let repo_path = unique_temp_path("reset-task-stranded-managed-worktrees-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let spec_worktree = worktree_base.join("task-1-spec");
    let planner_worktree = worktree_base.join("task-1-plan");
    fs::create_dir_all(&spec_worktree)?;
    fs::create_dir_all(&planner_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::ReadyForDev);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let workspace = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        workspace.workspace_id.as_str(),
        repo_config_for_workspace(
            &workspace,
            host_infra_system::RepoConfig {
                branch_prefix: "odt".to_string(),
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                ..Default::default()
            },
        ),
    )?;
    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.current_branch_error_by_path.insert(
            spec_worktree.to_string_lossy().to_string(),
            "not a git worktree".to_string(),
        );
        state.current_branch_error_by_path.insert(
            planner_worktree.to_string_lossy().to_string(),
            "not a git worktree".to_string(),
        );
    }
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![
        AgentSessionDocument {
            session_id: "spec-session".to_string(),
            external_session_id: None,
            role: "spec".to_string(),
            scenario: "spec_authoring".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: spec_worktree.to_string_lossy().to_string(),
            selected_model: None,
        },
        AgentSessionDocument {
            session_id: "planner-session".to_string(),
            external_session_id: None,
            role: "planner".to_string(),
            scenario: "plan_authoring".to_string(),
            started_at: "2026-03-17T12:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: planner_worktree.to_string_lossy().to_string(),
            selected_model: None,
        },
    ];

    let _ = service.task_reset(workspace.repo_path.as_str(), "task-1")?;

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &spec_worktree.to_string_lossy() && *force
    )));
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &planner_worktree.to_string_lossy() && *force
    )));

    Ok(())
}

#[test]
fn task_reset_propagates_non_worktree_branch_errors_for_task_managed_worktrees() -> Result<()> {
    let repo_path = unique_temp_path("reset-task-non-worktree-branch-error-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let spec_worktree = worktree_base.join("task-1-spec");
    fs::create_dir_all(&spec_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::ReadyForDev);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let workspace = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        workspace.workspace_id.as_str(),
        repo_config_for_workspace(
            &workspace,
            host_infra_system::RepoConfig {
                branch_prefix: "odt".to_string(),
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                ..Default::default()
            },
        ),
    )?;
    git_state
        .lock()
        .expect("git state lock poisoned")
        .current_branch_error_by_path
        .insert(
            spec_worktree.to_string_lossy().to_string(),
            "permission denied".to_string(),
        );
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "spec-session".to_string(),
        external_session_id: None,
        role: "spec".to_string(),
        scenario: "spec_authoring".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: spec_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let error = service
        .task_reset(workspace.repo_path.as_str(), "task-1")
        .expect_err("non-worktree branch errors should propagate");
    assert!(format!("{error:#}").contains("Failed to inspect implementation worktree branch"));

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(!git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { .. }
    )));

    Ok(())
}

#[test]
fn task_delete_reports_qa_specific_message_when_session_role_has_trailing_whitespace() -> Result<()>
{
    let repo_path = unique_temp_path("task-delete-live-qa-trimmed-role-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::Open);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "qa-session".to_string(),
        external_session_id: Some("external-qa-session".to_string()),
        role: "qa ".to_string(),
        scenario: "qa_review".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-qa-session":{"type":"busy"}}"#)?;
    insert_task_runtime_for_kind_role(
        &service,
        AgentRuntimeKind::opencode(),
        "task-1",
        RuntimeRole::Qa,
        &repo_path.to_string_lossy(),
        &repo_path.to_string_lossy(),
        builtin_opencode_runtime_route(port),
    )?;

    let error = service
        .task_delete(&repo_path.to_string_lossy(), "task-1", false)
        .expect_err("trimmed QA session should still block delete as QA work");
    let error_text = error.to_string();
    assert!(error_text.contains("Cannot delete tasks with active QA work in progress"));
    assert!(error_text.contains("task-1 (qa session)"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_reset_reports_completed_cleanup_steps_when_later_cleanup_fails() -> Result<()> {
    let repo_path = unique_temp_path("reset-task-partial-cleanup-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let mut task = make_task("task-1", "task", TaskStatus::ReadyForDev);
    task.document_summary.spec.has = true;
    task.document_summary.plan.has = true;
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .set_delivery_metadata_error = Some("delivery cleanup failed".to_string());

    let error = service
        .task_reset(&repo_path.to_string_lossy(), "task-1")
        .expect_err("delivery cleanup failure should bubble with progress details");
    let error_text = format!("{error:#}");

    assert!(error_text.contains("Failed to clear delivery metadata for task-1"));
    assert!(error_text.contains(
        "Reset cleanup already completed: cleared workflow documents, cleared linked agent sessions."
    ));
    assert!(error_text.contains("Retry reset to finish cleanup safely."));
    assert_eq!(
        task_state.lock().expect("task store lock poisoned").tasks[0].status,
        TaskStatus::ReadyForDev
    );
    Ok(())
}

#[test]
fn task_reset_implementation_rejects_live_qa_session_status_with_task_runtime_without_run(
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-live-qa-shared-runtime-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "qa-session".to_string(),
        external_session_id: Some("external-qa-session".to_string()),
        role: "qa".to_string(),
        scenario: "qa_review".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-qa-session":{"type":"busy"}}"#)?;
    insert_task_runtime_for_kind_role(
        &service,
        AgentRuntimeKind::opencode(),
        "task-1",
        RuntimeRole::Qa,
        &repo_path.to_string_lossy(),
        &repo_path.to_string_lossy(),
        builtin_opencode_runtime_route(port),
    )?;

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("live QA session should block reset");
    assert!(error
        .to_string()
        .contains("Cannot reset implementation while active qa session(s) exist"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_delete_ignores_stale_persisted_build_session_without_live_runtime() -> Result<()> {
    let repo_path = unique_temp_path("delete-task-stale-build-session-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    let repo_config = host_infra_system::RepoConfig {
        branch_prefix: "odt".to_string(),
        ..Default::default()
    };
    workspace_update_repo_config_by_repo_path(&service, &repo_path.to_string_lossy(), repo_config)?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];

    service.task_delete(&repo_path.to_string_lossy(), "task-1", false)?;
    Ok(())
}

#[test]
fn task_reset_fails_when_persisted_session_runtime_kind_is_unknown() -> Result<()> {
    let repo_path = unique_temp_path("reset-task-unknown-session-runtime-kind-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "unknown-runtime".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let error = service
        .task_reset(&repo_path.to_string_lossy(), "task-1")
        .expect_err("unknown persisted runtime kind should fail closed");
    let error_text = format!("{error:#}");
    assert!(error_text.contains("Failed checking live runtime state before"));
    assert!(error_text.contains("references unsupported runtime kind 'unknown-runtime'"));
    Ok(())
}

#[test]
fn task_delete_rejects_live_build_session_status() -> Result<()> {
    let repo_path = unique_temp_path("delete-task-live-runtime-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"busy"}}"#)?;
    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-1".to_string(),
            crate::app_service::RunProcess {
                summary: serde_json::from_value(json!({
                    "runId": "run-1",
                    "runtimeKind": "opencode",
                    "runtimeRoute": {
                        "type": "local_http",
                        "endpoint": format!("http://127.0.0.1:{port}"),
                    },
                    "repoPath": repo_path.to_string_lossy().to_string(),
                    "taskId": "task-1",
                    "branch": "odt/task-1",
                    "worktreePath": repo_path.to_string_lossy().to_string(),
                    "port": port,
                    "state": "running",
                    "lastMessage": null,
                    "startedAt": "2026-03-17T11:00:00Z",
                }))?,
                child: None,
                _runtime_process_guard: None,
                repo_path: repo_path.to_string_lossy().to_string(),
                task_id: "task-1".to_string(),
                worktree_path: repo_path.to_string_lossy().to_string(),
                repo_config: host_infra_system::RepoConfig {
                    branch_prefix: "odt".to_string(),
                    ..Default::default()
                },
            },
        );

    let error = service
        .task_delete(&repo_path.to_string_lossy(), "task-1", false)
        .expect_err("live runtime should block delete");
    assert!(error
        .to_string()
        .contains("Cannot delete tasks with active builder work in progress"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_delete_rejects_live_build_session_status_with_task_runtime_without_run() -> Result<()> {
    let repo_path = unique_temp_path("delete-task-live-shared-runtime-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"busy"}}"#)?;
    insert_task_runtime_for_kind_role(
        &service,
        AgentRuntimeKind::opencode(),
        "task-1",
        RuntimeRole::Build,
        &repo_path.to_string_lossy(),
        &repo_path.to_string_lossy(),
        builtin_opencode_runtime_route(port),
    )?;

    let error = service
        .task_delete(&repo_path.to_string_lossy(), "task-1", false)
        .expect_err("live shared-runtime session should block delete");
    assert!(error
        .to_string()
        .contains("Cannot delete tasks with active builder work in progress"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_delete_rejects_live_build_session_status_with_workspace_runtime_without_run() -> Result<()>
{
    let repo_path = unique_temp_path("delete-task-live-workspace-runtime-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"busy"}}"#)?;
    insert_workspace_runtime(&service, &repo_path.to_string_lossy(), port)?;

    let error = service
        .task_delete(&repo_path.to_string_lossy(), "task-1", false)
        .expect_err("live workspace-runtime session should block delete");
    assert!(error
        .to_string()
        .contains("Cannot delete tasks with active builder work in progress"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_delete_rejects_live_qa_session_status_with_qa_specific_message() -> Result<()> {
    let repo_path = unique_temp_path("task-delete-live-qa-shared-runtime-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::Open);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "qa-session".to_string(),
        external_session_id: Some("external-qa-session".to_string()),
        role: "qa".to_string(),
        scenario: "qa_review".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-qa-session":{"type":"busy"}}"#)?;
    insert_task_runtime_for_kind_role(
        &service,
        AgentRuntimeKind::opencode(),
        "task-1",
        RuntimeRole::Qa,
        &repo_path.to_string_lossy(),
        &repo_path.to_string_lossy(),
        builtin_opencode_runtime_route(port),
    )?;

    let error = service
        .task_delete(&repo_path.to_string_lossy(), "task-1", false)
        .expect_err("live QA session should block delete");
    let error_text = error.to_string();
    assert!(error_text.contains("Cannot delete tasks with active QA work in progress"));
    assert!(error_text.contains("task-1 (qa session)"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_delete_rejects_live_qa_session_status_with_workspace_runtime() -> Result<()> {
    let repo_path = unique_temp_path("task-delete-live-qa-workspace-runtime-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::Open);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "qa-session".to_string(),
        external_session_id: Some("external-qa-session".to_string()),
        role: "qa".to_string(),
        scenario: "qa_review".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-qa-session":{"type":"busy"}}"#)?;
    insert_workspace_runtime(&service, &repo_path.to_string_lossy(), port)?;

    let error = service
        .task_delete(&repo_path.to_string_lossy(), "task-1", false)
        .expect_err("live workspace-runtime QA session should block delete");
    let error_text = error.to_string();
    assert!(error_text.contains("Cannot delete tasks with active QA work in progress"));
    assert!(error_text.contains("task-1 (qa session)"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_delete_rejects_live_build_session_when_stale_run_route_has_workspace_runtime() -> Result<()>
{
    let repo_path = unique_temp_path("delete-task-live-shared-runtime-fallback-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"busy"}}"#)?;
    insert_workspace_runtime(&service, &repo_path.to_string_lossy(), port)?;

    let stale_route_port = {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        listener.local_addr()?.port()
    };
    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-stale".to_string(),
            crate::app_service::RunProcess {
                summary: serde_json::from_value(json!({
                    "runId": "run-stale",
                    "runtimeKind": "opencode",
                    "runtimeRoute": {
                        "type": "local_http",
                        "endpoint": format!("http://127.0.0.1:{stale_route_port}"),
                    },
                    "repoPath": repo_path.to_string_lossy().to_string(),
                    "taskId": "task-1",
                    "branch": "odt/task-1",
                    "worktreePath": repo_path.to_string_lossy().to_string(),
                    "port": stale_route_port,
                    "state": "running",
                    "lastMessage": null,
                    "startedAt": "2026-03-17T11:00:00Z",
                }))?,
                child: None,
                _runtime_process_guard: None,
                repo_path: repo_path.to_string_lossy().to_string(),
                task_id: "task-1".to_string(),
                worktree_path: repo_path.to_string_lossy().to_string(),
                repo_config: host_infra_system::RepoConfig {
                    branch_prefix: "odt".to_string(),
                    ..Default::default()
                },
            },
        );

    let error = service
        .task_delete(&repo_path.to_string_lossy(), "task-1", false)
        .expect_err("live shared runtime should still block delete");
    assert!(error
        .to_string()
        .contains("Cannot delete tasks with active builder work in progress"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_delete_clears_stale_runs_after_successful_delete() -> Result<()> {
    let repo_path = unique_temp_path("delete-task-clears-stale-runs-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"idle"}}"#)?;
    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-1".to_string(),
            crate::app_service::RunProcess {
                summary: serde_json::from_value(json!({
                    "runId": "run-1",
                    "runtimeKind": "opencode",
                    "runtimeRoute": {
                        "type": "local_http",
                        "endpoint": format!("http://127.0.0.1:{port}"),
                    },
                    "repoPath": repo_path.to_string_lossy().to_string(),
                    "taskId": "task-1",
                    "branch": "odt/task-1",
                    "worktreePath": repo_path.to_string_lossy().to_string(),
                    "port": port,
                    "state": "running",
                    "lastMessage": null,
                    "startedAt": "2026-03-17T11:00:00Z",
                }))?,
                child: None,
                _runtime_process_guard: None,
                repo_path: repo_path.to_string_lossy().to_string(),
                task_id: "task-1".to_string(),
                worktree_path: repo_path.to_string_lossy().to_string(),
                repo_config: host_infra_system::RepoConfig {
                    branch_prefix: "odt".to_string(),
                    ..Default::default()
                },
            },
        );

    service.task_delete(&repo_path.to_string_lossy(), "task-1", false)?;
    server_handle
        .join()
        .expect("status server thread should finish");
    assert!(service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .is_empty());
    Ok(())
}

#[test]
fn task_reset_implementation_rejects_live_build_session_status_for_in_progress() -> Result<()> {
    assert_task_reset_implementation_rejects_live_build_session_status(TaskStatus::InProgress)
}

#[test]
fn task_reset_implementation_rejects_live_build_session_status_for_blocked() -> Result<()> {
    assert_task_reset_implementation_rejects_live_build_session_status(TaskStatus::Blocked)
}

fn assert_task_reset_implementation_rejects_live_build_session_status(
    status: TaskStatus,
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-live-runtime-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", status);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"busy"}}"#)?;
    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-1".to_string(),
            crate::app_service::RunProcess {
                summary: serde_json::from_value(json!({
                    "runId": "run-1",
                    "runtimeKind": "opencode",
                    "runtimeRoute": {
                        "type": "local_http",
                        "endpoint": format!("http://127.0.0.1:{port}"),
                    },
                    "repoPath": repo_path.to_string_lossy().to_string(),
                    "taskId": "task-1",
                    "branch": "odt/task-1",
                    "worktreePath": repo_path.to_string_lossy().to_string(),
                    "port": port,
                    "state": "running",
                    "lastMessage": null,
                    "startedAt": "2026-03-17T11:00:00Z",
                }))?,
                child: None,
                _runtime_process_guard: None,
                repo_path: repo_path.to_string_lossy().to_string(),
                task_id: "task-1".to_string(),
                worktree_path: repo_path.to_string_lossy().to_string(),
                repo_config: host_infra_system::RepoConfig {
                    branch_prefix: "odt".to_string(),
                    ..Default::default()
                },
            },
        );

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("live runtime should block reset");
    assert!(error
        .to_string()
        .contains("Cannot reset implementation while"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_reset_implementation_rejects_live_build_session_when_stale_run_route_has_workspace_runtime(
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-live-shared-runtime-fallback-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;

    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        Vec::new(),
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            ..Default::default()
        },
    )?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"busy"}}"#)?;
    insert_workspace_runtime(&service, &repo_path.to_string_lossy(), port)?;

    let stale_route_port = {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        listener.local_addr()?.port()
    };
    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-stale".to_string(),
            crate::app_service::RunProcess {
                summary: serde_json::from_value(json!({
                    "runId": "run-stale",
                    "runtimeKind": "opencode",
                    "runtimeRoute": {
                        "type": "local_http",
                        "endpoint": format!("http://127.0.0.1:{stale_route_port}"),
                    },
                    "repoPath": repo_path.to_string_lossy().to_string(),
                    "taskId": "task-1",
                    "branch": "odt/task-1",
                    "worktreePath": repo_path.to_string_lossy().to_string(),
                    "port": stale_route_port,
                    "state": "running",
                    "lastMessage": null,
                    "startedAt": "2026-03-17T11:00:00Z",
                }))?,
                child: None,
                _runtime_process_guard: None,
                repo_path: repo_path.to_string_lossy().to_string(),
                task_id: "task-1".to_string(),
                worktree_path: repo_path.to_string_lossy().to_string(),
                repo_config: host_infra_system::RepoConfig {
                    branch_prefix: "odt".to_string(),
                    ..Default::default()
                },
            },
        );

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("live shared runtime should still block reset");
    assert!(error
        .to_string()
        .contains("Cannot reset implementation while builder work is active"));
    server_handle
        .join()
        .expect("status server thread should finish");
    Ok(())
}

#[test]
fn task_reset_implementation_ignores_stale_build_run_when_runtime_session_is_idle() -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-stale-build-run-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let build_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&worktree_base)?;
    fs::create_dir_all(&build_worktree)?;

    let mut task = make_task("task-1", "task", TaskStatus::HumanReview);
    task.document_summary.spec.has = true;
    task.document_summary.plan.has = true;

    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let workspace = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        workspace.workspace_id.as_str(),
        repo_config_for_workspace(
            &workspace,
            host_infra_system::RepoConfig {
                branch_prefix: "odt".to_string(),
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                ..Default::default()
            },
        ),
    )?;
    git_state
        .lock()
        .expect("git state lock poisoned")
        .current_branches_by_path
        .insert(
            build_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: build_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let (port, server_handle) =
        spawn_opencode_session_status_server(r#"{"external-build-session":{"type":"idle"}}"#)?;
    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-1".to_string(),
            crate::app_service::RunProcess {
                summary: serde_json::from_value(json!({
                    "runId": "run-1",
                    "runtimeKind": "opencode",
                    "runtimeRoute": {
                        "type": "local_http",
                        "endpoint": format!("http://127.0.0.1:{port}"),
                    },
                    "repoPath": workspace.repo_path.clone(),
                    "taskId": "task-1",
                    "branch": "odt/task-1",
                    "worktreePath": build_worktree.to_string_lossy().to_string(),
                    "port": port,
                    "state": "running",
                    "lastMessage": null,
                    "startedAt": "2026-03-17T11:00:00Z",
                }))?,
                child: None,
                _runtime_process_guard: None,
                repo_path: workspace.repo_path.clone(),
                task_id: "task-1".to_string(),
                worktree_path: build_worktree.to_string_lossy().to_string(),
                repo_config: host_infra_system::RepoConfig {
                    branch_prefix: "odt".to_string(),
                    worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                    ..Default::default()
                },
            },
        );

    let updated = service.task_reset_implementation(workspace.repo_path.as_str(), "task-1")?;
    server_handle
        .join()
        .expect("status server thread should finish");

    assert_eq!(updated.status, TaskStatus::ReadyForDev);
    assert!(service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .is_empty());
    Ok(())
}

#[test]
fn task_reset_implementation_fails_when_status_endpoint_is_unreachable() -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-stale-build-run-unreachable-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let build_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&worktree_base)?;
    fs::create_dir_all(&build_worktree)?;

    let mut task = make_task("task-1", "task", TaskStatus::HumanReview);
    task.document_summary.spec.has = true;
    task.document_summary.plan.has = true;

    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let workspace = service.workspace_add(&repo_path.to_string_lossy())?;
    service.workspace_update_repo_config(
        workspace.workspace_id.as_str(),
        repo_config_for_workspace(
            &workspace,
            host_infra_system::RepoConfig {
                branch_prefix: "odt".to_string(),
                worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                ..Default::default()
            },
        ),
    )?;
    git_state
        .lock()
        .expect("git state lock poisoned")
        .current_branches_by_path
        .insert(
            build_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: Some("external-build-session".to_string()),
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: build_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);

    service
        .runs
        .lock()
        .expect("run state lock poisoned")
        .insert(
            "run-1".to_string(),
            crate::app_service::RunProcess {
                summary: serde_json::from_value(json!({
                    "runId": "run-1",
                    "runtimeKind": "opencode",
                    "runtimeRoute": {
                        "type": "local_http",
                        "endpoint": format!("http://127.0.0.1:{port}"),
                    },
                    "repoPath": workspace.repo_path.clone(),
                    "taskId": "task-1",
                    "branch": "odt/task-1",
                    "worktreePath": build_worktree.to_string_lossy().to_string(),
                    "port": port,
                    "state": "running",
                    "lastMessage": null,
                    "startedAt": "2026-03-17T11:00:00Z",
                }))?,
                child: None,
                _runtime_process_guard: None,
                repo_path: workspace.repo_path.clone(),
                task_id: "task-1".to_string(),
                worktree_path: build_worktree.to_string_lossy().to_string(),
                repo_config: host_infra_system::RepoConfig {
                    branch_prefix: "odt".to_string(),
                    worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
                    ..Default::default()
                },
            },
        );

    let error = service
        .task_reset_implementation(workspace.repo_path.as_str(), "task-1")
        .expect_err("unreachable probe should fail reset instead of masking the error");

    assert!(error
        .to_string()
        .contains("Failed checking live runtime state before reset implementation task-1"));
    Ok(())
}

#[test]
fn task_reset_implementation_only_removes_task_managed_worktrees() -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-owned-worktrees-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let managed_worktree = worktree_base.join("task-1");
    let unrelated_worktree = worktree_base.join("user-scratch");
    fs::create_dir_all(&managed_worktree)?;
    fs::create_dir_all(&unrelated_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::AiReview);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![
            GitBranch {
                name: "odt/task-1".to_string(),
                is_current: false,
                is_remote: false,
            },
            GitBranch {
                name: "user/scratch".to_string(),
                is_current: false,
                is_remote: false,
            },
        ],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.current_branches_by_path.insert(
            managed_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
        state.current_branches_by_path.insert(
            unrelated_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("user/scratch".to_string()),
                detached: false,
                revision: None,
            },
        );
    }
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![
        AgentSessionDocument {
            session_id: "build-session".to_string(),
            external_session_id: None,
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: managed_worktree.to_string_lossy().to_string(),
            selected_model: None,
        },
        AgentSessionDocument {
            session_id: "qa-session".to_string(),
            external_session_id: None,
            role: "qa".to_string(),
            scenario: "qa_review".to_string(),
            started_at: "2026-03-17T12:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: unrelated_worktree.to_string_lossy().to_string(),
            selected_model: None,
        },
    ];

    let _ = service.task_reset_implementation(&repo_path.to_string_lossy(), "task-1")?;

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &managed_worktree.to_string_lossy() && *force
    )));
    assert!(!git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, .. }
            if worktree_path == &unrelated_worktree.to_string_lossy()
    )));

    Ok(())
}

#[test]
fn task_reset_implementation_removes_stranded_managed_worktree_when_branch_inspection_fails(
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-stranded-worktree-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let managed_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&managed_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::AiReview);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    git_state
        .lock()
        .expect("git state lock poisoned")
        .current_branch_error_by_path
        .insert(
            managed_worktree.to_string_lossy().to_string(),
            "not a git worktree".to_string(),
        );
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: None,
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: managed_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let _ = service.task_reset_implementation(&repo_path.to_string_lossy(), "task-1")?;

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &managed_worktree.to_string_lossy() && *force
    )));

    Ok(())
}

#[test]
fn task_reset_implementation_propagates_non_worktree_branch_errors_for_managed_worktrees(
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-non-worktree-branch-error-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let managed_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&managed_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::AiReview);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    git_state
        .lock()
        .expect("git state lock poisoned")
        .current_branch_error_by_path
        .insert(
            managed_worktree.to_string_lossy().to_string(),
            "permission denied".to_string(),
        );
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: None,
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: managed_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("non-worktree branch errors should propagate");
    assert!(format!("{error:#}").contains("Failed to inspect implementation worktree branch"));

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(!git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { .. }
    )));

    Ok(())
}

#[test]
fn task_reset_implementation_fails_when_branch_remains_checked_out_in_repo_worktree() -> Result<()>
{
    let repo_path = unique_temp_path("reset-implementation-checked-out-branch-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let build_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&build_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::AiReview);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: true,
            is_remote: false,
        }],
        host_domain::GitCurrentBranch {
            name: Some("odt/task-1".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    git_state
        .lock()
        .expect("git state lock poisoned")
        .current_branches_by_path
        .insert(
            build_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.worktrees = vec![host_domain::GitWorktreeSummary {
            branch: "odt/task-1".to_string(),
            worktree_path: repo_path.to_string_lossy().to_string(),
        }];
    }
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: None,
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: build_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("checked-out task branch should block reset");
    let error_text = format!("{error:#}");
    assert!(error_text.contains("Cannot delete implementation branch"));
    assert!(error_text.contains("still checked out"));
    assert!(error_text.contains("odt/task-1"));
    assert!(error_text.contains(repo_path.to_string_lossy().as_ref()));

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &build_worktree.to_string_lossy() && *force
    )));
    assert!(!git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::DeleteLocalBranch { .. }
    )));

    Ok(())
}

#[test]
fn task_reset_implementation_reports_partial_cleanup_progress_when_branch_delete_fails(
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-branch-failure-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let build_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&build_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::AiReview);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.current_branches_by_path.insert(
            build_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
        state.delete_local_branch_error = Some("branch blocked".to_string());
    }
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: None,
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: build_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("branch deletion failure should report cleanup progress");
    let error_text = format!("{error:#}");
    assert!(error_text.contains("branch blocked"));
    assert!(error_text.contains(build_worktree.to_string_lossy().as_ref()));
    assert!(error_text.contains("Retry reset to finish cleanup safely."));
    let state = task_state.lock().expect("task store lock poisoned");
    assert!(state.cleared_session_roles.is_empty());

    Ok(())
}

#[test]
fn task_reset_implementation_reports_partial_cleanup_progress_when_store_cleanup_fails(
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-store-failure-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let build_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&build_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::AiReview);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    git_state
        .lock()
        .expect("git state lock poisoned")
        .current_branches_by_path
        .insert(
            build_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
    {
        let mut state = task_state.lock().expect("task store lock poisoned");
        state.clear_agent_sessions_error = Some("clear sessions failed".to_string());
        state.agent_sessions = vec![AgentSessionDocument {
            session_id: "build-session".to_string(),
            external_session_id: None,
            role: "build".to_string(),
            scenario: "build_implementation_start".to_string(),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            runtime_kind: "opencode".to_string(),
            working_directory: build_worktree.to_string_lossy().to_string(),
            selected_model: None,
        }];
    }

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("store cleanup failure should report cleanup progress");
    let error_text = format!("{error:#}");
    assert!(error_text.contains("clear sessions failed"));
    assert!(error_text.contains(build_worktree.to_string_lossy().as_ref()));
    assert!(error_text.contains("odt/task-1"));
    assert!(error_text.contains("Retry reset to finish cleanup safely."));

    Ok(())
}

#[test]
fn task_reset_implementation_rejects_branch_still_checked_out_in_remaining_worktree() -> Result<()>
{
    let repo_path = unique_temp_path("reset-implementation-checked-out-branch-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let build_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&build_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::AiReview);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    {
        let mut state = git_state.lock().expect("git state lock poisoned");
        state.current_branches_by_path.insert(
            build_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
        state.worktrees = vec![host_domain::GitWorktreeSummary {
            branch: "odt/task-1".to_string(),
            worktree_path: repo_path.to_string_lossy().to_string(),
        }];
    }
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: None,
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: build_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("reset should fail when branch stays checked out in another worktree");
    let error_text = format!("{error:#}");
    assert!(
        error_text.contains("Cannot delete implementation branch while it is still checked out")
    );
    assert!(error_text.contains(repo_path.to_string_lossy().as_ref()));
    assert!(error_text.contains("odt/task-1"));

    let state = task_state.lock().expect("task store lock poisoned");
    assert!(state.cleared_session_roles.is_empty());
    drop(state);

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &build_worktree.to_string_lossy() && *force
    )));
    assert!(!git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::DeleteLocalBranch { branch, .. }
            if branch == "odt/task-1"
    )));

    Ok(())
}

#[test]
fn task_reset_implementation_removes_recorded_builder_worktree_outside_current_effective_base(
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-recorded-builder-worktree-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let current_worktree_base = repo_path.join("worktrees");
    let recorded_worktree = unique_temp_path("reset-implementation-recorded-builder-worktree");
    fs::create_dir_all(&recorded_worktree)?;

    let task = make_task("task-1", "task", TaskStatus::AiReview);
    let (service, task_state, git_state) = build_service_with_git_state(
        vec![task],
        vec![GitBranch {
            name: "odt/task-1".to_string(),
            is_current: false,
            is_remote: false,
        }],
        host_domain::GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
            revision: None,
        },
    );
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    workspace_update_repo_config_by_repo_path(
        &service,
        &repo_path.to_string_lossy(),
        host_infra_system::RepoConfig {
            branch_prefix: "odt".to_string(),
            worktree_base_path: Some(current_worktree_base.to_string_lossy().to_string()),
            ..Default::default()
        },
    )?;
    git_state
        .lock()
        .expect("git state lock poisoned")
        .current_branches_by_path
        .insert(
            recorded_worktree.to_string_lossy().to_string(),
            host_domain::GitCurrentBranch {
                name: Some("odt/task-1".to_string()),
                detached: false,
                revision: None,
            },
        );
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: None,
        role: "build".to_string(),
        scenario: "build_implementation_start".to_string(),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        runtime_kind: "opencode".to_string(),
        working_directory: recorded_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    service.task_reset_implementation(&repo_path.to_string_lossy(), "task-1")?;

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { worktree_path, force, .. }
            if worktree_path == &recorded_worktree.to_string_lossy() && *force
    )));
    assert!(git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::DeleteLocalBranch { branch, force, .. }
            if branch == "odt/task-1" && *force
    )));

    Ok(())
}
