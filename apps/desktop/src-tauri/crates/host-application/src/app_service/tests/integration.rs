use super::*;

#[test]
fn git_get_branches_initializes_repo_and_returns_git_data() -> Result<()> {
    let repo_path = "/tmp/odt-repo";
    let expected = vec![
        GitBranch {
            name: "main".to_string(),
            is_current: true,
            is_remote: false,
        },
        GitBranch {
            name: "origin/main".to_string(),
            is_current: false,
            is_remote: true,
        },
    ];
    let (service, task_state, git_state) = build_service_with_state(
        vec![],
        expected.clone(),
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let branches = service.git_get_branches(repo_path)?;
    assert_eq!(branches, expected);

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(task_state.ensure_calls, vec![repo_path.to_string()]);
    drop(task_state);

    let git_state = git_state.lock().expect("git lock poisoned");
    assert_eq!(
        git_state.calls,
        vec![GitCall::GetBranches {
            repo_path: repo_path.to_string()
        }]
    );
    Ok(())
}

#[test]
fn git_get_current_branch_uses_repo_init_cache() -> Result<()> {
    let repo_path = "/tmp/odt-repo-cache";
    let (service, task_state, git_state) = build_service_with_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("feature/demo".to_string()),
            detached: false,
        },
    );

    let first = service.git_get_current_branch(repo_path)?;
    let second = service.git_get_current_branch(repo_path)?;
    assert_eq!(first.name.as_deref(), Some("feature/demo"));
    assert_eq!(second.name.as_deref(), Some("feature/demo"));

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(task_state.ensure_calls.len(), 1);
    drop(task_state);

    let git_state = git_state.lock().expect("git lock poisoned");
    assert_eq!(
        git_state.calls,
        vec![
            GitCall::GetCurrentBranch {
                repo_path: repo_path.to_string()
            },
            GitCall::GetCurrentBranch {
                repo_path: repo_path.to_string()
            }
        ]
    );
    Ok(())
}

#[test]
fn git_switch_branch_forwards_create_flag() -> Result<()> {
    let repo_path = "/tmp/odt-repo-switch";
    let (service, _task_state, git_state) = build_service_with_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let branch = service.git_switch_branch(repo_path, "feature/new-ui", true)?;
    assert_eq!(branch.name.as_deref(), Some("feature/new-ui"));
    assert!(!branch.detached);

    let git_state = git_state.lock().expect("git lock poisoned");
    assert!(git_state.calls.contains(&GitCall::SwitchBranch {
        repo_path: repo_path.to_string(),
        branch: "feature/new-ui".to_string(),
        create: true,
    }));
    Ok(())
}

#[test]
fn git_create_worktree_rejects_empty_path() {
    let repo_path = "/tmp/odt-repo-worktree";
    let (service, task_state, git_state) = build_service_with_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let error = service
        .git_create_worktree(repo_path, "   ", "feature/new", true)
        .expect_err("empty worktree path should fail");
    assert!(error.to_string().contains("worktree path cannot be empty"));

    let task_state = task_state.lock().expect("task lock poisoned");
    assert_eq!(task_state.ensure_calls, vec![repo_path.to_string()]);
    drop(task_state);

    let git_state = git_state.lock().expect("git lock poisoned");
    assert!(git_state
        .calls
        .iter()
        .all(|call| !matches!(call, GitCall::CreateWorktree { .. })));
}

#[test]
fn git_remove_worktree_forwards_force_flag() -> Result<()> {
    let repo_path = "/tmp/odt-repo-remove-worktree";
    let (service, _task_state, git_state) = build_service_with_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    assert!(service.git_remove_worktree(repo_path, "/tmp/wt-1", true)?);

    let git_state = git_state.lock().expect("git lock poisoned");
    assert!(git_state.calls.contains(&GitCall::RemoveWorktree {
        repo_path: repo_path.to_string(),
        worktree_path: "/tmp/wt-1".to_string(),
        force: true,
    }));
    Ok(())
}

#[test]
fn git_push_branch_defaults_remote_to_origin() -> Result<()> {
    let repo_path = "/tmp/odt-repo-push";
    let (service, _task_state, git_state) = build_service_with_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let summary = service.git_push_branch(repo_path, Some("   "), "feature/x", true, false)?;
    assert_eq!(summary.remote, "origin");
    assert_eq!(summary.branch, "feature/x");

    let git_state = git_state.lock().expect("git lock poisoned");
    assert!(git_state.calls.contains(&GitCall::PushBranch {
        repo_path: repo_path.to_string(),
        remote: "origin".to_string(),
        branch: "feature/x".to_string(),
        set_upstream: true,
        force_with_lease: false,
    }));
    Ok(())
}

#[test]
fn task_update_rejects_direct_status_changes() {
    let repo_path = "/tmp/odt-repo-task-update";
    let (service, _task_state, _git_state) = build_service_with_state(
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
    let (service, task_state, _git_state) = build_service_with_state(
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
    let (service, task_state, _git_state) = build_service_with_state(
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
    let (service, _task_state, _git_state) = build_service_with_state(
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
    let (service, _task_state, _git_state) = build_service_with_state(
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
    let (service, _task_state, _git_state) = build_service_with_state(
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
    let (service, _task_state, _git_state) = build_service_with_state(
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
    let (service, task_state, _git_state) = build_service_with_state(
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
    let (service, task_state, _git_state) = build_service_with_state(
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
    let (service, task_state, _git_state) = build_service_with_state(
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
    let (service, task_state, _git_state) = build_service_with_state(
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
    let (service, task_state, _git_state) = build_service_with_state(
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
    let (service, _task_state, _git_state) = build_service_with_state(
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
    let (service, task_state, _git_state) = build_service_with_state(
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
    let (service, _task_state, _git_state) = build_service_with_state(
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
    let (service, task_state, _git_state) = build_service_with_state(
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
    let (service, _task_state, _git_state) = build_service_with_state(
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
    let (service, task_state, _git_state) = build_service_with_state(
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
    let (service, task_state, _git_state) = build_service_with_state(
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
    let (service, _task_state, _git_state) = build_service_with_state(
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

    let (service, task_state, _git_state) = build_service_with_state(
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

    let (service, task_state, _git_state) = build_service_with_state(
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

    let (service, task_state, _git_state) = build_service_with_state(
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
    let (service, task_state, _git_state) = build_service_with_state(
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
    let (service, _task_state, _git_state) = build_service_with_state(
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
    let (service, task_state, _git_state) = build_service_with_state(
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
    let (service, task_state, _git_state) = build_service_with_state(
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
    let (service, task_state, _git_state) = build_service_with_state(
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
    let (service, task_state, _git_state) = build_service_with_state(
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
        },
        config_store,
    );

    let repo_path = repo.to_string_lossy().to_string();
    let runtime = service.runtime_check()?;
    assert!(runtime.git_ok);
    assert!(runtime.opencode_ok);
    assert!(runtime
        .opencode_version
        .as_deref()
        .unwrap_or_default()
        .contains("opencode-fake"));

    let beads = service.beads_check(repo_path.as_str())?;
    assert!(beads.beads_ok);
    assert!(beads.beads_path.is_some());

    let system = service.system_check(repo_path.as_str())?;
    assert!(system.git_ok);
    assert!(system.beads_ok);
    assert!(system.opencode_ok);
    assert!(system.errors.is_empty());

    let workspace = service.workspace_add(repo_path.as_str())?;
    assert!(workspace.is_active);
    let selected = service.workspace_select(repo_path.as_str())?;
    assert!(selected.is_active);

    let worktree_base = root.join("worktrees").to_string_lossy().to_string();
    let updated = service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.clone()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: false,
            hooks: HookSet::default(),
            agent_defaults: Default::default(),
        },
    )?;
    assert!(updated.has_config);

    let config = service.workspace_get_repo_config(repo_path.as_str())?;
    assert_eq!(config.branch_prefix, "odt");
    assert_eq!(
        config.worktree_base_path.as_deref(),
        Some(worktree_base.as_str())
    );
    assert!(service
        .workspace_get_repo_config_optional(repo_path.as_str())?
        .is_some());
    let trusted = service.workspace_set_trusted_hooks(repo_path.as_str(), true)?;
    assert!(trusted.has_config);

    let records = service.workspace_list()?;
    assert_eq!(records.len(), 1);
    assert!(records[0].is_active);

    let state = task_state.lock().expect("task lock poisoned");
    assert!(!state.ensure_calls.is_empty());
    drop(state);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn beads_check_reports_task_store_init_error() -> Result<()> {
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
        },
        config_store,
    );
    task_state.lock().expect("task lock poisoned").ensure_error = Some("init failed".to_string());

    let repo_path = repo.to_string_lossy().to_string();
    let check = service.beads_check(repo_path.as_str())?;
    assert!(!check.beads_ok);
    let beads_error = check.beads_error.unwrap_or_default();
    assert!(
        beads_error.contains("Failed to initialize task store"),
        "unexpected beads error: {beads_error}"
    );
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn beads_and_system_checks_report_missing_bd_binary() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("beads-missing-binary");
    let _path_guard = set_env_var("PATH", "/usr/bin:/bin");

    let (service, _task_state, _git_state) = build_service_with_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let beads = service.beads_check("/tmp/does-not-matter")?;
    assert!(!beads.beads_ok);
    assert!(beads.beads_path.is_none());
    assert!(beads
        .beads_error
        .as_deref()
        .unwrap_or_default()
        .contains("bd not found in PATH"));

    let system = service.system_check("/tmp/does-not-matter")?;
    assert!(system
        .errors
        .iter()
        .any(|entry| entry.contains("beads: bd not found in PATH")));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_workspace_runtime_ensure_list_and_stop_flow() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-workspace-flow");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        fake_opencode.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );

    let repo_path = repo.to_string_lossy().to_string();
    let first = service.opencode_repo_runtime_ensure(repo_path.as_str())?;
    let second = service.opencode_repo_runtime_ensure(repo_path.as_str())?;
    assert_eq!(first.runtime_id, second.runtime_id);

    let listed = service.opencode_runtime_list(Some(repo_path.as_str()))?;
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].runtime_id, first.runtime_id);

    assert!(service.opencode_runtime_stop(first.runtime_id.as_str())?);
    assert!(service
        .opencode_runtime_list(Some(repo_path.as_str()))?
        .is_empty());
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_workspace_runtime_ensure_stops_spawned_child_when_post_start_prune_fails() -> Result<()>
{
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-workspace-prune-failure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let pid_file = root.join("spawned-runtime.pid");
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        fake_opencode.to_string_lossy().as_ref(),
    );
    let _delay_guard = set_env_var("OPENDUCKTOR_TEST_STARTUP_DELAY_MS", "600");
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
        },
        config_store,
    );
    let stale_child = Command::new("/bin/sh")
        .arg("-lc")
        .arg("sleep 0.2")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn stale child");
    service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .insert(
            "runtime-stale-prune-failure-window".to_string(),
            AgentRuntimeProcess {
                summary: AgentRuntimeSummary {
                    runtime_id: "runtime-stale-prune-failure-window".to_string(),
                    repo_path: "/tmp/other-repo-for-prune".to_string(),
                    task_id: "task-1".to_string(),
                    role: "spec".to_string(),
                    working_directory: "/tmp/other-repo-for-prune".to_string(),
                    port: 1,
                    started_at: "2026-02-20T12:00:00Z".to_string(),
                },
                child: stale_child,
                _opencode_process_guard: None,
                cleanup_repo_path: Some(
                    "/tmp/non-existent-repo-for-ensure-post-start-prune".to_string(),
                ),
                cleanup_worktree_path: Some(
                    "/tmp/non-existent-worktree-for-ensure-post-start-prune".to_string(),
                ),
            },
        );

    let repo_path = repo.to_string_lossy().to_string();
    let error = service
        .opencode_repo_runtime_ensure(repo_path.as_str())
        .expect_err("post-start prune failure should bubble up");
    let message = error.to_string();
    assert!(message.contains("Failed pruning stale runtimes while finalizing workspace runtime"));
    assert!(wait_for_path_exists(
        pid_file.as_path(),
        Duration::from_secs(2)
    ));
    let spawned_pid = fs::read_to_string(pid_file.as_path())?
        .trim()
        .parse::<i32>()
        .expect("spawned runtime pid should parse as i32");
    assert!(wait_for_process_exit(spawned_pid, Duration::from_secs(2)));
    assert!(service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .is_empty());

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_runtime_start_supports_spec_and_qa_roles() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-start");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        fake_opencode.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("qa-worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            hooks: HookSet::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let spec_runtime = service.opencode_runtime_start(repo_path.as_str(), "task-1", "spec")?;
    assert_eq!(spec_runtime.role, "spec");
    assert!(service.opencode_runtime_stop(spec_runtime.runtime_id.as_str())?);

    let qa_runtime = service.opencode_runtime_start(repo_path.as_str(), "task-1", "qa")?;
    assert_eq!(qa_runtime.role, "qa");
    let qa_worktree = PathBuf::from(qa_runtime.working_directory.clone());
    assert!(qa_worktree.exists());
    assert!(service.opencode_runtime_stop(qa_runtime.runtime_id.as_str())?);
    assert!(!qa_worktree.exists());

    let bad_role = service
        .opencode_runtime_start(repo_path.as_str(), "task-1", "build")
        .expect_err("unsupported role should fail");
    assert!(bad_role
        .to_string()
        .contains("Unsupported agent runtime role"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_runtime_start_reports_missing_task() -> Result<()> {
    let root = unique_temp_path("runtime-missing-task");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );

    let repo_path = repo.to_string_lossy().to_string();
    let error = service
        .opencode_runtime_start(repo_path.as_str(), "missing-task", "spec")
        .expect_err("missing task should fail");
    assert!(error.to_string().contains("Task not found: missing-task"));
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_runtime_start_qa_validates_config_and_existing_worktree_path() -> Result<()> {
    let root = unique_temp_path("runtime-qa-guards");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("qa-worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );

    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: None,
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            hooks: HookSet::default(),
            agent_defaults: Default::default(),
        },
    )?;
    let missing_base_error = service
        .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
        .expect_err("qa runtime should require worktree base path");
    assert!(missing_base_error
        .to_string()
        .contains("QA blocked: configure repos."));

    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: false,
            hooks: HookSet {
                pre_start: vec!["echo pre-hook".to_string()],
                post_complete: Vec::new(),
            },
            agent_defaults: Default::default(),
        },
    )?;
    let trust_error = service
        .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
        .expect_err("qa runtime should reject untrusted hooks");
    assert!(trust_error
        .to_string()
        .contains("Hooks are configured but not trusted"));

    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            hooks: HookSet::default(),
            agent_defaults: Default::default(),
        },
    )?;
    fs::create_dir_all(worktree_base.join("qa-task-1"))?;
    let existing_path_error = service
        .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
        .expect_err("existing qa worktree should fail");
    assert!(existing_path_error
        .to_string()
        .contains("QA worktree path already exists"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_runtime_start_surfaces_qa_pre_start_cleanup_failure() -> Result<()> {
    let root = unique_temp_path("runtime-pre-start-cleanup-failure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("qa-worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );

    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            hooks: HookSet {
                pre_start: vec![format!("rm -rf \"{repo_path}\"; exit 1")],
                post_complete: Vec::new(),
            },
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
        .expect_err("cleanup failure should be surfaced when pre-start hook fails");
    let message = error.to_string();
    assert!(message.contains("QA pre-start hook failed"));
    assert!(message.contains("Failed removing QA worktree runtime"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_runtime_start_surfaces_cleanup_failure_after_startup_error() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-startup-cleanup-failure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let failing_opencode = root.join("opencode");
    create_failing_opencode_with_worktree_cleanup(&failing_opencode)?;
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        failing_opencode.to_string_lossy().as_ref(),
    );
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("qa-worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            hooks: HookSet::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .opencode_runtime_start(repo_path.as_str(), "task-1", "qa")
        .expect_err("startup cleanup failure should be surfaced");
    let message = error.to_string();
    assert!(message.contains("OpenCode runtime failed to start for task task-1"));
    assert!(message.contains("Failed removing QA worktree runtime"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_runtime_start_reuses_existing_runtime_for_same_task_and_role() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("runtime-reuse");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        fake_opencode.to_string_lossy().as_ref(),
    );
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "task", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );
    let repo_path = repo.to_string_lossy().to_string();

    let first = service.opencode_runtime_start(repo_path.as_str(), "task-1", "spec")?;
    let second = service.opencode_runtime_start(repo_path.as_str(), "task-1", "spec")?;
    assert_eq!(first.runtime_id, second.runtime_id);
    assert!(service.opencode_runtime_stop(first.runtime_id.as_str())?);
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_runtime_stop_reports_cleanup_failure() -> Result<()> {
    let (service, _task_state, _git_state) = build_service_with_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let runtime_id = "runtime-cleanup-error".to_string();
    service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .insert(
            runtime_id.clone(),
            AgentRuntimeProcess {
                summary: AgentRuntimeSummary {
                    runtime_id: runtime_id.clone(),
                    repo_path: "/tmp/repo".to_string(),
                    task_id: "task-1".to_string(),
                    role: "qa".to_string(),
                    working_directory: "/tmp/repo".to_string(),
                    port: 1,
                    started_at: "2026-02-20T12:00:00Z".to_string(),
                },
                child: spawn_sleep_process(20),
                _opencode_process_guard: None,
                cleanup_repo_path: Some("/tmp/non-existent-repo-for-stop".to_string()),
                cleanup_worktree_path: Some("/tmp/non-existent-worktree-for-stop".to_string()),
            },
        );

    let error = service
        .opencode_runtime_stop(runtime_id.as_str())
        .expect_err("cleanup failure should bubble up");
    assert!(error
        .to_string()
        .contains("Failed removing QA worktree runtime"));
    assert!(service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .is_empty());
    Ok(())
}

#[test]
fn opencode_runtime_list_prunes_stale_entries() -> Result<()> {
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
    let summary = AgentRuntimeSummary {
        runtime_id: "runtime-stale".to_string(),
        repo_path: repo.to_string_lossy().to_string(),
        task_id: "task-1".to_string(),
        role: "spec".to_string(),
        working_directory: repo.to_string_lossy().to_string(),
        port: 1,
        started_at: "2026-02-20T12:00:00Z".to_string(),
    };
    service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .insert(
            summary.runtime_id.clone(),
            AgentRuntimeProcess {
                summary,
                child: stale_child,
                _opencode_process_guard: None,
                cleanup_repo_path: None,
                cleanup_worktree_path: None,
            },
        );

    let listed = service.opencode_runtime_list(None)?;
    assert!(listed.is_empty());

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn opencode_runtime_list_surfaces_stale_cleanup_failure() -> Result<()> {
    let root = unique_temp_path("runtime-prune-cleanup-failure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
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
    let summary = AgentRuntimeSummary {
        runtime_id: "runtime-stale-cleanup-error".to_string(),
        repo_path: repo.to_string_lossy().to_string(),
        task_id: "task-1".to_string(),
        role: "qa".to_string(),
        working_directory: repo.to_string_lossy().to_string(),
        port: 1,
        started_at: "2026-02-20T12:00:00Z".to_string(),
    };
    service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .insert(
            summary.runtime_id.clone(),
            AgentRuntimeProcess {
                summary,
                child: stale_child,
                _opencode_process_guard: None,
                cleanup_repo_path: Some("/tmp/non-existent-repo-for-prune".to_string()),
                cleanup_worktree_path: Some("/tmp/non-existent-worktree-for-prune".to_string()),
            },
        );

    let error = service
        .opencode_runtime_list(None)
        .expect_err("stale runtime cleanup failure should be surfaced");
    let message = error.to_string();
    assert!(message.contains("Failed pruning stale agent runtimes"));
    assert!(message.contains("Failed removing QA worktree runtime"));
    assert!(service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .is_empty());

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_respond_and_cleanup_success_flow() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-success");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        fake_opencode.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("builder-worktrees");
    let (service, task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            hooks: HookSet::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
    let emitter = make_emitter(events.clone());

    let run = service.build_start(repo_path.as_str(), "task-1", emitter.clone())?;
    assert!(matches!(run.state, RunState::Running));
    assert_eq!(service.runs_list(Some(repo_path.as_str()))?.len(), 1);

    std::thread::sleep(Duration::from_millis(200));
    assert!(service.build_respond(
        run.run_id.as_str(),
        BuildResponseAction::Approve,
        Some("Allow git push"),
        emitter.clone()
    )?);

    assert!(service.build_cleanup(run.run_id.as_str(), CleanupMode::Success, emitter.clone())?);
    assert!(service.runs_list(Some(repo_path.as_str()))?.is_empty());

    let state = task_state.lock().expect("task lock poisoned");
    assert!(state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::InProgress)));
    assert!(state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::AiReview)));
    drop(state);

    let emitted = events.lock().expect("events lock poisoned");
    assert!(emitted
        .iter()
        .any(|event| matches!(event, RunEvent::RunStarted { .. })));
    assert!(emitted
        .iter()
        .any(|event| matches!(event, RunEvent::PermissionRequired { .. })));
    assert!(emitted
        .iter()
        .any(|event| matches!(event, RunEvent::ToolExecution { .. })));
    assert!(emitted
        .iter()
        .any(|event| matches!(event, RunEvent::RunFinished { success: true, .. })));
    drop(emitted);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_stop_respond_and_cleanup_failure_paths() -> Result<()> {
    let root = unique_temp_path("build-failure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let (service, task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::InProgress)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );

    let run_id = "run-local".to_string();
    service.runs.lock().expect("run lock poisoned").insert(
        run_id.clone(),
        RunProcess {
            summary: RunSummary {
                run_id: run_id.clone(),
                repo_path: repo_path.clone(),
                task_id: "task-1".to_string(),
                branch: "odt/task-1".to_string(),
                worktree_path: repo_path.clone(),
                port: 1,
                state: RunState::Running,
                last_message: None,
                started_at: "2026-02-20T12:00:00Z".to_string(),
            },
            child: spawn_sleep_process(20),
            _opencode_process_guard: None,
            repo_path: repo_path.clone(),
            task_id: "task-1".to_string(),
            worktree_path: repo_path.clone(),
            repo_config: RepoConfig {
                worktree_base_path: None,
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
                agent_defaults: Default::default(),
            },
        },
    );

    let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
    let emitter = make_emitter(events.clone());
    assert!(service.build_respond(
        run_id.as_str(),
        BuildResponseAction::Message,
        Some("note"),
        emitter.clone()
    )?);
    assert!(service.build_respond(
        run_id.as_str(),
        BuildResponseAction::Deny,
        None,
        emitter.clone()
    )?);

    assert!(service.build_stop(run_id.as_str(), emitter.clone())?);
    assert!(service.build_cleanup(run_id.as_str(), CleanupMode::Failure, emitter.clone())?);
    assert!(service.runs_list(Some(repo_path.as_str()))?.is_empty());

    let state = task_state.lock().expect("task lock poisoned");
    assert!(state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::Blocked)));
    drop(state);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_and_cleanup_cover_hook_failure_paths() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-hooks");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let fake_opencode = root.join("opencode");
    create_fake_opencode(&fake_opencode)?;
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        fake_opencode.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("hook-worktrees");
    let (service, task_state, _git_state) = build_service_with_store(
        vec![
            make_task("task-1", "bug", TaskStatus::Open),
            make_task("task-2", "bug", TaskStatus::Open),
        ],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );

    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            hooks: HookSet {
                pre_start: vec!["echo pre-fail >&2; exit 1".to_string()],
                post_complete: Vec::new(),
            },
            agent_defaults: Default::default(),
        },
    )?;

    let pre_start_error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("pre-start failure should fail");
    assert!(pre_start_error
        .to_string()
        .contains("Pre-start hook failed"));

    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            hooks: HookSet {
                pre_start: Vec::new(),
                post_complete: vec!["echo post-fail >&2; exit 1".to_string()],
            },
            agent_defaults: Default::default(),
        },
    )?;

    let events = Arc::new(Mutex::new(Vec::<RunEvent>::new()));
    let emitter = make_emitter(events.clone());
    let run = service.build_start(repo_path.as_str(), "task-2", emitter.clone())?;
    let cleaned =
        service.build_cleanup(run.run_id.as_str(), CleanupMode::Success, emitter.clone())?;
    assert!(!cleaned, "post-hook failure should report false");

    let invalid_mode = service
        .build_cleanup("run-missing", CleanupMode::Success, emitter)
        .expect_err("unknown mode should fail");
    assert!(invalid_mode.to_string().contains("Run not found"));

    let state = task_state.lock().expect("task lock poisoned");
    assert!(state
        .updated_patches
        .iter()
        .any(|(_, patch)| patch.status == Some(TaskStatus::Blocked)));
    drop(state);

    let emitted = events.lock().expect("events lock poisoned");
    assert!(emitted
        .iter()
        .any(|event| matches!(event, RunEvent::PostHookStarted { .. })));
    assert!(emitted
        .iter()
        .any(|event| matches!(event, RunEvent::PostHookFailed { .. })));
    drop(emitted);

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_requires_worktree_base_path() -> Result<()> {
    let root = unique_temp_path("build-no-worktree-base");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: None,
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            hooks: HookSet::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("build_start should require worktree base");
    assert!(error
        .to_string()
        .contains("Build blocked: configure repos."));
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_rejects_untrusted_hooks_configuration() -> Result<()> {
    let root = unique_temp_path("build-untrusted-hooks");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: false,
            hooks: HookSet {
                pre_start: vec!["echo pre-hook".to_string()],
                post_complete: Vec::new(),
            },
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("hooks should be rejected when not trusted");
    assert!(error
        .to_string()
        .contains("Hooks are configured but not trusted"));
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_rejects_existing_worktree_directory() -> Result<()> {
    let root = unique_temp_path("build-existing-worktree");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("worktrees");
    let task_worktree = worktree_base.join("task-1");
    fs::create_dir_all(&task_worktree)?;

    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            hooks: HookSet::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("existing worktree path should be rejected");
    assert!(error
        .to_string()
        .contains("Worktree path already exists for task task-1"));
    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn build_start_reports_opencode_startup_failure() -> Result<()> {
    let _env_lock = lock_env();
    let root = unique_temp_path("build-startup-failure");
    let repo = root.join("repo");
    init_git_repo(&repo)?;
    let failing_opencode = root.join("opencode");
    create_failing_opencode(&failing_opencode)?;
    let _opencode_guard = set_env_var(
        "OPENDUCKTOR_OPENCODE_BINARY",
        failing_opencode.to_string_lossy().as_ref(),
    );

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let repo_path = repo.to_string_lossy().to_string();
    let worktree_base = root.join("worktrees");
    let (service, _task_state, _git_state) = build_service_with_store(
        vec![make_task("task-1", "bug", TaskStatus::Open)],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );
    service.workspace_update_repo_config(
        repo_path.as_str(),
        RepoConfig {
            worktree_base_path: Some(worktree_base.to_string_lossy().to_string()),
            branch_prefix: "odt".to_string(),
            trusted_hooks: true,
            hooks: HookSet::default(),
            agent_defaults: Default::default(),
        },
    )?;

    let error = service
        .build_start(
            repo_path.as_str(),
            "task-1",
            make_emitter(Arc::new(Mutex::new(Vec::new()))),
        )
        .expect_err("startup failure should bubble up");
    let message = error.to_string();
    assert!(message.contains("OpenCode build runtime failed to start"));

    let _ = fs::remove_dir_all(root);
    Ok(())
}

#[test]
fn shutdown_reports_runtime_cleanup_errors_and_drains_state() -> Result<()> {
    let (service, _task_state, _git_state) = build_service_with_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let run_id = "run-shutdown".to_string();
    service.runs.lock().expect("run lock poisoned").insert(
        run_id.clone(),
        RunProcess {
            summary: RunSummary {
                run_id: run_id.clone(),
                repo_path: "/tmp/repo".to_string(),
                task_id: "task-1".to_string(),
                branch: "odt/task-1".to_string(),
                worktree_path: "/tmp/worktree".to_string(),
                port: 1,
                state: RunState::Running,
                last_message: None,
                started_at: "2026-02-20T12:00:00Z".to_string(),
            },
            child: spawn_sleep_process(20),
            _opencode_process_guard: None,
            repo_path: "/tmp/repo".to_string(),
            task_id: "task-1".to_string(),
            worktree_path: "/tmp/worktree".to_string(),
            repo_config: RepoConfig {
                worktree_base_path: None,
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
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
                summary: AgentRuntimeSummary {
                    runtime_id,
                    repo_path: "/tmp/repo".to_string(),
                    task_id: "task-1".to_string(),
                    role: "qa".to_string(),
                    working_directory: "/tmp/worktree".to_string(),
                    port: 1,
                    started_at: "2026-02-20T12:00:00Z".to_string(),
                },
                child: spawn_sleep_process(20),
                _opencode_process_guard: None,
                cleanup_repo_path: Some("/tmp/non-existent-repo-for-shutdown".to_string()),
                cleanup_worktree_path: Some("/tmp/non-existent-worktree-for-shutdown".to_string()),
            },
        );

    let error = service
        .shutdown()
        .expect_err("shutdown should aggregate runtime cleanup failures");
    assert!(error
        .to_string()
        .contains("Failed removing QA worktree runtime"));
    assert!(service.runs.lock().expect("run lock poisoned").is_empty());
    assert!(service
        .agent_runtimes
        .lock()
        .expect("runtime lock poisoned")
        .is_empty());
    Ok(())
}

#[test]
fn shutdown_terminates_pending_opencode_processes() -> Result<()> {
    let (service, _task_state, _git_state) = build_service_with_state(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
    );

    let root = unique_temp_path("shutdown-pending-opencode");
    let orphanable_opencode = root.join("opencode");
    create_orphanable_opencode(&orphanable_opencode)?;
    let mut pending_child = Command::new(orphanable_opencode.as_path())
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
    service
        .tracked_opencode_processes
        .lock()
        .expect("pending OpenCode process lock poisoned")
        .insert(pending_pid, 1);

    service.shutdown()?;

    let deadline = Instant::now() + Duration::from_secs(2);
    let mut exited = false;
    while Instant::now() < deadline {
        if pending_child.try_wait()?.is_some() {
            exited = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    if !exited {
        exited = pending_child.try_wait()?.is_some();
    }

    assert!(
        exited,
        "pending OpenCode process should have exited during shutdown"
    );
    assert!(service
        .tracked_opencode_processes
        .lock()
        .expect("pending OpenCode process lock poisoned")
        .is_empty());

    let _ = fs::remove_dir_all(root);
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
                repo_path: "/tmp/repo".to_string(),
                task_id: "task-1".to_string(),
                branch: "odt/task-1".to_string(),
                worktree_path: "/tmp/worktree".to_string(),
                port: 1,
                state: RunState::Running,
                last_message: None,
                started_at: "2026-02-20T12:00:00Z".to_string(),
            },
            child: run_child,
            _opencode_process_guard: None,
            repo_path: "/tmp/repo".to_string(),
            task_id: "task-1".to_string(),
            worktree_path: "/tmp/worktree".to_string(),
            repo_config: RepoConfig {
                worktree_base_path: None,
                branch_prefix: "odt".to_string(),
                trusted_hooks: true,
                hooks: HookSet::default(),
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
                summary: AgentRuntimeSummary {
                    runtime_id: "runtime-shutdown-registry-error".to_string(),
                    repo_path: "/tmp/repo".to_string(),
                    task_id: "task-1".to_string(),
                    role: "spec".to_string(),
                    working_directory: "/tmp/repo".to_string(),
                    port: 1,
                    started_at: "2026-02-20T12:00:00Z".to_string(),
                },
                child: runtime_child,
                _opencode_process_guard: None,
                cleanup_repo_path: None,
                cleanup_worktree_path: None,
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
    assert!(message.contains("Failed terminating pending OpenCode processes"));
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

#[test]
fn tracked_guard_drop_refcounts_prevent_pid_reuse_untracking() -> Result<()> {
    let root = unique_temp_path("guard-drop-refcount-pid-reuse");
    let registry_path = root.join(OPENCODE_PROCESS_REGISTRY_RELATIVE_PATH);
    let parent_pid = 70_001;
    let child_pid = 80_001;

    with_locked_opencode_process_registry(registry_path.as_path(), |instances| {
        instances.push(OpencodeProcessRegistryInstance::with_child(
            parent_pid, child_pid,
        ));
        Ok(())
    })?;

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
        instance.parent_pid == parent_pid && instance.child_pids.iter().any(|pid| *pid == child_pid)
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
    with_locked_opencode_process_registry(registry_path.as_path(), |instances| {
        instances.push(OpencodeProcessRegistryInstance::with_child(
            999_999, orphan_pid,
        ));
        Ok(())
    })?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (_service, _task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
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
    with_locked_opencode_process_registry(registry_path.as_path(), |instances| {
        instances.push(OpencodeProcessRegistryInstance::with_child(
            live_parent_pid,
            live_pid,
        ));
        Ok(())
    })?;

    let config_store = AppConfigStore::from_path(root.join("config.json"));
    let (_service, _task_state, _git_state) = build_service_with_store(
        vec![],
        vec![],
        GitCurrentBranch {
            name: Some("main".to_string()),
            detached: false,
        },
        config_store,
    );

    assert!(process_is_alive(live_pid as i32));
    let remaining = read_opencode_process_registry(registry_path.as_path())?;
    assert!(remaining.iter().any(|instance| {
        instance.parent_pid == live_parent_pid
            && instance.child_pids.iter().any(|entry| *entry == live_pid)
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
fn resolve_mcp_command_supports_cli_and_bun_fallback_modes() -> Result<()> {
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

    {
        let _workspace_guard = remove_env_var("OPENDUCKTOR_WORKSPACE_ROOT");
        let path = format!("{}:/usr/bin:/bin", cli_bin.to_string_lossy());
        let _path_guard = set_env_var("PATH", path.as_str());
        let command = resolve_mcp_command()?;
        assert_eq!(command, vec!["openducktor-mcp".to_string()]);
    }

    {
        let _workspace_guard = remove_env_var("OPENDUCKTOR_WORKSPACE_ROOT");
        let path = format!("{}:/usr/bin:/bin", empty_bin.to_string_lossy());
        let _path_guard = set_env_var("PATH", path.as_str());
        let error = resolve_mcp_command().expect_err("missing mcp + bun should fail");
        assert!(error.to_string().contains("Missing MCP runner"));
    }

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
        let path = format!("{}:/usr/bin:/bin", bun_bin.to_string_lossy());
        let _path_guard = set_env_var("PATH", path.as_str());
        let _workspace_guard = set_env_var(
            "OPENDUCKTOR_WORKSPACE_ROOT",
            workspace_direct.to_string_lossy().as_ref(),
        );
        let command = resolve_mcp_command()?;
        assert_eq!(
            command,
            vec![
                "bun".to_string(),
                direct_entrypoint.to_string_lossy().to_string()
            ]
        );
    }

    let workspace_filter = root.join("workspace-filter");
    fs::create_dir_all(&workspace_filter)?;
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
                "bun".to_string(),
                "run".to_string(),
                "--silent".to_string(),
                "--cwd".to_string(),
                workspace_filter.to_string_lossy().to_string(),
                "--filter".to_string(),
                "@openducktor/openducktor-mcp".to_string(),
                "start".to_string(),
            ]
        );
    }

    let _ = fs::remove_dir_all(root);
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
    let previous = std::env::var("OPENDUCKTOR_MCP_COMMAND_JSON").ok();
    std::env::set_var(
        "OPENDUCKTOR_MCP_COMMAND_JSON",
        r#"["/usr/local/bin/openducktor-mcp","--stdio"]"#,
    );

    let config = build_opencode_config_content(Path::new("/tmp/openducktor-repo"), "odt-ns")
        .expect("config should serialize");

    match previous {
        Some(value) => std::env::set_var("OPENDUCKTOR_MCP_COMMAND_JSON", value),
        None => std::env::remove_var("OPENDUCKTOR_MCP_COMMAND_JSON"),
    }

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
    assert_eq!(env["ODT_METADATA_NAMESPACE"].as_str(), Some("odt-ns"));
    assert!(env["ODT_BEADS_DIR"].as_str().is_some());
}
