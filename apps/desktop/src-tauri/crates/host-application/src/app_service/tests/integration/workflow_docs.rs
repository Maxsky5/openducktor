#![allow(unused_imports)]

use anyhow::{anyhow, Context, Result};
use host_domain::{
    AgentRuntimeSummary, AgentSessionDocument, CreateTaskInput, GitBranch, GitCurrentBranch,
    GitPort, PlanSubtaskInput, QaReportDocument, QaVerdict, RunEvent, RunState, RunSummary, TaskAction, TaskStatus,
    TaskStore, UpdateTaskPatch,
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
use crate::app_service::{
    build_opencode_config_content, can_set_plan, default_mcp_workspace_root, parse_mcp_command_json,
    read_opencode_process_registry, read_opencode_version, resolve_mcp_command,
    resolve_opencode_binary_path, terminate_child_process, terminate_process_by_pid,
    validate_parent_relationships_for_update, AgentRuntimeProcess, OpencodeProcessRegistryInstance,
    RunProcess, TrackedOpencodeProcessGuard, OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH,
    with_locked_opencode_process_registry,
};
use crate::app_service::test_support::{
    FakeTaskStore, GitCall, TaskStoreState, build_service_with_git_state, build_service_with_store,
    create_fake_bd, create_fake_opencode, create_failing_opencode,
    create_failing_opencode_with_worktree_cleanup, create_orphanable_opencode, empty_patch,
    init_git_repo, lock_env, make_emitter, make_session, make_task, prepend_path,
    process_is_alive, remove_env_var, set_env_var, spawn_sleep_process, unique_temp_path,
    wait_for_orphaned_opencode_process, wait_for_path_exists, wait_for_process_exit,
    write_executable_script,
};

#[test]
fn task_update_rejects_direct_status_changes() {
    let repo_path = "/tmp/odt-repo-task-update";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let error = service
        .task_update(
            repo_path,
            "task-1",
            UpdateTaskPatch {
                title: None,
                description: None,
                acceptance_criteria: None,
                notes: None,
                status: Some(TaskStatus::Closed),
                priority: None,
                issue_type: None,
                ai_review_enabled: None,
                labels: None,
                assignee: None,
                parent_id: None,
            },
        )
        .expect_err("direct status updates should fail");
    assert!(error
        .to_string()
        .contains("Status cannot be updated directly"));
}

#[test]
fn validate_parent_relationships_for_update_enforces_hierarchy_constraints() {
    let epic = make_task("epic-1", "epic", TaskStatus::Open);
    let current = make_task("task-1", "task", TaskStatus::Open);
    let mut direct_subtask = make_task("sub-1", "task", TaskStatus::Open);
    direct_subtask.parent_id = Some("task-1".to_string());
    let feature_parent = make_task("feature-1", "feature", TaskStatus::Open);
    let mut nested_parent = make_task("nested-parent", "epic", TaskStatus::Open);
    nested_parent.parent_id = Some("epic-1".to_string());

    let tasks = vec![
        epic.clone(),
        current.clone(),
        direct_subtask.clone(),
        feature_parent.clone(),
        nested_parent.clone(),
    ];

    let mut epic_parent_patch = empty_patch();
    epic_parent_patch.parent_id = Some("task-1".to_string());
    let epic_error = validate_parent_relationships_for_update(&tasks, &epic, &epic_parent_patch)
        .expect_err("epic should not become subtask");
    assert!(epic_error
        .to_string()
        .contains("Epics cannot be converted to subtasks."));

    let mut become_subtask_patch = empty_patch();
    become_subtask_patch.parent_id = Some("epic-1".to_string());
    let parent_error =
        validate_parent_relationships_for_update(&tasks, &current, &become_subtask_patch)
            .expect_err("task with direct subtasks cannot become subtask");
    assert!(parent_error
        .to_string()
        .contains("Tasks with subtasks cannot become subtasks."));

    let mut non_epic_patch = empty_patch();
    non_epic_patch.issue_type = Some("feature".to_string());
    let type_error = validate_parent_relationships_for_update(&tasks, &current, &non_epic_patch)
        .expect_err("task with direct subtasks must remain epic");
    assert!(type_error
        .to_string()
        .contains("Only epics can have subtasks."));

    let standalone = make_task("standalone", "task", TaskStatus::Open);
    let tasks_for_parent_checks = vec![
        epic.clone(),
        standalone.clone(),
        feature_parent.clone(),
        nested_parent.clone(),
    ];

    let mut bad_parent_patch = empty_patch();
    bad_parent_patch.parent_id = Some("feature-1".to_string());
    let bad_parent_error = validate_parent_relationships_for_update(
        &tasks_for_parent_checks,
        &standalone,
        &bad_parent_patch,
    )
    .expect_err("non-epic parent should be rejected");
    assert!(bad_parent_error
        .to_string()
        .contains("Only epics can be selected as parents."));

    let mut nested_parent_patch = empty_patch();
    nested_parent_patch.parent_id = Some("nested-parent".to_string());
    let nested_parent_error = validate_parent_relationships_for_update(
        &tasks_for_parent_checks,
        &standalone,
        &nested_parent_patch,
    )
    .expect_err("nested parent should be rejected");
    assert!(nested_parent_error
        .to_string()
        .contains("Subtask depth is limited to one level."));

    let mut clear_parent_patch = empty_patch();
    clear_parent_patch.parent_id = Some("   ".to_string());
    let mut current_with_parent = standalone.clone();
    current_with_parent.parent_id = Some("epic-1".to_string());
    assert!(validate_parent_relationships_for_update(
        &tasks_for_parent_checks,
        &current_with_parent,
        &clear_parent_patch,
    )
    .is_ok());
}

#[test]
fn task_delete_blocks_when_subtasks_exist_without_confirmation() {
    let repo_path = "/tmp/odt-repo-task-delete";
    let parent = make_task("parent-1", "epic", TaskStatus::Open);
    let mut child = make_task("child-1", "task", TaskStatus::Open);
    child.parent_id = Some("parent-1".to_string());
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![parent, child],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let error = service
        .task_delete(repo_path, "parent-1", false)
        .expect_err("delete must require subtask confirmation");
    assert!(error.to_string().contains("Confirm subtask deletion"));

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state.delete_calls.is_empty());
}

#[test]
fn task_delete_allows_cascade_and_forwards_delete_flag() -> Result<()> {
    let repo_path = "/tmp/odt-repo-task-delete-cascade";
    let parent = make_task("parent-1", "epic", TaskStatus::Open);
    let mut child = make_task("child-1", "task", TaskStatus::Open);
    child.parent_id = Some("parent-1".to_string());
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![parent, child],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    service.task_delete(repo_path, "parent-1", true)?;

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.delete_calls,
        vec![("parent-1".to_string(), true)]
    );
    Ok(())
}

#[test]
fn build_blocked_requires_non_empty_reason() {
    let repo_path = "/tmp/odt-repo-build";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::InProgress)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let error = service
        .build_blocked(repo_path, "task-1", Some("   "))
        .expect_err("blank reason should fail");
    assert!(error.to_string().contains("requires a non-empty reason"));
}

#[test]
fn build_resumed_human_actions_and_resume_deferred_paths_work() -> Result<()> {
    let repo_path = "/tmp/odt-repo-human-actions";
    let mut deferred = make_task("task-deferred", "task", TaskStatus::Deferred);
    deferred.parent_id = None;
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![
            make_task("task-blocked", "task", TaskStatus::Blocked),
            make_task("task-human-review", "task", TaskStatus::HumanReview),
            make_task("task-approve", "task", TaskStatus::HumanReview),
            deferred,
        ],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let resumed = service.build_resumed(repo_path, "task-blocked")?;
    assert_eq!(resumed.status, TaskStatus::InProgress);

    let requested_changes = service.human_request_changes(repo_path, "task-human-review", None)?;
    assert_eq!(requested_changes.status, TaskStatus::InProgress);

    let approved = service.human_approve(repo_path, "task-approve")?;
    assert_eq!(approved.status, TaskStatus::Closed);

    let resumed_deferred = service.task_resume_deferred(repo_path, "task-deferred")?;
    assert_eq!(resumed_deferred.status, TaskStatus::Open);
    Ok(())
}

#[test]
fn task_resume_deferred_requires_deferred_state() {
    let repo_path = "/tmp/odt-repo-resume";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let error = service
        .task_resume_deferred(repo_path, "task-1")
        .expect_err("non-deferred task should fail");
    assert!(error.to_string().contains("Task is not deferred"));
}

#[test]
fn tasks_list_enriches_available_actions() -> Result<()> {
    let repo_path = "/tmp/odt-repo-list";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![make_task("feature-1", "feature", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let tasks = service.tasks_list(repo_path)?;
    assert_eq!(tasks.len(), 1);
    assert!(tasks[0].available_actions.contains(&TaskAction::SetSpec));
    assert!(tasks[0]
        .available_actions
        .contains(&TaskAction::ViewDetails));
    Ok(())
}

#[test]
fn task_create_normalizes_issue_type_and_defaults_ai_review() -> Result<()> {
    let repo_path = "/tmp/odt-repo-create";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let created = service.task_create(
        repo_path,
        CreateTaskInput {
            title: "New task".to_string(),
            issue_type: "something-unknown".to_string(),
            priority: 2,
            description: None,
            acceptance_criteria: None,
            labels: None,
            ai_review_enabled: None,
            parent_id: None,
        },
    )?;
    assert_eq!(created.issue_type, "task");
    assert!(created.ai_review_enabled);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(task_state.created_inputs.len(), 1);
    assert_eq!(task_state.created_inputs[0].issue_type, "task");
    assert_eq!(task_state.created_inputs[0].ai_review_enabled, Some(true));
    Ok(())
}

#[test]
fn task_transition_returns_current_task_when_status_is_unchanged() -> Result<()> {
    let repo_path = "/tmp/odt-repo-transition-same";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let task = service.task_transition(repo_path, "task-1", TaskStatus::Open, None)?;
    assert_eq!(task.status, TaskStatus::Open);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state.updated_patches.is_empty());
    Ok(())
}

#[test]
fn task_transition_updates_status_when_valid() -> Result<()> {
    let repo_path = "/tmp/odt-repo-transition-update";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("bug-1", "bug", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let task = service.task_transition(repo_path, "bug-1", TaskStatus::InProgress, None)?;
    assert_eq!(task.status, TaskStatus::InProgress);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(task_state.updated_patches.len(), 1);
    assert_eq!(
        task_state.updated_patches[0].1.status,
        Some(TaskStatus::InProgress)
    );
    Ok(())
}

#[test]
fn build_completed_routes_to_ai_review_when_enabled() -> Result<()> {
    let repo_path = "/tmp/odt-repo-build-ai";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::InProgress)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let task = service.build_completed(repo_path, "task-1", Some("done"))?;
    assert_eq!(task.status, TaskStatus::AiReview);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::AiReview)));
    Ok(())
}

#[test]
fn build_completed_routes_to_human_review_when_ai_is_disabled() -> Result<()> {
    let repo_path = "/tmp/odt-repo-build-human";
    let mut task = make_task("task-1", "task", TaskStatus::InProgress);
    task.ai_review_enabled = false;
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![task],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let task = service.build_completed(repo_path, "task-1", None)?;
    assert_eq!(task.status, TaskStatus::HumanReview);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::HumanReview)));
    Ok(())
}

#[test]
fn task_defer_rejects_subtasks() {
    let repo_path = "/tmp/odt-repo-defer-subtask";
    let mut subtask = make_task("task-1", "task", TaskStatus::Open);
    subtask.parent_id = Some("epic-1".to_string());
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![subtask],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let error = service
        .task_defer(repo_path, "task-1", Some("later"))
        .expect_err("subtasks cannot be deferred");
    assert!(error.to_string().contains("Subtasks cannot be deferred"));
}

#[test]
fn task_defer_transitions_open_parent_task() -> Result<()> {
    let repo_path = "/tmp/odt-repo-defer-parent";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let task = service.task_defer(repo_path, "task-1", Some("later"))?;
    assert_eq!(task.status, TaskStatus::Deferred);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::Deferred)));
    Ok(())
}

#[test]
fn task_defer_rejects_closed_tasks() {
    let repo_path = "/tmp/odt-repo-defer-closed";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::Closed)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let error = service
        .task_defer(repo_path, "task-1", None)
        .expect_err("closed tasks cannot be deferred");
    assert!(error
        .to_string()
        .contains("Only non-closed open-state tasks"));
}

#[test]
fn set_spec_persists_trimmed_markdown_and_transitions_open_task() -> Result<()> {
    let repo_path = "/tmp/odt-repo-spec";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "feature", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let spec = service.set_spec(repo_path, "task-1", "  # Spec  ")?;
    assert_eq!(spec.markdown, "# Spec");

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.spec_set_calls,
        vec![("task-1".to_string(), "# Spec".to_string())]
    );
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::SpecReady)));
    Ok(())
}

#[test]
fn set_spec_rejects_invalid_status() {
    let repo_path = "/tmp/odt-repo-spec-invalid";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::InProgress)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let error = service
        .set_spec(repo_path, "task-1", "# Spec")
        .expect_err("set_spec should be blocked in in_progress");
    assert!(error.to_string().contains("set_spec is only allowed"));
}

#[test]
fn set_plan_for_non_epic_transitions_ready_for_dev() -> Result<()> {
    let repo_path = "/tmp/odt-repo-plan-task";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let plan = service.set_plan(repo_path, "task-1", "  # Plan  ", None)?;
    assert_eq!(plan.markdown, "# Plan");

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.plan_set_calls,
        vec![("task-1".to_string(), "# Plan".to_string())]
    );
    assert_eq!(task_state.created_inputs.len(), 0);
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::ReadyForDev)));
    Ok(())
}

#[test]
fn set_plan_allows_feature_from_ready_for_dev_without_status_transition() -> Result<()> {
    let repo_path = "/tmp/odt-repo-plan-feature-ready";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "feature", TaskStatus::ReadyForDev)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let plan = service.set_plan(repo_path, "task-1", "  # Revised Plan  ", None)?;
    assert_eq!(plan.markdown, "# Revised Plan");

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.plan_set_calls,
        vec![("task-1".to_string(), "# Revised Plan".to_string())]
    );
    assert!(
        !task_state
            .updated_patches
            .iter()
            .any(|(_, patch)| patch.status.is_some()),
        "status update should be skipped when already ready_for_dev"
    );
    Ok(())
}

#[test]
fn set_plan_rejects_invalid_status_for_feature() {
    let repo_path = "/tmp/odt-repo-plan-invalid";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "feature", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let error = service
        .set_plan(repo_path, "task-1", "# Plan", None)
        .expect_err("feature/open should not allow plan");
    assert!(error.to_string().contains("set_plan is not allowed"));
}

#[test]
fn set_plan_for_epic_replaces_existing_subtasks_with_new_plan_proposals() -> Result<()> {
    let repo_path = "/tmp/odt-repo-plan-epic";
    let epic = make_task("epic-1", "epic", TaskStatus::SpecReady);
    let mut existing_child = make_task("child-1", "task", TaskStatus::Open);
    existing_child.title = "Build API".to_string();
    existing_child.parent_id = Some("epic-1".to_string());

    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![epic, existing_child],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let plan = service.set_plan(
        repo_path,
        "epic-1",
        "# Epic Plan",
        Some(vec![
            PlanSubtaskInput {
                title: "Build API".to_string(),
                issue_type: Some("task".to_string()),
                priority: Some(2),
                description: None,
            },
            PlanSubtaskInput {
                title: "Build UI".to_string(),
                issue_type: Some("feature".to_string()),
                priority: Some(2),
                description: Some("Add interface".to_string()),
            },
            PlanSubtaskInput {
                title: "Build UI".to_string(),
                issue_type: Some("feature".to_string()),
                priority: Some(2),
                description: Some("Duplicate".to_string()),
            },
        ]),
    )?;
    assert_eq!(plan.markdown, "# Epic Plan");

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.delete_calls,
        vec![("child-1".to_string(), false)]
    );
    assert_eq!(task_state.created_inputs.len(), 2);
    assert_eq!(task_state.created_inputs[0].title, "Build API");
    assert_eq!(
        task_state.created_inputs[0].parent_id.as_deref(),
        Some("epic-1")
    );
    assert_eq!(task_state.created_inputs[1].title, "Build UI");
    assert_eq!(
        task_state.created_inputs[1].parent_id.as_deref(),
        Some("epic-1")
    );
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::ReadyForDev)));
    Ok(())
}

#[test]
fn set_plan_for_epic_without_subtasks_clears_existing_direct_subtasks() -> Result<()> {
    let repo_path = "/tmp/odt-repo-plan-epic-clear";
    let epic = make_task("epic-1", "epic", TaskStatus::SpecReady);
    let mut existing_child = make_task("child-1", "task", TaskStatus::Open);
    existing_child.parent_id = Some("epic-1".to_string());

    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![epic, existing_child],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let plan = service.set_plan(repo_path, "epic-1", "# Epic Plan", None)?;
    assert_eq!(plan.markdown, "# Epic Plan");

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.delete_calls,
        vec![("child-1".to_string(), false)]
    );
    assert!(task_state.created_inputs.is_empty());
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::ReadyForDev)));
    Ok(())
}

#[test]
fn set_plan_for_epic_rejects_subtask_replacement_when_existing_subtask_is_active() {
    let repo_path = "/tmp/odt-repo-plan-epic-active-subtask";
    let epic = make_task("epic-1", "epic", TaskStatus::SpecReady);
    let mut active_child = make_task("child-1", "task", TaskStatus::InProgress);
    active_child.parent_id = Some("epic-1".to_string());

    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![epic, active_child],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let error = service
        .set_plan(
            repo_path,
            "epic-1",
            "# Epic Plan",
            Some(vec![PlanSubtaskInput {
                title: "Build API".to_string(),
                issue_type: Some("task".to_string()),
                priority: Some(2),
                description: None,
            }]),
        )
        .expect_err("active direct subtasks must block replacement");
    assert!(
        error
            .to_string()
            .contains("Cannot replace epic subtasks while active work exists"),
        "unexpected error: {error}"
    );

    let task_state = task_state.lock().expect("task lock poisoned");
    assert!(task_state.delete_calls.is_empty());
    assert!(task_state.created_inputs.is_empty());
}

#[test]
fn qa_get_report_returns_latest_markdown_when_present() -> Result<()> {
    let repo_path = "/tmp/odt-repo-qa-report";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );
    {
        let mut state = task_state.lock().expect("task lock poisoned");
        state.latest_qa_report = Some(QaReportDocument {
            markdown: "QA body".to_string(),
            verdict: QaVerdict::Approved,
            updated_at: "2026-02-20T12:00:00Z".to_string(),
            revision: 2,
        });
    }

    let report = service.qa_get_report(repo_path, "task-1")?;
    assert_eq!(report.markdown, "QA body");
    assert_eq!(report.updated_at.as_deref(), Some("2026-02-20T12:00:00Z"));
    Ok(())
}

#[test]
fn qa_get_report_returns_empty_when_not_present() -> Result<()> {
    let repo_path = "/tmp/odt-repo-qa-empty";
    let (service, _task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let report = service.qa_get_report(repo_path, "task-1")?;
    assert!(report.markdown.is_empty());
    assert!(report.updated_at.is_none());
    Ok(())
}

#[test]
fn spec_get_and_plan_get_use_consolidated_metadata_lookup() -> Result<()> {
    let repo_path = "/tmp/odt-repo-docs-read";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let _ = service.spec_get(repo_path, "task-1")?;
    let _ = service.plan_get(repo_path, "task-1")?;

    let state = task_state.lock().expect("task lock poisoned");
    assert!(state.spec_get_calls.is_empty());
    assert!(state.plan_get_calls.is_empty());
    assert_eq!(
        state.metadata_get_calls,
        vec!["task-1".to_string(), "task-1".to_string()]
    );
    Ok(())
}

#[test]
fn qa_approved_appends_report_and_transitions_to_human_review() -> Result<()> {
    let repo_path = "/tmp/odt-repo-qa-approved";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::AiReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let task = service.qa_approved(repo_path, "task-1", "Looks good")?;
    assert_eq!(task.status, TaskStatus::HumanReview);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.qa_append_calls,
        vec![(
            "task-1".to_string(),
            "Looks good".to_string(),
            QaVerdict::Approved
        )]
    );
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::HumanReview)));
    Ok(())
}

#[test]
fn qa_rejected_appends_report_and_transitions_to_in_progress() -> Result<()> {
    let repo_path = "/tmp/odt-repo-qa-rejected";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![make_task("task-1", "task", TaskStatus::AiReview)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let task = service.qa_rejected(repo_path, "task-1", "Needs work")?;
    assert_eq!(task.status, TaskStatus::InProgress);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(
        task_state.qa_append_calls,
        vec![(
            "task-1".to_string(),
            "Needs work".to_string(),
            QaVerdict::Rejected
        )]
    );
    assert!(task_state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::InProgress)));
    Ok(())
}

#[test]
fn agent_sessions_list_and_upsert_flow_through_store() -> Result<()> {
    let repo_path = "/tmp/odt-repo-sessions";
    let (service, task_state, _git_state) = build_service_with_git_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );
    {
        let mut state = task_state.lock().expect("task lock poisoned");
        state.agent_sessions = vec![make_session("task-1", "session-1")];
    }

    let sessions = service.agent_sessions_list(repo_path, "task-1")?;
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_id, "session-1");

    let upserted = service.agent_session_upsert(
        repo_path,
        "task-1",
        make_session("wrong-task", "session-2"),
    )?;
    assert!(upserted);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(task_state.upserted_sessions.len(), 1);
    assert_eq!(task_state.upserted_sessions[0].0, "task-1");
    assert_eq!(task_state.upserted_sessions[0].1.task_id, "task-1");
    Ok(())
}

