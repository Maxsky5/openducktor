use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Open,
    InProgress,
    Blocked,
    Closed,
}

impl TaskStatus {
    pub fn as_cli_value(&self) -> &'static str {
        match self {
            TaskStatus::Open => "open",
            TaskStatus::InProgress => "in_progress",
            TaskStatus::Blocked => "blocked",
            TaskStatus::Closed => "closed",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TaskPhase {
    Backlog,
    Specifying,
    ReadyForDev,
    InProgress,
    BlockedNeedsInput,
    Done,
}

impl TaskPhase {
    pub fn as_cli_value(&self) -> &'static str {
        match self {
            TaskPhase::Backlog => "backlog",
            TaskPhase::Specifying => "specifying",
            TaskPhase::ReadyForDev => "ready_for_dev",
            TaskPhase::InProgress => "in_progress",
            TaskPhase::BlockedNeedsInput => "blocked_needs_input",
            TaskPhase::Done => "done",
        }
    }

    pub fn from_label(labels: &[String]) -> Option<Self> {
        for label in labels {
            if !label.starts_with("phase:") {
                continue;
            }
            return match label.trim_start_matches("phase:") {
                "backlog" => Some(TaskPhase::Backlog),
                "specifying" => Some(TaskPhase::Specifying),
                "ready_for_dev" => Some(TaskPhase::ReadyForDev),
                "in_progress" => Some(TaskPhase::InProgress),
                "blocked_needs_input" => Some(TaskPhase::BlockedNeedsInput),
                "done" => Some(TaskPhase::Done),
                _ => None,
            };
        }
        None
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCard {
    pub id: String,
    pub title: String,
    pub description: String,
    pub design: String,
    pub acceptance_criteria: String,
    pub status: TaskStatus,
    pub phase: Option<TaskPhase>,
    pub priority: i32,
    pub issue_type: String,
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
    pub design: Option<String>,
    pub acceptance_criteria: Option<String>,
    pub labels: Option<Vec<String>>,
    pub status: Option<TaskStatus>,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTaskPatch {
    pub title: Option<String>,
    pub description: Option<String>,
    pub design: Option<String>,
    pub acceptance_criteria: Option<String>,
    pub status: Option<TaskStatus>,
    pub priority: Option<i32>,
    pub issue_type: Option<String>,
    pub labels: Option<Vec<String>>,
    pub assignee: Option<String>,
    pub parent_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecDocument {
    pub markdown: String,
    pub updated_at: String,
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
    fn set_phase(
        &self,
        repo_path: &Path,
        task_id: &str,
        phase: TaskPhase,
        reason: Option<&str>,
    ) -> Result<TaskCard>;
    fn get_spec_markdown(&self, repo_path: &Path, task_id: &str) -> Result<SpecDocument>;
    fn set_spec_markdown(
        &self,
        repo_path: &Path,
        task_id: &str,
        markdown: &str,
    ) -> Result<SpecDocument>;
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
