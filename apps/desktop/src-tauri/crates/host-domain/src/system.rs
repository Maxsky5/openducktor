use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealth {
    pub kind: String,
    pub ok: bool,
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepoStoreHealthCategory {
    Initializing,
    Healthy,
    MissingAttachment,
    MissingSharedDatabase,
    AttachmentContractInvalid,
    AttachmentVerificationFailed,
    SharedServerUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepoStoreHealthStatus {
    Initializing,
    Ready,
    Degraded,
    Blocking,
    RestoreNeeded,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RepoStoreSharedServerOwnershipState {
    OwnedByCurrentProcess,
    ReusedExistingServer,
    AdoptedOrphanedServer,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoStoreAttachmentHealth {
    pub path: Option<String>,
    pub database_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoStoreSharedServerHealth {
    pub host: Option<String>,
    pub port: Option<u16>,
    pub ownership_state: RepoStoreSharedServerOwnershipState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoStoreHealth {
    pub category: RepoStoreHealthCategory,
    pub status: RepoStoreHealthStatus,
    pub is_ready: bool,
    pub detail: Option<String>,
    pub attachment: RepoStoreAttachmentHealth,
    pub shared_server: RepoStoreSharedServerHealth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemCheck {
    pub git_ok: bool,
    pub git_version: Option<String>,
    pub gh_ok: bool,
    pub gh_version: Option<String>,
    pub gh_auth_ok: bool,
    pub gh_auth_login: Option<String>,
    pub gh_auth_error: Option<String>,
    pub runtimes: Vec<RuntimeHealth>,
    pub repo_store_health: RepoStoreHealth,
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
    pub gh_ok: bool,
    pub gh_version: Option<String>,
    pub gh_auth_ok: bool,
    pub gh_auth_login: Option<String>,
    pub gh_auth_error: Option<String>,
    pub runtimes: Vec<RuntimeHealth>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BeadsCheck {
    pub repo_store_health: RepoStoreHealth,
    pub beads_ok: bool,
    pub beads_path: Option<String>,
    pub beads_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRecord {
    pub workspace_id: String,
    pub workspace_name: String,
    pub repo_path: String,
    pub icon_data_url: Option<String>,
    pub is_active: bool,
    pub has_config: bool,
    pub configured_worktree_base_path: Option<String>,
    pub default_worktree_base_path: Option<String>,
    pub effective_worktree_base_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub is_git_repo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub current_path: String,
    pub current_path_is_git_repo: bool,
    pub parent_path: Option<String>,
    pub home_path: Option<String>,
    pub entries: Vec<DirectoryEntry>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum SystemOpenInToolId {
    Finder,
    Terminal,
    Iterm2,
    Ghostty,
    Vscode,
    Cursor,
    Zed,
    IntellijIdea,
    Webstorm,
    Pycharm,
    Phpstorm,
    Rider,
    Rustrover,
    AndroidStudio,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SystemOpenInToolInfo {
    pub tool_id: SystemOpenInToolId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon_data_url: Option<String>,
}
