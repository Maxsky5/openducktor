use anyhow::{anyhow, Result};
use host_domain::{
    CreateTaskInput, IssueType, PlanSubtaskInput, QaWorkflowVerdict, TaskAction, TaskCard,
    TaskStatus, UpdateTaskPatch,
};

use super::transitions::{
    allows_transition, can_set_plan, can_set_spec_from_status, default_qa_required_for_issue_type,
    is_open_state,
};

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
            task.issue_type.as_cli_value(),
            from.as_cli_value(),
            to.as_cli_value()
        ));
    }

    // Epic completion is blocked while any direct child is still active.
    if *to == TaskStatus::Closed && task.issue_type == IssueType::Epic {
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
    let parent_id = input
        .parent_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    if input.issue_type == IssueType::Epic && parent_id.is_some() {
        return Err(anyhow!("Epics cannot be created as subtasks."));
    }

    if let Some(parent_id) = parent_id {
        let parent = find_task(tasks, parent_id)?;
        if parent.issue_type != IssueType::Epic {
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
        .clone()
        .unwrap_or_else(|| current.issue_type.clone());

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

    if next_issue_type == IssueType::Epic && next_parent_id.is_some() {
        return Err(anyhow!("Epics cannot be converted to subtasks."));
    }

    let has_direct_subtasks = tasks
        .iter()
        .any(|task| task.parent_id.as_deref() == Some(current.id.as_str()));
    if has_direct_subtasks && next_parent_id.is_some() {
        return Err(anyhow!("Tasks with subtasks cannot become subtasks."));
    }

    if has_direct_subtasks && next_issue_type != IssueType::Epic {
        return Err(anyhow!("Only epics can have subtasks."));
    }

    if let Some(parent_id) = next_parent_id {
        let parent = find_task(tasks, parent_id)?;
        if parent.issue_type != IssueType::Epic {
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

fn is_qa_rejected_rework(task: &TaskCard) -> bool {
    matches!(task.status, TaskStatus::InProgress | TaskStatus::Blocked)
        && task.document_summary.qa_report.verdict == QaWorkflowVerdict::Rejected
}

pub(crate) fn derive_available_actions(task: &TaskCard, all_tasks: &[TaskCard]) -> Vec<TaskAction> {
    let mut actions = vec![TaskAction::ViewDetails];

    if can_set_spec_from_status(&task.status) {
        actions.push(TaskAction::SetSpec);
    }

    if can_set_plan(task) {
        actions.push(TaskAction::SetPlan);
    }

    if task.status == TaskStatus::AiReview {
        actions.push(TaskAction::QaStart);
    } else if is_qa_rejected_rework(task) {
        actions.push(TaskAction::BuildStart);
    } else if allows_transition(task, &task.status, &TaskStatus::InProgress) {
        actions.push(TaskAction::BuildStart);
    }

    if matches!(
        task.status,
        TaskStatus::InProgress | TaskStatus::Blocked | TaskStatus::AiReview | TaskStatus::HumanReview
    ) {
        actions.push(TaskAction::OpenBuilder);
    }

    if is_qa_rejected_rework(task) {
        actions.push(TaskAction::OpenQa);
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
    if task.issue_type != IssueType::Epic {
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

        let issue_type = entry.issue_type.unwrap_or(IssueType::Task);
        if issue_type == IssueType::Epic {
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
