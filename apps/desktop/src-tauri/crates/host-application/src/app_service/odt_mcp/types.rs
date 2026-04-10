use host_domain::{IssueType, PullRequestRecord, QaWorkflowVerdict, TaskStatus};
use serde::{Deserialize, Serialize};

const fn default_search_limit() -> usize {
    50
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtPublicTask {
    pub id: String,
    pub title: String,
    pub description: String,
    pub status: TaskStatus,
    pub priority: i32,
    pub issue_type: IssueType,
    pub ai_review_enabled: bool,
    pub labels: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtTaskDocumentPresence {
    pub has_spec: bool,
    pub has_plan: bool,
    pub has_qa_report: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtTaskSummaryTask {
    #[serde(flatten)]
    pub task: OdtPublicTask,
    pub qa_verdict: QaWorkflowVerdict,
    pub documents: OdtTaskDocumentPresence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtTaskSummary {
    pub task: OdtTaskSummaryTask,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OdtRequestedDocuments {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spec: Option<OdtMarkdownDocument>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub implementation_plan: Option<OdtMarkdownDocument>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_qa_report: Option<OdtQaReportDocument>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtTaskDocumentsRead {
    pub documents: OdtRequestedDocuments,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtMarkdownDocument {
    pub markdown: String,
    pub updated_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtQaReportDocument {
    pub markdown: String,
    pub updated_at: Option<String>,
    pub verdict: QaWorkflowVerdict,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtPersistedDocument {
    pub markdown: String,
    pub updated_at: String,
    pub revision: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtSetSpecResult {
    pub task: OdtPublicTask,
    pub document: OdtPersistedDocument,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtSetPlanResult {
    pub task: OdtPublicTask,
    pub document: OdtPersistedDocument,
    pub created_subtask_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtBuildBlockedResult {
    pub task: OdtPublicTask,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtTaskResult {
    pub task: OdtPublicTask,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtBuildCompletedResult {
    pub task: OdtPublicTask,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtSetPullRequestResult {
    pub task: OdtPublicTask,
    pub pull_request: PullRequestRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtSearchTasksInput {
    pub priority: Option<i32>,
    pub issue_type: Option<IssueType>,
    pub status: Option<TaskStatus>,
    pub title: Option<String>,
    pub tags: Option<Vec<String>>,
    #[serde(default = "default_search_limit")]
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtSearchTasksResult {
    pub results: Vec<OdtTaskSummary>,
    pub limit: usize,
    pub total_count: usize,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtCreateTaskInput {
    pub title: String,
    pub issue_type: IssueType,
    pub priority: i32,
    pub description: Option<String>,
    pub labels: Option<Vec<String>>,
    pub ai_review_enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OdtHostBridgeReady {
    pub bridge_version: u8,
    pub repo_path: String,
    pub tool_names: Vec<String>,
}
