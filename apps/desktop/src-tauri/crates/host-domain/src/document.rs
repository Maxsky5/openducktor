use crate::git::{DirectMergeRecord, GitTargetBranch, PullRequestRecord};
use serde::{de::Error as DeError, Deserialize, Deserializer, Serialize, Serializer};

pub const ODT_SET_SPEC_SOURCE_TOOL: &str = "odt_set_spec";
pub const ODT_SET_PLAN_SOURCE_TOOL: &str = "odt_set_plan";
pub const ODT_QA_APPROVED_SOURCE_TOOL: &str = "odt_qa_approved";
pub const ODT_QA_REJECTED_SOURCE_TOOL: &str = "odt_qa_rejected";

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
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
    pub verdict: QaWorkflowVerdict,
    pub updated_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionModelSelection {
    pub runtime_kind: String,
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

#[derive(Debug, Clone)]
pub struct AgentSessionDocument {
    pub external_session_id: String,
    pub role: String,
    pub started_at: String,
    pub runtime_kind: String,
    pub working_directory: String,
    pub selected_model: Option<AgentSessionModelSelection>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentSessionDocumentSerde {
    external_session_id: String,
    role: String,
    started_at: String,
    runtime_kind: String,
    working_directory: String,
    #[serde(default)]
    selected_model: Option<AgentSessionModelSelection>,
}

impl Serialize for AgentSessionDocument {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        use serde::ser::SerializeStruct;
        let field_count = if self.selected_model.is_some() { 6 } else { 5 };
        let mut state = serializer.serialize_struct("AgentSessionDocument", field_count)?;
        state.serialize_field("externalSessionId", &self.external_session_id)?;
        state.serialize_field("role", &self.role)?;
        state.serialize_field("startedAt", &self.started_at)?;
        state.serialize_field("runtimeKind", &self.runtime_kind)?;
        state.serialize_field("workingDirectory", &self.working_directory)?;
        if let Some(selected_model) = &self.selected_model {
            state.serialize_field("selectedModel", selected_model)?;
        }
        state.end()
    }
}

impl<'de> Deserialize<'de> for AgentSessionDocument {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let input = AgentSessionDocumentSerde::deserialize(deserializer)?;
        let AgentSessionDocumentSerde {
            external_session_id,
            role,
            started_at,
            runtime_kind,
            working_directory,
            selected_model,
        } = input;

        let external_session_id = external_session_id.trim().to_string();
        if external_session_id.is_empty() {
            return Err(D::Error::custom(
                "Agent session externalSessionId is required",
            ));
        }

        Ok(Self {
            external_session_id,
            role,
            started_at,
            runtime_kind,
            working_directory,
            selected_model,
        })
    }
}

/// Consolidated task metadata returned in a single CLI call.
/// Use this when fetching spec, plan, QA report, and sessions for the same task.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskMetadata {
    pub spec: SpecDocument,
    pub plan: SpecDocument,
    pub target_branch: Option<GitTargetBranch>,
    pub qa_report: Option<QaReportDocument>,
    pub pull_request: Option<PullRequestRecord>,
    pub direct_merge: Option<DirectMergeRecord>,
    pub agent_sessions: Vec<AgentSessionDocument>,
}
