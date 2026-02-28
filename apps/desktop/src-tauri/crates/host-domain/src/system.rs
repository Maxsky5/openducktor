use serde::{Deserialize, Serialize};

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
