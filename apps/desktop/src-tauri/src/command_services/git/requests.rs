use serde::Deserialize;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitRepoRequest {
    pub(crate) repo_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitCurrentBranchRequest {
    pub(crate) repo_path: String,
    pub(crate) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitSwitchBranchRequest {
    pub(crate) repo_path: String,
    pub(crate) branch: String,
    pub(crate) create: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitCreateWorktreeRequest {
    pub(crate) repo_path: String,
    pub(crate) worktree_path: String,
    pub(crate) branch: String,
    pub(crate) create_branch: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitRemoveWorktreeRequest {
    pub(crate) repo_path: String,
    pub(crate) worktree_path: String,
    pub(crate) force: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitPushBranchRequest {
    pub(crate) repo_path: String,
    pub(crate) branch: String,
    pub(crate) working_dir: Option<String>,
    pub(crate) remote: Option<String>,
    pub(crate) set_upstream: Option<bool>,
    pub(crate) force_with_lease: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitStatusRequest {
    pub(crate) repo_path: String,
    pub(crate) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitDiffRequest {
    pub(crate) repo_path: String,
    pub(crate) target_branch: Option<String>,
    pub(crate) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitAheadBehindRequest {
    pub(crate) repo_path: String,
    pub(crate) target_branch: String,
    pub(crate) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitWorktreeStatusRequest {
    pub(crate) repo_path: String,
    pub(crate) target_branch: String,
    pub(crate) diff_scope: Option<String>,
    pub(crate) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitCommitAllCommandRequest {
    pub(crate) repo_path: String,
    pub(crate) working_dir: Option<String>,
    pub(crate) message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitResetWorktreeSelectionCommandRequest {
    pub(crate) repo_path: String,
    pub(crate) target_branch: String,
    pub(crate) snapshot: host_domain::GitResetSnapshot,
    pub(crate) selection: host_domain::GitResetWorktreeSelection,
    pub(crate) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitFetchRemoteRequest {
    pub(crate) repo_path: String,
    pub(crate) target_branch: String,
    pub(crate) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitPullBranchRequest {
    pub(crate) repo_path: String,
    pub(crate) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitRebaseBranchCommandRequest {
    pub(crate) repo_path: String,
    pub(crate) target_branch: String,
    pub(crate) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitRebaseAbortCommandRequest {
    pub(crate) repo_path: String,
    pub(crate) working_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitConflictAbortCommandRequest {
    pub(crate) repo_path: String,
    pub(crate) operation: host_domain::GitConflictOperation,
    pub(crate) working_dir: Option<String>,
}
