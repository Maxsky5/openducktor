use anyhow::{anyhow, Result};
use host_domain::{IssueType, TaskStatus};

const VALID_ISSUE_TYPES: &str = "task, feature, bug, epic";
const VALID_TASK_STATUSES: &str =
    "open, spec_ready, ready_for_dev, in_progress, blocked, ai_review, human_review, deferred, closed";

pub(crate) fn normalize_labels(labels: Vec<String>) -> Vec<String> {
    let mut normalized: Vec<String> = labels
        .into_iter()
        .map(|label| label.trim().to_string())
        .filter(|label| !label.is_empty())
        .collect();
    normalized.sort();
    normalized.dedup();
    normalized
}

pub(crate) fn normalize_text_option(value: Option<String>) -> Option<String> {
    value.and_then(|entry| {
        let trimmed = entry.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub(crate) fn parse_issue_type(task_id: &str, issue_type: &str) -> Result<IssueType> {
    IssueType::from_cli_value(issue_type).ok_or_else(|| {
        anyhow!(
            "Invalid Beads issue type for task {}: received {:?}. Expected one of: {}.",
            task_id,
            issue_type,
            VALID_ISSUE_TYPES
        )
    })
}

pub(crate) fn parse_task_status(task_id: &str, status: &str) -> Result<TaskStatus> {
    TaskStatus::from_cli_value(status).ok_or_else(|| {
        anyhow!(
            "Invalid Beads status for task {}: received {:?}. Expected one of: {}.",
            task_id,
            status,
            VALID_TASK_STATUSES
        )
    })
}

pub(crate) fn default_ai_review_enabled(issue_type: &IssueType) -> bool {
    matches!(
        issue_type,
        IssueType::Epic | IssueType::Feature | IssueType::Task | IssueType::Bug
    )
}
