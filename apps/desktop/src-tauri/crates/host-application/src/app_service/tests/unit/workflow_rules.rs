use super::support::*;

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
        target_branch: None,
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
    assert!(can_set_spec_from_status(&TaskStatus::InProgress));
    assert!(can_set_spec_from_status(&TaskStatus::Blocked));
    assert!(can_set_spec_from_status(&TaskStatus::AiReview));
    assert!(can_set_spec_from_status(&TaskStatus::HumanReview));
    assert!(!can_set_spec_from_status(&TaskStatus::Deferred));
    assert!(!can_set_spec_from_status(&TaskStatus::Closed));

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
    let task_in_progress = make_task("task-progress", "task", TaskStatus::InProgress);
    let bug_blocked = make_task("bug-blocked", "bug", TaskStatus::Blocked);
    let epic_ai_review = make_task("epic-ai-review", "epic", TaskStatus::AiReview);
    let feature_human_review =
        make_task("feature-human-review", "feature", TaskStatus::HumanReview);
    let task_deferred = make_task("task-deferred", "task", TaskStatus::Deferred);
    let task_closed = make_task("task-closed", "task", TaskStatus::Closed);

    assert!(!can_set_plan(&epic_open));
    assert!(can_set_plan(&epic_spec_ready));
    assert!(can_set_plan(&epic_ready_for_dev));
    assert!(!can_set_plan(&feature_open));
    assert!(can_set_plan(&feature_ready_for_dev));
    assert!(can_set_plan(&task_open));
    assert!(can_set_plan(&task_ready_for_dev));
    assert!(can_set_plan(&bug_open));
    assert!(can_set_plan(&bug_ready_for_dev));
    assert!(can_set_plan(&feature_in_progress));
    assert!(can_set_plan(&task_in_progress));
    assert!(can_set_plan(&bug_blocked));
    assert!(can_set_plan(&epic_ai_review));
    assert!(can_set_plan(&feature_human_review));
    assert!(!can_set_plan(&task_deferred));
    assert!(!can_set_plan(&task_closed));
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
fn in_progress_tasks_expose_builder_action_and_document_revision_actions() {
    let task = make_task("task-1", "task", TaskStatus::InProgress);
    let actions = derive_available_actions(&task, std::slice::from_ref(&task));
    assert!(actions.contains(&TaskAction::OpenBuilder));
    assert!(actions.contains(&TaskAction::ResetImplementation));
    assert!(!actions.contains(&TaskAction::BuildStart));
    assert!(!actions.contains(&TaskAction::OpenQa));
    assert!(actions.contains(&TaskAction::SetSpec));
    assert!(actions.contains(&TaskAction::SetPlan));
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
fn blocked_tasks_expose_builder_and_reset_implementation_actions() {
    let task = make_task("task-1", "task", TaskStatus::Blocked);
    let actions = derive_available_actions(&task, std::slice::from_ref(&task));
    assert!(actions.contains(&TaskAction::OpenBuilder));
    assert!(actions.contains(&TaskAction::ResetImplementation));
    assert!(!actions.contains(&TaskAction::BuildStart));
}

#[test]
fn blocked_can_transition_to_ai_review_and_human_review() {
    let task = make_task("task-1", "task", TaskStatus::Blocked);
    assert!(allows_transition(
        &task,
        &TaskStatus::Blocked,
        &TaskStatus::AiReview
    ));
    assert!(allows_transition(
        &task,
        &TaskStatus::Blocked,
        &TaskStatus::HumanReview
    ));
}

#[test]
fn deferred_parent_task_exposes_resume_and_hides_defer() {
    let deferred = make_task("task-1", "task", TaskStatus::Deferred);
    let actions = derive_available_actions(&deferred, std::slice::from_ref(&deferred));
    assert!(actions.contains(&TaskAction::ResumeDeferred));
    assert!(!actions.contains(&TaskAction::DeferIssue));
}
