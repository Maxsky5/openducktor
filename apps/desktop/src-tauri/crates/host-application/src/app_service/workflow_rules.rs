use anyhow::{anyhow, Result};
use host_domain::{
    CreateTaskInput, PlanSubtaskInput, TaskAction, TaskCard, TaskStatus, UpdateTaskPatch,
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
    use super::{derive_available_actions, normalize_subtask_plan_inputs, normalize_title_key};
    use crate::app_service::test_support::make_task;
    use host_domain::{PlanSubtaskInput, TaskAction, TaskStatus};

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
}
