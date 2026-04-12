use crate::document::{AgentSessionDocument, AgentWorkflows, TaskDocumentSummary};
use crate::git::{GitConflict, GitTargetBranch, PullRequestRecord};
use serde::{Deserialize, Serialize};
use std::str::FromStr;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Open,
    SpecReady,
    ReadyForDev,
    InProgress,
    Blocked,
    AiReview,
    HumanReview,
    Deferred,
    Closed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IssueType {
    Task,
    Feature,
    Bug,
    Epic,
}

impl IssueType {
    pub fn as_str(&self) -> &'static str {
        match self {
            IssueType::Task => "task",
            IssueType::Feature => "feature",
            IssueType::Bug => "bug",
            IssueType::Epic => "epic",
        }
    }

    pub fn as_cli_value(&self) -> &'static str {
        self.as_str()
    }

    pub fn from_cli_value(value: &str) -> Option<Self> {
        value.parse().ok()
    }
}

impl FromStr for IssueType {
    type Err = String;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "task" => Ok(IssueType::Task),
            "feature" => Ok(IssueType::Feature),
            "bug" => Ok(IssueType::Bug),
            "epic" => Ok(IssueType::Epic),
            _ => Err(format!("Unsupported issue type: {value}")),
        }
    }
}

impl TaskStatus {
    pub fn as_cli_value(&self) -> &'static str {
        match self {
            TaskStatus::Open => "open",
            TaskStatus::SpecReady => "spec_ready",
            TaskStatus::ReadyForDev => "ready_for_dev",
            TaskStatus::InProgress => "in_progress",
            TaskStatus::Blocked => "blocked",
            TaskStatus::AiReview => "ai_review",
            TaskStatus::HumanReview => "human_review",
            TaskStatus::Deferred => "deferred",
            TaskStatus::Closed => "closed",
        }
    }

    pub fn from_cli_value(value: &str) -> Option<Self> {
        match value {
            "open" => Some(TaskStatus::Open),
            "spec_ready" => Some(TaskStatus::SpecReady),
            "ready_for_dev" => Some(TaskStatus::ReadyForDev),
            "in_progress" => Some(TaskStatus::InProgress),
            "blocked" => Some(TaskStatus::Blocked),
            "ai_review" => Some(TaskStatus::AiReview),
            "human_review" => Some(TaskStatus::HumanReview),
            "deferred" => Some(TaskStatus::Deferred),
            "closed" => Some(TaskStatus::Closed),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum TaskAction {
    ViewDetails,
    SetSpec,
    SetPlan,
    BuildStart,
    QaStart,
    OpenBuilder,
    OpenQa,
    ResetImplementation,
    ResetTask,
    DeferIssue,
    ResumeDeferred,
    HumanRequestChanges,
    HumanApprove,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCard {
    pub id: String,
    pub title: String,
    pub description: String,
    pub notes: String,
    pub status: TaskStatus,
    pub priority: i32,
    pub issue_type: IssueType,
    pub ai_review_enabled: bool,
    pub available_actions: Vec<TaskAction>,
    pub labels: Vec<String>,
    pub assignee: Option<String>,
    pub parent_id: Option<String>,
    pub subtask_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub agent_sessions: Vec<AgentSessionDocument>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_branch: Option<GitTargetBranch>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_branch_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pull_request: Option<PullRequestRecord>,
    pub document_summary: TaskDocumentSummary,
    pub agent_workflows: AgentWorkflows,
    pub updated_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum TaskDirectMergeResult {
    Completed { task: Box<TaskCard> },
    Conflicts { conflict: GitConflict },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub title: String,
    pub issue_type: IssueType,
    pub priority: i32,
    pub description: Option<String>,
    pub labels: Option<Vec<String>>,
    pub ai_review_enabled: Option<bool>,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSubtaskInput {
    pub title: String,
    pub issue_type: Option<IssueType>,
    pub priority: Option<i32>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskPatch {
    pub title: Option<String>,
    pub description: Option<String>,
    pub notes: Option<String>,
    pub status: Option<TaskStatus>,
    pub priority: Option<i32>,
    pub issue_type: Option<IssueType>,
    pub ai_review_enabled: Option<bool>,
    pub labels: Option<Vec<String>>,
    pub assignee: Option<String>,
    pub parent_id: Option<String>,
    pub target_branch: Option<GitTargetBranch>,
}

#[cfg(test)]
mod tests {
    use super::IssueType;
    use std::str::FromStr;

    #[test]
    fn issue_type_accepts_known_cli_values() {
        assert_eq!(IssueType::from_cli_value("task"), Some(IssueType::Task));
        assert_eq!(IssueType::from_str("feature"), Ok(IssueType::Feature));
    }

    #[test]
    fn issue_type_rejects_unknown_values() {
        assert_eq!(IssueType::from_cli_value("unknown"), None);
        assert_eq!(
            IssueType::from_str("unknown"),
            Err("Unsupported issue type: unknown".to_string())
        );
    }
}
