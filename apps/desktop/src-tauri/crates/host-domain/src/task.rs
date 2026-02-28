use crate::document::{AgentWorkflows, TaskDocumentSummary};
use serde::{Deserialize, Serialize};

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

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "task" => Some(IssueType::Task),
            "feature" => Some(IssueType::Feature),
            "bug" => Some(IssueType::Bug),
            "epic" => Some(IssueType::Epic),
            _ => None,
        }
    }

    pub fn as_cli_value(&self) -> &'static str {
        self.as_str()
    }

    pub fn from_cli_value(value: &str) -> Option<Self> {
        Self::from_str(value)
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
    OpenBuilder,
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
    pub acceptance_criteria: String,
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
    pub document_summary: TaskDocumentSummary,
    pub agent_workflows: AgentWorkflows,
    pub updated_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub title: String,
    pub issue_type: IssueType,
    pub priority: i32,
    pub description: Option<String>,
    pub acceptance_criteria: Option<String>,
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
    pub acceptance_criteria: Option<String>,
    pub notes: Option<String>,
    pub status: Option<TaskStatus>,
    pub priority: Option<i32>,
    pub issue_type: Option<IssueType>,
    pub ai_review_enabled: Option<bool>,
    pub labels: Option<Vec<String>>,
    pub assignee: Option<String>,
    pub parent_id: Option<String>,
}
