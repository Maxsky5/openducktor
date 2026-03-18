use anyhow::Result;
use host_domain::{
    AgentSessionDocument, CreateTaskInput, GitBranch, IssueType, PlanSubtaskInput,
    PullRequestRecord, QaWorkflowVerdict, RuntimeRole, TaskAction, TaskStatus, TaskStore,
    UpdateTaskPatch,
};
use host_infra_system::{
    AppConfigStore, OpencodeStartupReadinessConfig, RuntimeConfig, RuntimeConfigStore,
};
use serde_json::json;
use std::fs;
use std::net::{TcpListener, TcpStream};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use crate::app_service::test_support::{
    build_service_with_git_state, make_task, spawn_sleep_process, unique_temp_path,
    write_private_file, FakeTaskStore, TaskStoreState,
};
use crate::app_service::{
    allows_transition, build_opencode_startup_event_payload, can_set_plan,
    can_set_spec_from_status, derive_available_actions, normalize_required_markdown,
    normalize_subtask_plan_inputs, terminate_child_process,
    validate_parent_relationships_for_create, validate_parent_relationships_for_update,
    validate_plan_subtask_rules, validate_transition, wait_for_local_server,
    wait_for_local_server_with_process, AgentRuntimeProcess, AppService,
    OpencodeStartupMetricsSnapshot, OpencodeStartupReadinessPolicy, OpencodeStartupWaitReport,
    RuntimeCleanupTarget, StartupEventContext, StartupEventCorrelation, StartupEventPayload,
};

fn init_git_repo(path: &std::path::Path) -> Result<()> {
    let status = Command::new("git")
        .args(["init", "--quiet"])
        .arg(path)
        .status()?;
    if status.success() {
        return Ok(());
    }

    Err(anyhow::anyhow!(
        "failed to initialize git repo for test at {}",
        path.display()
    ))
}

#[test]
fn app_service_new_constructor_is_callable() -> Result<()> {
    let config_store = AppConfigStore::from_path(unique_temp_path("new-constructor"));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: Arc::new(Mutex::new(TaskStoreState {
            ensure_calls: Vec::new(),
            ensure_error: None,
            tasks: Vec::new(),
            list_error: None,
            delete_calls: Vec::new(),
            created_inputs: Vec::new(),
            updated_patches: Vec::new(),
            spec_get_calls: Vec::new(),
            spec_set_calls: Vec::new(),
            plan_get_calls: Vec::new(),
            plan_set_calls: Vec::new(),
            metadata_get_calls: Vec::new(),
            qa_append_calls: Vec::new(),
            qa_outcome_calls: Vec::new(),
            latest_qa_report: None,
            agent_sessions: Vec::new(),
            upserted_sessions: Vec::new(),
            cleared_session_roles: Vec::new(),
            cleared_qa_reports: Vec::new(),
            pull_requests: std::collections::HashMap::new(),
            direct_merge_records: std::collections::HashMap::new(),
        })),
    });

    let service = AppService::new(task_store, config_store);
    let _ = service.runtime_check()?;
    Ok(())
}

#[test]
fn bug_can_skip_spec_and_go_in_progress_from_open() {
    let bug = make_task("bug-1", "bug", TaskStatus::Open);
    assert!(allows_transition(
        &bug,
        &TaskStatus::Open,
        &TaskStatus::InProgress
    ));
}

#[test]
fn feature_cannot_skip_to_in_progress_from_open() {
    let feature = make_task("feature-1", "feature", TaskStatus::Open);
    assert!(!allows_transition(
        &feature,
        &TaskStatus::Open,
        &TaskStatus::InProgress
    ));
}

#[test]
fn human_review_is_in_progress_state_not_closed() {
    let task = make_task("task-1", "task", TaskStatus::HumanReview);
    assert!(allows_transition(
        &task,
        &TaskStatus::HumanReview,
        &TaskStatus::InProgress
    ));
    assert!(allows_transition(
        &task,
        &TaskStatus::HumanReview,
        &TaskStatus::Closed
    ));
}

#[test]
fn epic_close_ignores_deferred_subtasks_for_completion_guard() {
    let epic = make_task("epic-1", "epic", TaskStatus::HumanReview);
    let mut deferred_child = make_task("task-1", "task", TaskStatus::Deferred);
    deferred_child.parent_id = Some(epic.id.clone());

    let tasks = vec![epic.clone(), deferred_child];
    let result = validate_transition(&epic, &tasks, &TaskStatus::HumanReview, &TaskStatus::Closed);
    assert!(
        result.is_ok(),
        "deferred subtasks should not block epic completion"
    );
}

#[test]
fn epic_close_is_blocked_by_open_direct_subtask() {
    let epic = make_task("epic-1", "epic", TaskStatus::HumanReview);
    let mut active_child = make_task("task-1", "task", TaskStatus::Open);
    active_child.parent_id = Some(epic.id.clone());

    let tasks = vec![epic.clone(), active_child];
    let result = validate_transition(&epic, &tasks, &TaskStatus::HumanReview, &TaskStatus::Closed);
    assert!(
        result.is_err(),
        "open direct subtasks must block epic completion"
    );
}

#[test]
fn only_epics_can_have_subtasks_and_depth_is_one_level() {
    let epic = make_task("epic-1", "epic", TaskStatus::Open);
    let mut non_epic_parent = make_task("task-parent", "task", TaskStatus::Open);
    let mut level_two_parent = make_task("epic-child", "epic", TaskStatus::Open);
    level_two_parent.parent_id = Some(epic.id.clone());

    let tasks = vec![
        epic.clone(),
        non_epic_parent.clone(),
        level_two_parent.clone(),
    ];

    let invalid_non_epic_parent = CreateTaskInput {
        title: "child".to_string(),
        issue_type: IssueType::Task,
        priority: 2,
        description: None,
        labels: None,
        ai_review_enabled: Some(true),
        parent_id: Some(non_epic_parent.id.clone()),
    };
    assert!(validate_parent_relationships_for_create(&tasks, &invalid_non_epic_parent).is_err());

    let invalid_depth_two = CreateTaskInput {
        title: "child".to_string(),
        issue_type: IssueType::Task,
        priority: 2,
        description: None,
        labels: None,
        ai_review_enabled: Some(true),
        parent_id: Some(level_two_parent.id.clone()),
    };
    assert!(validate_parent_relationships_for_create(&tasks, &invalid_depth_two).is_err());

    non_epic_parent.parent_id = Some(epic.id.clone());
    let patch = UpdateTaskPatch {
        title: None,
        description: None,
        notes: None,
        status: Some(TaskStatus::Deferred),
        priority: None,
        issue_type: None,
        ai_review_enabled: None,
        labels: None,
        assignee: None,
        parent_id: Some(epic.id.clone()),
    };
    assert!(validate_parent_relationships_for_update(&tasks, &non_epic_parent, &patch).is_ok());
}

#[test]
fn markdown_documents_require_non_empty_content() {
    assert!(normalize_required_markdown("   ", "spec").is_err());
    assert_eq!(
        normalize_required_markdown("  # Valid  ", "spec").expect("valid markdown"),
        "# Valid"
    );
}

#[test]
fn subtask_plan_inputs_are_normalized_and_validated() {
    let normalized = normalize_subtask_plan_inputs(vec![PlanSubtaskInput {
        title: "  Build API  ".to_string(),
        issue_type: Some(IssueType::Feature),
        priority: Some(99),
        description: Some("  add endpoint ".to_string()),
    }])
    .expect("normalized");

    assert_eq!(normalized.len(), 1);
    let first = &normalized[0];
    assert_eq!(first.title, "Build API");
    assert_eq!(first.issue_type, IssueType::Feature);
    assert_eq!(first.priority, 4);
    assert_eq!(first.description.as_deref(), Some("add endpoint"));
}

#[test]
fn subtask_plan_inputs_reject_epic_issue_type() {
    let result = normalize_subtask_plan_inputs(vec![PlanSubtaskInput {
        title: "Do work".to_string(),
        issue_type: Some(IssueType::Epic),
        priority: Some(2),
        description: None,
    }]);
    assert!(result.is_err());
}

#[test]
fn spec_and_plan_write_status_guards_follow_matrix() {
    assert!(can_set_spec_from_status(&TaskStatus::Open));
    assert!(can_set_spec_from_status(&TaskStatus::SpecReady));
    assert!(can_set_spec_from_status(&TaskStatus::ReadyForDev));
    assert!(!can_set_spec_from_status(&TaskStatus::InProgress));

    let epic_open = make_task("epic-open", "epic", TaskStatus::Open);
    let epic_spec_ready = make_task("epic-spec", "epic", TaskStatus::SpecReady);
    let epic_ready_for_dev = make_task("epic-ready", "epic", TaskStatus::ReadyForDev);
    let feature_open = make_task("feature-open", "feature", TaskStatus::Open);
    let feature_ready_for_dev = make_task("feature-ready", "feature", TaskStatus::ReadyForDev);
    let task_open = make_task("task-open", "task", TaskStatus::Open);
    let task_ready_for_dev = make_task("task-ready", "task", TaskStatus::ReadyForDev);
    let bug_open = make_task("bug-open", "bug", TaskStatus::Open);
    let bug_ready_for_dev = make_task("bug-ready", "bug", TaskStatus::ReadyForDev);
    let feature_in_progress = make_task("feature-progress", "feature", TaskStatus::InProgress);

    assert!(!can_set_plan(&epic_open));
    assert!(can_set_plan(&epic_spec_ready));
    assert!(can_set_plan(&epic_ready_for_dev));
    assert!(!can_set_plan(&feature_open));
    assert!(can_set_plan(&feature_ready_for_dev));
    assert!(can_set_plan(&task_open));
    assert!(can_set_plan(&task_ready_for_dev));
    assert!(can_set_plan(&bug_open));
    assert!(can_set_plan(&bug_ready_for_dev));
    assert!(!can_set_plan(&feature_in_progress));
}

#[test]
fn epic_plan_requires_existing_or_proposed_direct_subtasks() {
    let epic = make_task("epic-1", "epic", TaskStatus::SpecReady);
    let tasks = vec![epic.clone()];
    let result = validate_plan_subtask_rules(&epic, &tasks, &[]);
    assert!(result.is_err());

    let proposals = vec![CreateTaskInput {
        title: "Subtask".to_string(),
        issue_type: IssueType::Task,
        priority: 2,
        description: None,
        labels: None,
        ai_review_enabled: Some(true),
        parent_id: None,
    }];
    assert!(validate_plan_subtask_rules(&epic, &tasks, &proposals).is_ok());
}

#[test]
fn non_epic_plan_cannot_accept_subtask_proposals() {
    let task = make_task("task-1", "task", TaskStatus::Open);
    let proposals = vec![CreateTaskInput {
        title: "Child".to_string(),
        issue_type: IssueType::Bug,
        priority: 2,
        description: None,
        labels: None,
        ai_review_enabled: Some(true),
        parent_id: None,
    }];

    let result = validate_plan_subtask_rules(&task, std::slice::from_ref(&task), &proposals);
    assert!(result.is_err());
}

#[test]
fn feature_in_open_exposes_spec_only() {
    let feature = make_task("feature-1", "feature", TaskStatus::Open);
    let actions = derive_available_actions(&feature, std::slice::from_ref(&feature));

    assert!(actions.contains(&TaskAction::SetSpec));
    assert!(!actions.contains(&TaskAction::SetPlan));
    assert!(!actions.contains(&TaskAction::BuildStart));
}

#[test]
fn epic_in_open_exposes_spec_only() {
    let epic = make_task("epic-1", "epic", TaskStatus::Open);
    let actions = derive_available_actions(&epic, std::slice::from_ref(&epic));

    assert!(actions.contains(&TaskAction::SetSpec));
    assert!(!actions.contains(&TaskAction::SetPlan));
    assert!(!actions.contains(&TaskAction::BuildStart));
}

#[test]
fn bug_in_open_can_start_build_directly() {
    let bug = make_task("bug-1", "bug", TaskStatus::Open);
    let actions = derive_available_actions(&bug, std::slice::from_ref(&bug));
    assert!(actions.contains(&TaskAction::BuildStart));
}

#[test]
fn in_progress_tasks_expose_builder_action_and_no_plan_actions() {
    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let actions = derive_available_actions(&task, std::slice::from_ref(&task));
    assert!(actions.contains(&TaskAction::OpenBuilder));
    assert!(actions.contains(&TaskAction::ResetImplementation));
    assert!(!actions.contains(&TaskAction::BuildStart));
    assert!(!actions.contains(&TaskAction::OpenQa));
    assert!(!actions.contains(&TaskAction::SetSpec));
    assert!(!actions.contains(&TaskAction::SetPlan));
}

#[test]
fn qa_rejected_in_progress_tasks_expose_rework_and_open_qa_actions() {
    let mut task = make_task("task-1", "task", TaskStatus::InProgress);
    task.document_summary.qa_report.has = true;
    task.document_summary.qa_report.verdict = QaWorkflowVerdict::Rejected;

    let actions = derive_available_actions(&task, std::slice::from_ref(&task));

    assert!(actions.contains(&TaskAction::BuildStart));
    assert!(actions.contains(&TaskAction::OpenBuilder));
    assert!(actions.contains(&TaskAction::OpenQa));
}

#[test]
fn ai_review_tasks_expose_qa_start_request_changes_approve_and_hide_build_start() {
    let task = make_task("task-1", "task", TaskStatus::AiReview);
    let actions = derive_available_actions(&task, std::slice::from_ref(&task));
    assert!(actions.contains(&TaskAction::QaStart));
    assert!(actions.contains(&TaskAction::ResetImplementation));
    assert!(actions.contains(&TaskAction::HumanRequestChanges));
    assert!(actions.contains(&TaskAction::HumanApprove));
    assert!(!actions.contains(&TaskAction::BuildStart));
    assert!(actions.contains(&TaskAction::OpenBuilder));
}

#[test]
fn human_review_tasks_expose_qa_start_and_request_changes() {
    let task = make_task("task-1", "task", TaskStatus::HumanReview);
    let actions = derive_available_actions(&task, std::slice::from_ref(&task));
    assert!(actions.contains(&TaskAction::QaStart));
    assert!(actions.contains(&TaskAction::ResetImplementation));
    assert!(actions.contains(&TaskAction::HumanRequestChanges));
    assert!(actions.contains(&TaskAction::HumanApprove));
}

#[test]
fn task_reset_implementation_discards_builder_state_and_rolls_back_to_ready_for_dev() -> Result<()>
{
    let repo_path = unique_temp_path("reset-implementation-repo");
    fs::create_dir_all(&repo_path)?;
    init_git_repo(&repo_path)?;
    let worktree_base = repo_path.join("worktrees");
    let build_worktree = worktree_base.join("task-1");
    let qa_worktree = worktree_base.join("task-1-qa");
    fs::create_dir_all(&worktree_base)?;
    fs::create_dir_all(&build_worktree)?;
    fs::create_dir_all(&qa_worktree)?;

    let mut task = make_task("task-1", "task", TaskStatus::AiReview);
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
    let _ = service.workspace_add(&repo_path.to_string_lossy())?;
    let repo_config = host_infra_system::RepoConfig {
        branch_prefix: "odt".to_string(),
        worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
        ..Default::default()
    };
    service.workspace_update_repo_config(&repo_path.to_string_lossy(), repo_config)?;
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
                task_id: Some("task-1".to_string()),
                role: "spec".to_string(),
                scenario: Some("spec_initial".to_string()),
                status: Some("stopped".to_string()),
                started_at: "2026-03-17T10:00:00Z".to_string(),
                updated_at: None,
                ended_at: None,
                runtime_kind: "opencode".to_string(),
                working_directory: repo_path.to_string_lossy().to_string(),
                selected_model: None,
            },
            AgentSessionDocument {
                session_id: "build-session".to_string(),
                external_session_id: None,
                task_id: Some("task-1".to_string()),
                role: "build".to_string(),
                scenario: Some("build_implementation_start".to_string()),
                status: Some("stopped".to_string()),
                started_at: "2026-03-17T11:00:00Z".to_string(),
                updated_at: None,
                ended_at: None,
                runtime_kind: "opencode".to_string(),
                working_directory: build_worktree.to_string_lossy().to_string(),
                selected_model: None,
            },
            AgentSessionDocument {
                session_id: "qa-session".to_string(),
                external_session_id: None,
                task_id: Some("task-1".to_string()),
                role: "qa".to_string(),
                scenario: Some("qa_review".to_string()),
                status: Some("stopped".to_string()),
                started_at: "2026-03-17T12:00:00Z".to_string(),
                updated_at: None,
                ended_at: None,
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

    let updated = service.task_reset_implementation(&repo_path.to_string_lossy(), "task-1")?;
    assert_eq!(updated.status, TaskStatus::ReadyForDev);

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

    let mut spec_ready = make_task("task-spec", "task", TaskStatus::InProgress);
    spec_ready.document_summary.spec.has = true;

    let open = make_task("task-open", "task", TaskStatus::HumanReview);

    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![spec_ready, open],
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
    service.workspace_update_repo_config(&repo_path.to_string_lossy(), repo_config)?;

    let spec_ready_result =
        service.task_reset_implementation(&repo_path.to_string_lossy(), "task-spec")?;
    let open_result =
        service.task_reset_implementation(&repo_path.to_string_lossy(), "task-open")?;

    assert_eq!(spec_ready_result.status, TaskStatus::SpecReady);
    assert_eq!(open_result.status, TaskStatus::Open);
    Ok(())
}

#[test]
fn task_reset_implementation_rejects_active_builder_or_qa_sessions() -> Result<()> {
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
    service.workspace_update_repo_config(&repo_path.to_string_lossy(), repo_config)?;
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: None,
        task_id: Some("task-1".to_string()),
        role: "build".to_string(),
        scenario: Some("build_implementation_start".to_string()),
        status: Some("running".to_string()),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        updated_at: None,
        ended_at: None,
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("active session should block reset");
    assert!(error
        .to_string()
        .contains("Stop the active session(s) first"));
    Ok(())
}

#[test]
fn task_reset_implementation_rejects_live_runtime_even_without_persisted_session_status(
) -> Result<()> {
    let repo_path = unique_temp_path("reset-implementation-live-runtime-repo");
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
    service.workspace_update_repo_config(
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
        external_session_id: None,
        task_id: Some("task-1".to_string()),
        role: "build".to_string(),
        scenario: Some("build_implementation_start".to_string()),
        status: None,
        started_at: "2026-03-17T11:00:00Z".to_string(),
        updated_at: None,
        ended_at: None,
        runtime_kind: "opencode".to_string(),
        working_directory: repo_path.to_string_lossy().to_string(),
        selected_model: None,
    }];
    service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .insert(
            "runtime-build".to_string(),
            AgentRuntimeProcess {
                summary: serde_json::from_value(json!({
                    "kind": "opencode",
                    "runtimeId": "runtime-build",
                    "repoPath": repo_path.to_string_lossy().to_string(),
                    "taskId": "task-1",
                    "role": "build",
                    "workingDirectory": repo_path.to_string_lossy().to_string(),
                    "runtimeRoute": {
                        "type": "local_http",
                        "endpoint": "http://127.0.0.1:3456"
                    },
                    "startedAt": "2026-03-17T11:30:00Z",
                    "descriptor": host_domain::AgentRuntimeKind::Opencode.descriptor(),
                }))?,
                child: spawn_sleep_process(20),
                _opencode_process_guard: None,
                cleanup_target: Some(RuntimeCleanupTarget {
                    repo_path: repo_path.to_string_lossy().to_string(),
                    worktree_path: repo_path.to_string_lossy().to_string(),
                }),
            },
        );

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("live runtime should block reset");
    assert!(error
        .to_string()
        .contains("Stop the active session(s) first"));
    service.shutdown()?;
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
    service.workspace_update_repo_config(
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
            task_id: Some("task-1".to_string()),
            role: "build".to_string(),
            scenario: Some("build_implementation_start".to_string()),
            status: Some("stopped".to_string()),
            started_at: "2026-03-17T11:00:00Z".to_string(),
            updated_at: None,
            ended_at: None,
            runtime_kind: "opencode".to_string(),
            working_directory: managed_worktree.to_string_lossy().to_string(),
            selected_model: None,
        },
        AgentSessionDocument {
            session_id: "qa-session".to_string(),
            external_session_id: None,
            task_id: Some("task-1".to_string()),
            role: "qa".to_string(),
            scenario: Some("qa_review".to_string()),
            status: Some("stopped".to_string()),
            started_at: "2026-03-17T12:00:00Z".to_string(),
            updated_at: None,
            ended_at: None,
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
fn task_reset_implementation_fails_before_cleanup_when_task_branch_is_checked_out() -> Result<()> {
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
    service.workspace_update_repo_config(
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
    task_state
        .lock()
        .expect("task store lock poisoned")
        .agent_sessions = vec![AgentSessionDocument {
        session_id: "build-session".to_string(),
        external_session_id: None,
        task_id: Some("task-1".to_string()),
        role: "build".to_string(),
        scenario: Some("build_implementation_start".to_string()),
        status: Some("stopped".to_string()),
        started_at: "2026-03-17T11:00:00Z".to_string(),
        updated_at: None,
        ended_at: None,
        runtime_kind: "opencode".to_string(),
        working_directory: build_worktree.to_string_lossy().to_string(),
        selected_model: None,
    }];

    let error = service
        .task_reset_implementation(&repo_path.to_string_lossy(), "task-1")
        .expect_err("checked-out task branch should block reset");
    assert!(error
        .to_string()
        .contains("Cannot reset implementation while branch odt/task-1 is checked out"));

    let git_calls = &git_state.lock().expect("git state lock poisoned").calls;
    assert!(!git_calls.iter().any(|call| matches!(
        call,
        crate::app_service::test_support::GitCall::RemoveWorktree { .. }
            | crate::app_service::test_support::GitCall::DeleteLocalBranch { .. }
    )));

    Ok(())
}

#[test]
fn deferred_parent_task_exposes_resume_and_hides_defer() {
    let deferred = make_task("task-1", "task", TaskStatus::Deferred);
    let actions = derive_available_actions(&deferred, std::slice::from_ref(&deferred));
    assert!(actions.contains(&TaskAction::ResumeDeferred));
    assert!(!actions.contains(&TaskAction::DeferIssue));
}

#[test]
fn wait_for_local_server_returns_ok_when_port_is_open() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
    let port = listener.local_addr().expect("addr").port();
    let result = wait_for_local_server(port, Duration::from_millis(500));
    assert!(result.is_ok());
}

fn find_closed_low_port() -> u16 {
    for port in 1..1024 {
        if TcpStream::connect(("127.0.0.1", port)).is_err() {
            return port;
        }
    }
    panic!("expected at least one closed privileged localhost port");
}

#[test]
fn wait_for_local_server_times_out_when_port_is_closed() {
    let port = find_closed_low_port();
    let result = wait_for_local_server(port, Duration::from_millis(250));
    assert!(result.is_err());
}

fn test_startup_policy(timeout: Duration) -> OpencodeStartupReadinessPolicy {
    OpencodeStartupReadinessPolicy {
        timeout,
        connect_timeout: Duration::from_millis(50),
        initial_retry_delay: Duration::from_millis(10),
        max_retry_delay: Duration::from_millis(50),
        child_state_check_interval: Duration::from_millis(25),
    }
}

#[test]
fn opencode_startup_event_payload_contract_includes_correlation_and_metrics() {
    let policy = test_startup_policy(Duration::from_millis(8_000));
    let report = OpencodeStartupWaitReport::from_parts(7, Duration::from_millis(321));
    let mut metrics = OpencodeStartupMetricsSnapshot {
        total: 4,
        ready: 3,
        failed: 1,
        ..OpencodeStartupMetricsSnapshot::default()
    };
    metrics.failed_by_reason.insert("timeout".to_string(), 1);
    if let Some(bucket) = metrics.startup_ms_histogram.get_mut("<=500") {
        *bucket = 4;
    }
    if let Some(bucket) = metrics.attempts_histogram.get_mut("<=10") {
        *bucket = 4;
    }

    let event = StartupEventPayload::ready(
        StartupEventContext::new(
            "agent_runtime",
            "/tmp/repo",
            Some("task-42"),
            "qa",
            4242,
            Some(StartupEventCorrelation::new("runtime_id", "runtime-abc")),
            Some(policy),
        ),
        report,
    );
    let payload = build_opencode_startup_event_payload(
        &event,
        Some(metrics),
        vec!["startup_duration_high:321".to_string()],
    );
    let payload_json = serde_json::to_value(payload).expect("payload should serialize");

    assert_eq!(payload_json["event"], "startup_ready");
    assert_eq!(payload_json["scope"], "agent_runtime");
    assert_eq!(payload_json["repoPath"], "/tmp/repo");
    assert_eq!(payload_json["taskId"], "task-42");
    assert_eq!(payload_json["role"], "qa");
    assert_eq!(payload_json["port"], 4242);
    assert_eq!(payload_json["correlationType"], "runtime_id");
    assert_eq!(payload_json["correlationId"], "runtime-abc");
    assert_eq!(payload_json["policy"]["timeoutMs"], 8_000);
    assert_eq!(payload_json["report"]["startupMs"], 321);
    assert_eq!(payload_json["report"]["attempts"], 7);
    assert_eq!(payload_json["metrics"]["total"], 4);
    assert_eq!(payload_json["metrics"]["ready"], 3);
    assert_eq!(payload_json["metrics"]["failed"], 1);
    assert_eq!(payload_json["alerts"][0], "startup_duration_high:321");
}

#[test]
fn opencode_startup_readiness_policy_uses_config_overrides() -> Result<()> {
    let root = unique_temp_path("startup-policy-config");
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let runtime_config_store = RuntimeConfigStore::from_user_settings_store(&config_store);
    let config = RuntimeConfig {
        opencode_startup: OpencodeStartupReadinessConfig {
            timeout_ms: 12_345,
            connect_timeout_ms: 456,
            initial_retry_delay_ms: 33,
            max_retry_delay_ms: 99,
            child_check_interval_ms: 77,
        },
        ..RuntimeConfig::default()
    };
    runtime_config_store.save(&config)?;

    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: Arc::new(Mutex::new(TaskStoreState::default())),
    });
    let service = AppService::new(task_store, config_store);
    let policy = service.opencode_startup_readiness_policy()?;
    assert_eq!(policy.timeout, Duration::from_millis(12_345));
    assert_eq!(policy.connect_timeout, Duration::from_millis(456));
    assert_eq!(policy.initial_retry_delay, Duration::from_millis(33));
    assert_eq!(policy.max_retry_delay, Duration::from_millis(99));
    assert_eq!(policy.child_state_check_interval, Duration::from_millis(77));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_startup_readiness_policy_returns_actionable_error_on_invalid_config() -> Result<()> {
    let root = unique_temp_path("startup-policy-invalid-config");
    let config_path = root.join("runtime-config.json");
    fs::create_dir_all(&root)?;
    write_private_file(&config_path, "{ invalid json")?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: Arc::new(Mutex::new(TaskStoreState::default())),
    });
    let service = AppService::new(task_store, config_store);
    let error = service
        .opencode_startup_readiness_policy()
        .expect_err("invalid config should fail startup readiness policy load");
    let message = format!("{error:#}");
    assert!(
        message.contains(&format!(
            "Failed loading OpenCode startup readiness config from {}",
            config_path.display()
        )),
        "error should include startup context and config path: {message}"
    );
    assert!(
        message.contains(
            "Fix invalid JSON in this file or delete it so OpenDucktor can recreate defaults"
        ),
        "error should include recovery instruction: {message}"
    );
    assert!(
        message.contains("Failed parsing config file"),
        "error should preserve parse failure context: {message}"
    );

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn resolve_build_startup_policy_emits_config_failure_metrics() -> Result<()> {
    let root = unique_temp_path("build-startup-policy-invalid-config");
    let config_path = root.join("runtime-config.json");
    fs::create_dir_all(&root)?;
    write_private_file(&config_path, "{ invalid json")?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: Arc::new(Mutex::new(TaskStoreState::default())),
    });
    let service = AppService::new(task_store, config_store);
    let error = service
        .resolve_build_startup_policy("/tmp/repo", "task-42", "run-abc")
        .expect_err("invalid config should fail build startup policy resolution");
    let message = format!("{error:#}");
    assert!(message.contains("OpenCode build runtime failed before worktree preparation"));
    assert!(message.contains("Failed loading OpenCode startup readiness config"));

    let metrics = service.startup_metrics_snapshot()?;
    assert_eq!(
        metrics.failed_by_reason.get("startup_config_invalid"),
        Some(&1)
    );
    Ok(())
}

#[test]
fn resolve_runtime_startup_policy_emits_config_failure_metrics() -> Result<()> {
    let root = unique_temp_path("runtime-startup-policy-invalid-config");
    let config_path = root.join("runtime-config.json");
    fs::create_dir_all(&root)?;
    write_private_file(&config_path, "{ invalid json")?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let task_store: Arc<dyn TaskStore> = Arc::new(FakeTaskStore {
        state: Arc::new(Mutex::new(TaskStoreState::default())),
    });
    let service = AppService::new(task_store, config_store);
    let error = service
        .resolve_runtime_startup_policy(
            "agent_runtime",
            "/tmp/repo",
            "task-42",
            RuntimeRole::Qa,
            "opencode runtime failed to start for task task-42",
        )
        .expect_err("invalid config should fail runtime startup policy resolution");
    let message = format!("{error:#}");
    assert!(message.contains("opencode runtime failed to start for task task-42"));
    assert!(message.contains("Failed loading OpenCode startup readiness config"));

    let metrics = service.startup_metrics_snapshot()?;
    assert_eq!(
        metrics.failed_by_reason.get("startup_config_invalid"),
        Some(&1)
    );
    Ok(())
}

#[test]
fn terminate_child_process_stops_background_process() {
    let mut child = Command::new("/bin/sh")
        .arg("-lc")
        .arg("sleep 5")
        .spawn()
        .expect("spawn sleep");
    terminate_child_process(&mut child);
    let status = child.try_wait().expect("try_wait should succeed");
    assert!(status.is_some(), "child process should be terminated");
}

#[test]
fn wait_for_local_server_with_process_returns_early_when_child_exits() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
    let port = listener.local_addr().expect("addr").port();
    drop(listener);

    let mut child = Command::new("/bin/sh")
        .arg("-lc")
        .arg("echo startup failed >&2; exit 42")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn failing process");
    let cancel_epoch = Arc::new(AtomicU64::new(0));
    let error = wait_for_local_server_with_process(
        &mut child,
        port,
        test_startup_policy(Duration::from_secs(2)),
        &cancel_epoch,
        0,
    )
    .expect_err("should report early process exit");
    assert!(error.to_string().contains("startup failed"));
    assert_eq!(error.reason, "child_exited");
}

#[test]
fn wait_for_local_server_with_process_times_out_when_child_stays_alive() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
    let port = listener.local_addr().expect("addr").port();
    drop(listener);

    let mut child = Command::new("/bin/sh")
        .arg("-lc")
        .arg("sleep 5")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn sleeping process");
    let cancel_epoch = Arc::new(AtomicU64::new(0));
    let error = wait_for_local_server_with_process(
        &mut child,
        port,
        test_startup_policy(Duration::from_millis(250)),
        &cancel_epoch,
        0,
    )
    .expect_err("should time out when child remains alive and port stays closed");
    terminate_child_process(&mut child);
    assert_eq!(error.reason, "timeout");
}

#[test]
fn wait_for_local_server_with_process_honors_total_timeout_budget_when_connect_timeout_is_large() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
    let port = listener.local_addr().expect("addr").port();
    drop(listener);

    let mut child = Command::new("/bin/sh")
        .arg("-lc")
        .arg("sleep 5")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn sleeping process");
    let cancel_epoch = Arc::new(AtomicU64::new(0));
    let started_at = Instant::now();
    let error = wait_for_local_server_with_process(
        &mut child,
        port,
        OpencodeStartupReadinessPolicy {
            timeout: Duration::from_millis(250),
            connect_timeout: Duration::from_secs(10),
            initial_retry_delay: Duration::from_millis(10),
            max_retry_delay: Duration::from_millis(50),
            child_state_check_interval: Duration::from_millis(25),
        },
        &cancel_epoch,
        0,
    )
    .expect_err("total timeout budget should cap each connect attempt");
    let elapsed = started_at.elapsed();
    terminate_child_process(&mut child);
    assert_eq!(error.reason, "timeout");
    assert!(
        elapsed < Duration::from_secs(2),
        "startup wait should not exceed total budget window, elapsed={elapsed:?}"
    );
}

#[test]
fn wait_for_local_server_with_process_honors_cancellation_epoch() {
    let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
    let port = listener.local_addr().expect("addr").port();
    drop(listener);

    let mut child = Command::new("/bin/sh")
        .arg("-lc")
        .arg("sleep 5")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .expect("spawn sleeping process");
    let cancel_epoch = Arc::new(AtomicU64::new(1));
    let snapshot = cancel_epoch.load(Ordering::SeqCst);
    cancel_epoch.fetch_add(1, Ordering::SeqCst);
    let error = wait_for_local_server_with_process(
        &mut child,
        port,
        test_startup_policy(Duration::from_secs(2)),
        &cancel_epoch,
        snapshot,
    )
    .expect_err("should stop waiting when cancellation epoch changes");
    terminate_child_process(&mut child);
    assert_eq!(error.reason, "cancelled");
}
