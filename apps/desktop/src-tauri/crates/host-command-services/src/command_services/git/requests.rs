use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoRequest {
    pub repo_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCurrentBranchRequest {
    pub repo_path: String,
    pub working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSwitchBranchRequest {
    pub repo_path: String,
    pub branch: String,
    pub create: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCreateWorktreeRequest {
    pub repo_path: String,
    pub worktree_path: String,
    pub branch: String,
    pub create_branch: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoveWorktreeRequest {
    pub repo_path: String,
    pub worktree_path: String,
    pub force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPushBranchRequest {
    pub repo_path: String,
    pub branch: String,
    pub working_dir: Option<String>,
    pub remote: Option<String>,
    pub set_upstream: Option<bool>,
    pub force_with_lease: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusRequest {
    pub repo_path: String,
    pub working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffRequest {
    pub repo_path: String,
    pub target_branch: Option<String>,
    pub working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitAheadBehindRequest {
    pub repo_path: String,
    pub target_branch: String,
    pub working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorktreeStatusRequest {
    pub repo_path: String,
    pub target_branch: String,
    pub diff_scope: Option<String>,
    pub working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitAllCommandRequest {
    pub repo_path: String,
    pub working_dir: Option<String>,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitResetWorktreeSelectionCommandRequest {
    pub repo_path: String,
    pub target_branch: String,
    pub snapshot: host_domain::GitResetSnapshot,
    pub selection: host_domain::GitResetWorktreeSelection,
    pub working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFetchRemoteRequest {
    pub repo_path: String,
    pub target_branch: String,
    pub working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitPullBranchRequest {
    pub repo_path: String,
    pub working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRebaseBranchCommandRequest {
    pub repo_path: String,
    pub target_branch: String,
    pub working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRebaseAbortCommandRequest {
    pub repo_path: String,
    pub working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitConflictAbortCommandRequest {
    pub repo_path: String,
    pub operation: host_domain::GitConflictOperation,
    pub working_dir: Option<String>,
}
