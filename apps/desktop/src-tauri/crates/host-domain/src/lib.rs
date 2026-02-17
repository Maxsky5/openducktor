use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

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
    pub issue_type: String,
    pub ai_review_enabled: bool,
    pub available_actions: Vec<TaskAction>,
    pub labels: Vec<String>,
    pub assignee: Option<String>,
    pub parent_id: Option<String>,
    pub subtask_ids: Vec<String>,
    pub updated_at: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTaskInput {
    pub title: String,
    pub issue_type: String,
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
    pub issue_type: Option<String>,
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
    pub issue_type: Option<String>,
    pub ai_review_enabled: Option<bool>,
    pub labels: Option<Vec<String>>,
    pub assignee: Option<String>,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecDocument {
    pub markdown: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum QaVerdict {
    Approved,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QaReportDocument {
    pub markdown: String,
    pub verdict: QaVerdict,
    pub updated_at: String,
    pub revision: u32,
}

pub trait TaskStore: Send + Sync {
    fn ensure_repo_initialized(&self, repo_path: &Path) -> Result<()>;
    fn list_tasks(&self, repo_path: &Path) -> Result<Vec<TaskCard>>;
    fn create_task(&self, repo_path: &Path, input: CreateTaskInput) -> Result<TaskCard>;
    fn update_task(
        &self,
        repo_path: &Path,
        task_id: &str,
        patch: UpdateTaskPatch,
    ) -> Result<TaskCard>;
    fn get_spec(&self, repo_path: &Path, task_id: &str) -> Result<SpecDocument>;
    fn set_spec(&self, repo_path: &Path, task_id: &str, markdown: &str) -> Result<SpecDocument>;
    fn get_plan(&self, repo_path: &Path, task_id: &str) -> Result<SpecDocument>;
    fn set_plan(&self, repo_path: &Path, task_id: &str, markdown: &str) -> Result<SpecDocument>;
    fn get_latest_qa_report(
        &self,
        repo_path: &Path,
        task_id: &str,
    ) -> Result<Option<QaReportDocument>>;
    fn append_qa_report(
        &self,
        repo_path: &Path,
        task_id: &str,
        markdown: &str,
        verdict: QaVerdict,
    ) -> Result<QaReportDocument>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemCheck {
    pub git_ok: bool,
    pub git_version: Option<String>,
    pub opencode_ok: bool,
    pub opencode_version: Option<String>,
    pub beads_ok: bool,
    pub beads_path: Option<String>,
    pub beads_error: Option<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCheck {
    pub git_ok: bool,
    pub git_version: Option<String>,
    pub opencode_ok: bool,
    pub opencode_version: Option<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeadsCheck {
    pub beads_ok: bool,
    pub beads_path: Option<String>,
    pub beads_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub path: String,
    pub is_active: bool,
    pub has_config: bool,
    pub configured_worktree_base_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Starting,
    Running,
    Blocked,
    AwaitingDoneConfirmation,
    Completed,
    Failed,
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub run_id: String,
    pub repo_path: String,
    pub task_id: String,
    pub branch: String,
    pub worktree_path: String,
    pub port: u16,
    pub state: RunState,
    pub last_message: Option<String>,
    pub started_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
pub enum RunEvent {
    RunStarted {
        run_id: String,
        message: String,
        timestamp: String,
    },
    AgentThought {
        run_id: String,
        message: String,
        timestamp: String,
    },
    ToolExecution {
        run_id: String,
        message: String,
        timestamp: String,
    },
    PermissionRequired {
        run_id: String,
        message: String,
        command: Option<String>,
        timestamp: String,
    },
    PostHookStarted {
        run_id: String,
        message: String,
        timestamp: String,
    },
    PostHookFailed {
        run_id: String,
        message: String,
        timestamp: String,
    },
    ReadyForManualDoneConfirmation {
        run_id: String,
        message: String,
        timestamp: String,
    },
    RunFinished {
        run_id: String,
        message: String,
        timestamp: String,
        success: bool,
    },
    Error {
        run_id: String,
        message: String,
        timestamp: String,
    },
}

pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::TaskStatus;

    #[test]
    fn task_status_cli_roundtrip() {
        let statuses = [
            TaskStatus::Open,
            TaskStatus::SpecReady,
            TaskStatus::ReadyForDev,
            TaskStatus::InProgress,
            TaskStatus::Blocked,
            TaskStatus::AiReview,
            TaskStatus::HumanReview,
            TaskStatus::Deferred,
            TaskStatus::Closed,
        ];

        for status in statuses {
            let raw = status.as_cli_value();
            let parsed = TaskStatus::from_cli_value(raw).expect("status should parse");
            assert_eq!(parsed, status);
        }
    }

    #[test]
    fn task_status_rejects_unknown_value() {
        assert!(TaskStatus::from_cli_value("backlog").is_none());
        assert!(TaskStatus::from_cli_value("").is_none());
    }
}
