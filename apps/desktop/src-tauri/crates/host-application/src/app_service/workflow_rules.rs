use anyhow::{anyhow, Result};
use host_domain::{
    AgentWorkflowState, AgentWorkflows, CreateTaskInput, PlanSubtaskInput, QaWorkflowVerdict,
    TaskAction, TaskCard, TaskStatus, UpdateTaskPatch,
};

pub(crate) fn normalize_issue_type(issue_type: &str) -> &'static str {
    match issue_type {
        "epic" => "epic",
        "feature" => "feature",
        "bug" => "bug",
        _ => "task",
    }
}

pub(crate) fn default_qa_required_for_issue_type(issue_type: &str) -> bool {
    matches!(
        normalize_issue_type(issue_type),
        "epic" | "feature" | "task" | "bug"
    )
}

pub(crate) fn is_open_state(status: &TaskStatus) -> bool {
    !matches!(status, TaskStatus::Closed | TaskStatus::Deferred)
}

fn can_skip_spec_and_planning(task: &TaskCard) -> bool {
    matches!(normalize_issue_type(&task.issue_type), "task" | "bug")
}

pub(crate) fn derive_agent_workflows(task: &TaskCard) -> AgentWorkflows {
    let issue_type = normalize_issue_type(&task.issue_type);
    let is_feature_epic = matches!(issue_type, "feature" | "epic");
    let is_task_bug = matches!(issue_type, "task" | "bug");
    let qa_required = task.ai_review_enabled;
    let is_closed = task.status == TaskStatus::Closed;
    let is_ready_for_dev_or_later = matches!(
        task.status,
        TaskStatus::ReadyForDev
            | TaskStatus::InProgress
            | TaskStatus::Blocked
            | TaskStatus::AiReview
            | TaskStatus::HumanReview
    );
    let is_planner_feature_epic_status = task.status == TaskStatus::SpecReady || is_ready_for_dev_or_later;

    let spec_required = is_feature_epic;
    let spec_can_skip = !spec_required;
    let spec_available = !is_closed;
    let spec_completed = task.document_summary.spec.has;

    let planner_required = is_feature_epic;
    let planner_can_skip = !planner_required;
    let planner_available = if is_closed {
        false
    } else if is_task_bug {
        true
    } else if is_feature_epic {
        is_planner_feature_epic_status
    } else {
        false
    };
    let planner_completed = task.document_summary.plan.has;

    let builder_available = if is_closed {
        false
    } else if is_task_bug {
        true
    } else if is_feature_epic {
        is_ready_for_dev_or_later
    } else {
        false
    };
    let builder_completed = matches!(
        task.status,
        TaskStatus::AiReview | TaskStatus::HumanReview | TaskStatus::Closed
    );

    let qa_available = if is_closed {
        false
    } else {
        task.status == TaskStatus::AiReview
    };
    let qa_completed = task.document_summary.qa_report.verdict == QaWorkflowVerdict::Approved;

    AgentWorkflows {
        spec: AgentWorkflowState {
            required: spec_required,
            can_skip: spec_can_skip,
            available: spec_available,
            completed: spec_completed,
        },
        planner: AgentWorkflowState {
            required: planner_required,
            can_skip: planner_can_skip,
            available: planner_available,
            completed: planner_completed,
        },
        builder: AgentWorkflowState {
            required: true,
            can_skip: false,
            available: builder_available,
            completed: builder_completed,
        },
        qa: AgentWorkflowState {
            required: qa_required,
            can_skip: !qa_required,
            available: qa_available,
            completed: qa_completed,
        },
    }
}

pub(crate) fn allows_transition(task: &TaskCard, from: &TaskStatus, to: &TaskStatus) -> bool {
    if from == to {
        return true;
    }

    match from {
        TaskStatus::Open => {
            if can_skip_spec_and_planning(task) {
                matches!(
                    to,
                    TaskStatus::SpecReady
                        | TaskStatus::ReadyForDev
                        | TaskStatus::InProgress
                        | TaskStatus::Deferred
                )
            } else {
                matches!(to, TaskStatus::SpecReady | TaskStatus::Deferred)
            }
        }
        TaskStatus::SpecReady => {
            if can_skip_spec_and_planning(task) {
                matches!(
                    to,
                    TaskStatus::ReadyForDev | TaskStatus::InProgress | TaskStatus::Deferred
                )
            } else {
                matches!(to, TaskStatus::ReadyForDev | TaskStatus::Deferred)
            }
        }
        TaskStatus::ReadyForDev => matches!(to, TaskStatus::InProgress | TaskStatus::Deferred),
        TaskStatus::InProgress => {
            matches!(
                to,
                TaskStatus::Blocked
                    | TaskStatus::AiReview
                    | TaskStatus::HumanReview
                    | TaskStatus::Deferred
            )
        }
        TaskStatus::Blocked => matches!(to, TaskStatus::InProgress | TaskStatus::Deferred),
        TaskStatus::AiReview => matches!(
            to,
            TaskStatus::InProgress | TaskStatus::HumanReview | TaskStatus::Deferred
        ),
        TaskStatus::HumanReview => matches!(
            to,
            TaskStatus::InProgress | TaskStatus::Closed | TaskStatus::Deferred
        ),
        TaskStatus::Deferred => matches!(to, TaskStatus::Open),
        TaskStatus::Closed => false,
    }
}

pub(crate) fn validate_transition(
    task: &TaskCard,
    all_tasks: &[TaskCard],
    from: &TaskStatus,
    to: &TaskStatus,
) -> Result<()> {
    if !allows_transition(task, from, to) {
        return Err(anyhow!(
            "Transition not allowed for {} ({}): {} -> {}",
            task.id,
            task.issue_type,
            from.as_cli_value(),
            to.as_cli_value()
        ));
    }

    if *to == TaskStatus::Closed && normalize_issue_type(&task.issue_type) == "epic" {
        let blocking_subtasks = all_tasks.iter().filter(|candidate| {
            candidate.parent_id.as_deref() == Some(task.id.as_str())
                && !matches!(candidate.status, TaskStatus::Closed | TaskStatus::Deferred)
        });

        if let Some(first_blocking) = blocking_subtasks.take(1).next() {
            return Err(anyhow!(
                "Epic cannot be completed while direct subtask {} is still active.",
                first_blocking.id
            ));
        }
    }

    Ok(())
}

fn find_task<'a>(tasks: &'a [TaskCard], task_id: &str) -> Result<&'a TaskCard> {
    tasks
        .iter()
        .find(|task| task.id == task_id)
        .ok_or_else(|| anyhow!("Task not found: {task_id}"))
}

pub(crate) fn validate_parent_relationships_for_create(
    tasks: &[TaskCard],
    input: &CreateTaskInput,
) -> Result<()> {
    let issue_type = normalize_issue_type(&input.issue_type);
    let parent_id = input
        .parent_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if issue_type == "epic" && parent_id.is_some() {
        return Err(anyhow!("Epics cannot be created as subtasks."));
    }

    if let Some(parent_id) = parent_id {
        let parent = find_task(tasks, parent_id)?;
        if normalize_issue_type(&parent.issue_type) != "epic" {
            return Err(anyhow!("Only epics can have subtasks."));
        }
        if parent.parent_id.is_some() {
            return Err(anyhow!("Subtask depth is limited to one level."));
        }
    }

    Ok(())
}

pub(crate) fn validate_parent_relationships_for_update(
    tasks: &[TaskCard],
    current: &TaskCard,
    patch: &UpdateTaskPatch,
) -> Result<()> {
    let next_issue_type = patch
        .issue_type
        .as_deref()
        .map(normalize_issue_type)
        .unwrap_or_else(|| normalize_issue_type(&current.issue_type));

    let next_parent_id = match patch.parent_id.as_deref() {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        }
        None => current.parent_id.as_deref(),
    };

    if next_issue_type == "epic" && next_parent_id.is_some() {
        return Err(anyhow!("Epics cannot be converted to subtasks."));
    }

    let has_direct_subtasks = tasks
        .iter()
        .any(|task| task.parent_id.as_deref() == Some(current.id.as_str()));
    if has_direct_subtasks && next_parent_id.is_some() {
        return Err(anyhow!("Tasks with subtasks cannot become subtasks."));
    }

    if has_direct_subtasks && next_issue_type != "epic" {
        return Err(anyhow!("Only epics can have subtasks."));
    }

    if let Some(parent_id) = next_parent_id {
        let parent = find_task(tasks, parent_id)?;
        if normalize_issue_type(&parent.issue_type) != "epic" {
            return Err(anyhow!("Only epics can be selected as parents."));
        }
        if parent.parent_id.is_some() {
            return Err(anyhow!("Subtask depth is limited to one level."));
        }
    }

    Ok(())
}

pub(crate) fn normalize_required_markdown(markdown: &str, document_label: &str) -> Result<String> {
    let trimmed = markdown.trim();
    if trimmed.is_empty() {
        return Err(anyhow!("{document_label} markdown cannot be empty."));
    }
    Ok(trimmed.to_string())
}

pub(crate) fn can_set_spec_from_status(status: &TaskStatus) -> bool {
    matches!(status, TaskStatus::Open | TaskStatus::SpecReady)
}

pub(crate) fn can_set_plan(task: &TaskCard) -> bool {
    let issue_type = normalize_issue_type(&task.issue_type);
    match issue_type {
        "epic" | "feature" => matches!(task.status, TaskStatus::SpecReady | TaskStatus::ReadyForDev),
        "task" | "bug" => matches!(
            task.status,
            TaskStatus::Open | TaskStatus::SpecReady | TaskStatus::ReadyForDev
        ),
        _ => false,
    }
}

pub(crate) fn can_replace_epic_subtask_status(status: &TaskStatus) -> bool {
    matches!(
        status,
        TaskStatus::Open | TaskStatus::SpecReady | TaskStatus::ReadyForDev
    )
}

pub(crate) fn derive_available_actions(task: &TaskCard, all_tasks: &[TaskCard]) -> Vec<TaskAction> {
    let mut actions = vec![TaskAction::ViewDetails];

    if can_set_spec_from_status(&task.status) {
        actions.push(TaskAction::SetSpec);
    }

    if can_set_plan(task) {
        actions.push(TaskAction::SetPlan);
    }

    if allows_transition(task, &task.status, &TaskStatus::InProgress) {
        actions.push(TaskAction::BuildStart);
    }

    if matches!(
        task.status,
        TaskStatus::InProgress | TaskStatus::Blocked | TaskStatus::HumanReview
    ) {
        actions.push(TaskAction::OpenBuilder);
    }

    if task.parent_id.is_none() {
        if task.status == TaskStatus::Deferred {
            actions.push(TaskAction::ResumeDeferred);
        } else if is_open_state(&task.status) {
            actions.push(TaskAction::DeferIssue);
        }
    }

    if task.status == TaskStatus::HumanReview {
        actions.push(TaskAction::HumanRequestChanges);
    }

    if validate_transition(task, all_tasks, &task.status, &TaskStatus::Closed).is_ok() {
        actions.push(TaskAction::HumanApprove);
    }

    actions
}

pub(crate) fn validate_plan_subtask_rules(
    task: &TaskCard,
    all_tasks: &[TaskCard],
    plan_subtasks: &[CreateTaskInput],
) -> Result<()> {
    let issue_type = normalize_issue_type(&task.issue_type);
    if issue_type != "epic" {
        if !plan_subtasks.is_empty() {
            return Err(anyhow!(
                "Only epics can receive subtask proposals during planning."
            ));
        }
        return Ok(());
    }

    let has_direct_subtasks = all_tasks
        .iter()
        .any(|entry| entry.parent_id.as_deref() == Some(task.id.as_str()));
    if !has_direct_subtasks && plan_subtasks.is_empty() {
        return Err(anyhow!(
            "Epic plans must provide at least one direct subtask proposal."
        ));
    }

    Ok(())
}

pub(crate) fn normalize_title_key(title: &str) -> String {
    title.trim().to_ascii_lowercase()
}

pub(crate) fn normalize_subtask_plan_inputs(
    inputs: Vec<PlanSubtaskInput>,
) -> Result<Vec<CreateTaskInput>> {
    let mut normalized = Vec::with_capacity(inputs.len());
    for entry in inputs {
        let title = entry.title.trim().to_string();
        if title.is_empty() {
            return Err(anyhow!("Subtask proposals require a non-empty title."));
        }

        let issue_type =
            normalize_issue_type(entry.issue_type.as_deref().unwrap_or("task")).to_string();
        if issue_type == "epic" {
            return Err(anyhow!(
                "Epic subtasks are not allowed. Subtask hierarchy depth is limited to one level."
            ));
        }

        let priority = entry.priority.unwrap_or(2).clamp(0, 4);
        let description = entry.description.and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        });

        normalized.push(CreateTaskInput {
            title,
            issue_type: issue_type.clone(),
            priority,
            description,
            acceptance_criteria: None,
            labels: None,
            ai_review_enabled: Some(default_qa_required_for_issue_type(&issue_type)),
            parent_id: None,
        });
    }
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::{
        derive_agent_workflows, derive_available_actions, normalize_subtask_plan_inputs,
        normalize_title_key,
    };
    use crate::app_service::test_support::make_task;
    use host_domain::{PlanSubtaskInput, QaWorkflowVerdict, TaskAction, TaskStatus};

    #[test]
    fn module_normalize_title_key_is_case_insensitive_and_trimmed() {
        assert_eq!(normalize_title_key("  Build Runtime  "), "build runtime");
        assert_eq!(normalize_title_key("BUILD runtime"), "build runtime");
    }

    #[test]
    fn module_derive_available_actions_exposes_resume_for_deferred_task() {
        let deferred = make_task("task-1", "task", TaskStatus::Deferred);

        let actions = derive_available_actions(&deferred, &[deferred.clone()]);

        assert!(actions.contains(&TaskAction::ResumeDeferred));
    }

    #[test]
    fn module_normalize_subtask_plan_inputs_rejects_empty_title() {
        let inputs = vec![PlanSubtaskInput {
            title: "   ".to_string(),
            issue_type: None,
            priority: None,
            description: None,
        }];

        let error =
            normalize_subtask_plan_inputs(inputs).expect_err("empty title should be rejected");

        assert!(error.to_string().contains("title"));
    }

    #[test]
    fn module_derive_agent_workflows_spec_availability_is_false_only_when_closed() {
        let mut task = make_task("task-1", "feature", TaskStatus::Open);
        for status in [
            TaskStatus::Open,
            TaskStatus::SpecReady,
            TaskStatus::ReadyForDev,
            TaskStatus::InProgress,
            TaskStatus::Blocked,
            TaskStatus::AiReview,
            TaskStatus::HumanReview,
            TaskStatus::Deferred,
        ] {
            task.status = status;
            let workflows = derive_agent_workflows(&task);
            assert!(workflows.spec.available);
        }

        task.status = TaskStatus::Closed;
        let workflows = derive_agent_workflows(&task);
        assert!(!workflows.spec.available);
    }

    #[test]
    fn module_derive_agent_workflows_planner_and_builder_availability_matrix() {
        let mut task = make_task("task-1", "task", TaskStatus::Open);
        for status in [
            TaskStatus::Open,
            TaskStatus::SpecReady,
            TaskStatus::ReadyForDev,
            TaskStatus::InProgress,
            TaskStatus::Blocked,
            TaskStatus::AiReview,
            TaskStatus::HumanReview,
            TaskStatus::Deferred,
        ] {
            task.status = status;
            let workflows = derive_agent_workflows(&task);
            assert!(workflows.planner.available);
            assert!(workflows.builder.available);
        }
        task.status = TaskStatus::Closed;
        let workflows = derive_agent_workflows(&task);
        assert!(!workflows.planner.available);
        assert!(!workflows.builder.available);

        let mut feature = make_task("task-2", "feature", TaskStatus::Open);
        let feature_open = derive_agent_workflows(&feature);
        assert!(!feature_open.planner.available);
        assert!(!feature_open.builder.available);

        feature.status = TaskStatus::SpecReady;
        let feature_spec_ready = derive_agent_workflows(&feature);
        assert!(feature_spec_ready.planner.available);
        assert!(!feature_spec_ready.builder.available);

        feature.status = TaskStatus::ReadyForDev;
        let feature_ready_for_dev = derive_agent_workflows(&feature);
        assert!(feature_ready_for_dev.planner.available);
        assert!(feature_ready_for_dev.builder.available);

        feature.status = TaskStatus::HumanReview;
        let feature_human_review = derive_agent_workflows(&feature);
        assert!(feature_human_review.planner.available);
        assert!(feature_human_review.builder.available);

        feature.status = TaskStatus::Closed;
        let feature_closed = derive_agent_workflows(&feature);
        assert!(!feature_closed.planner.available);
        assert!(!feature_closed.builder.available);
    }

    #[test]
    fn module_derive_agent_workflows_qa_flags_and_completion_follow_payload() {
        let mut task = make_task("task-1", "task", TaskStatus::AiReview);
        task.ai_review_enabled = true;
        let required = derive_agent_workflows(&task);
        assert!(required.qa.required);
        assert!(!required.qa.can_skip);
        assert!(required.qa.available);
        assert!(!required.qa.completed);

        task.ai_review_enabled = false;
        let optional = derive_agent_workflows(&task);
        assert!(!optional.qa.required);
        assert!(optional.qa.can_skip);
        assert!(optional.qa.available);

        task.document_summary.qa_report.verdict = QaWorkflowVerdict::Rejected;
        let rejected = derive_agent_workflows(&task);
        assert!(!rejected.qa.completed);

        task.document_summary.qa_report.verdict = QaWorkflowVerdict::NotReviewed;
        let not_reviewed = derive_agent_workflows(&task);
        assert!(!not_reviewed.qa.completed);

        task.document_summary.qa_report.verdict = QaWorkflowVerdict::Approved;
        let approved = derive_agent_workflows(&task);
        assert!(approved.qa.completed);
    }

    #[test]
    fn module_derive_agent_workflows_closed_precedence_and_reopen_recompute() {
        let mut task = make_task("task-1", "feature", TaskStatus::InProgress);
        let open_state = derive_agent_workflows(&task);
        assert!(open_state.spec.available);
        assert!(open_state.planner.available);
        assert!(open_state.builder.available);
        assert!(!open_state.qa.available);

        task.status = TaskStatus::Closed;
        let closed_state = derive_agent_workflows(&task);
        assert!(!closed_state.spec.available);
        assert!(!closed_state.planner.available);
        assert!(!closed_state.builder.available);
        assert!(!closed_state.qa.available);

        task.status = TaskStatus::AiReview;
        let reopened = derive_agent_workflows(&task);
        assert!(reopened.spec.available);
        assert!(reopened.planner.available);
        assert!(reopened.builder.available);
        assert!(reopened.qa.available);
    }
}
