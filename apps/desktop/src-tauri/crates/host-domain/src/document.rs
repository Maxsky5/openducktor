use serde::{Deserialize, Serialize};

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variant: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "profileId",
        alias = "opencodeAgent"
    )]
    pub profile_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionDocument {
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scenario: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(default = "default_runtime_kind")]
    pub runtime_kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        rename = "runtimeEndpoint",
        alias = "baseUrl"
    )]
    pub runtime_endpoint: Option<String>,
    pub working_directory: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_model: Option<AgentSessionModelSelection>,
}

fn default_runtime_kind() -> String {
    "opencode".to_string()
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
