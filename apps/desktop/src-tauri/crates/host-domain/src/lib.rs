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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskDocumentPresence {
    pub has: bool,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum QaWorkflowVerdict {
    Approved,
    Rejected,
    #[default]
    NotReviewed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskQaDocumentPresence {
    pub has: bool,
    pub updated_at: Option<String>,
    pub verdict: QaWorkflowVerdict,
}

impl Default for TaskQaDocumentPresence {
    fn default() -> Self {
        Self {
            has: false,
            updated_at: None,
            verdict: QaWorkflowVerdict::NotReviewed,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TaskDocumentSummary {
    pub spec: TaskDocumentPresence,
    pub plan: TaskDocumentPresence,
    pub qa_report: TaskQaDocumentPresence,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkflowState {
    pub required: bool,
    pub can_skip: bool,
    pub available: bool,
    pub completed: bool,
}

impl Default for AgentWorkflowState {
    fn default() -> Self {
        Self {
            required: false,
            can_skip: true,
            available: false,
            completed: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkflows {
    pub spec: AgentWorkflowState,
    pub planner: AgentWorkflowState,
    pub builder: AgentWorkflowState,
    pub qa: AgentWorkflowState,
}

impl Default for AgentWorkflows {
    fn default() -> Self {
        Self {
            spec: AgentWorkflowState::default(),
            planner: AgentWorkflowState::default(),
            builder: AgentWorkflowState {
                required: true,
                can_skip: false,
                available: false,
                completed: false,
            },
            qa: AgentWorkflowState::default(),
        }
    }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionModelSelection {
    pub provider_id: String,
    pub model_id: String,
    pub variant: Option<String>,
    pub opencode_agent: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionDocument {
    pub session_id: String,
    pub external_session_id: String,
    pub task_id: String,
    pub role: String,
    pub scenario: String,
    pub status: String,
    pub started_at: String,
    pub updated_at: String,
    pub ended_at: Option<String>,
    pub runtime_id: Option<String>,
    pub run_id: Option<String>,
    pub base_url: String,
    pub working_directory: String,
    pub selected_model: Option<AgentSessionModelSelection>,
}

/// Consolidated task metadata returned in a single CLI call.
/// Use this when fetching spec, plan, QA report, and sessions for the same task.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMetadata {
    pub spec: SpecDocument,
    pub plan: SpecDocument,
    pub qa_report: Option<QaReportDocument>,
    pub agent_sessions: Vec<AgentSessionDocument>,
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
    fn delete_task(&self, repo_path: &Path, task_id: &str, delete_subtasks: bool) -> Result<bool>;
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
    fn list_agent_sessions(&self, repo_path: &Path, task_id: &str)
        -> Result<Vec<AgentSessionDocument>>;
    fn upsert_agent_session(
        &self,
        repo_path: &Path,
        task_id: &str,
        session: AgentSessionDocument,
    ) -> Result<()>;
    /// Fetch all task metadata (spec, plan, QA report, sessions) in a single CLI call.
    /// Use this when you need multiple metadata fields for the same task to avoid
    /// redundant `bd show` invocations.
    fn get_task_metadata(&self, repo_path: &Path, task_id: &str) -> Result<TaskMetadata>;
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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitCurrentBranch {
    pub name: Option<String>,
    pub detached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeSummary {
    pub branch: String,
    pub worktree_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GitPushSummary {
    pub remote: String,
    pub branch: String,
    pub output: String,
}

pub trait GitPort: Send + Sync {
    fn get_branches(&self, repo_path: &Path) -> Result<Vec<GitBranch>>;
    fn get_current_branch(&self, repo_path: &Path) -> Result<GitCurrentBranch>;
    fn switch_branch(&self, repo_path: &Path, branch: &str, create: bool)
    -> Result<GitCurrentBranch>;
    fn create_worktree(
        &self,
        repo_path: &Path,
        worktree_path: &Path,
        branch: &str,
        create_branch: bool,
    ) -> Result<()>;
    fn remove_worktree(&self, repo_path: &Path, worktree_path: &Path, force: bool) -> Result<()>;
    fn push_branch(
        &self,
        repo_path: &Path,
        remote: &str,
        branch: &str,
        set_upstream: bool,
        force_with_lease: bool,
    ) -> Result<GitPushSummary>;
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
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeSummary {
    pub runtime_id: String,
    pub repo_path: String,
    pub task_id: String,
    pub role: String,
    pub working_directory: String,
    pub port: u16,
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
    use super::{now_rfc3339, IssueType, TaskStatus};

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

    #[test]
    fn issue_type_cli_roundtrip() {
        let issue_types = [
            IssueType::Task,
            IssueType::Feature,
            IssueType::Bug,
            IssueType::Epic,
        ];

        for issue_type in issue_types {
            let raw = issue_type.as_cli_value();
            let parsed = IssueType::from_cli_value(raw).expect("issue type should parse");
            assert_eq!(parsed, issue_type);
        }
    }

    #[test]
    fn issue_type_rejects_unknown_value() {
        assert!(IssueType::from_cli_value("event").is_none());
        assert!(IssueType::from_cli_value("").is_none());
    }

    #[test]
    fn now_rfc3339_returns_parseable_timestamp() {
        let timestamp = now_rfc3339();
        assert!(!timestamp.trim().is_empty());
        assert!(chrono::DateTime::parse_from_rfc3339(&timestamp).is_ok());
    }
}
