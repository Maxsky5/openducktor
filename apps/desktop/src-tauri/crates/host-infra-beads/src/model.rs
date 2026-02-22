use host_domain::QaVerdict;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub(crate) struct RawIssue {
    pub(crate) id: String,
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) description: String,
    #[serde(default)]
    pub(crate) acceptance_criteria: String,
    #[serde(default)]
    pub(crate) notes: String,
    pub(crate) status: String,
    #[serde(default)]
    pub(crate) priority: i32,
    #[serde(default)]
    pub(crate) issue_type: String,
    #[serde(default)]
    pub(crate) labels: Vec<String>,
    #[serde(default)]
    pub(crate) owner: Option<String>,
    #[serde(default)]
    pub(crate) parent: Option<String>,
    #[serde(default)]
    pub(crate) dependencies: Vec<RawDependency>,
    #[serde(default)]
    pub(crate) metadata: Option<Value>,
    pub(crate) updated_at: String,
    pub(crate) created_at: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawDependency {
    #[serde(rename = "type", alias = "dependency_type", default)]
    pub(crate) dependency_type: String,
    #[serde(default)]
    pub(crate) depends_on_id: Option<String>,
    #[serde(default)]
    pub(crate) id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MarkdownEntry {
    pub(crate) markdown: String,
    pub(crate) updated_at: String,
    pub(crate) updated_by: String,
    pub(crate) source_tool: String,
    pub(crate) revision: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct QaEntry {
    pub(crate) markdown: String,
    pub(crate) verdict: QaVerdict,
    pub(crate) updated_at: String,
    pub(crate) updated_by: String,
    pub(crate) source_tool: String,
    pub(crate) revision: u32,
}
